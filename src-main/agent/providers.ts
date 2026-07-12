// Streaming + tool-calling provider adapters (MAIN). Two families:
//   - ANTHROPIC  (provider==='anthropic'): POST /v1/messages {stream:true}, SSE.
//   - OPENAI-compatible (provider==='openai'|'deepseek'|'custom'): POST
//     /chat/completions {stream:true}, SSE `data:` lines. `custom` targets a
//     configurable baseUrl (the owner's llama.cpp).
//   - GEMINI: agent (tool-calling) mode is unsupported — emit a clear error event.
//
// The SSE PARSING is a pure function per family — parseAnthropicSSE / parseOpenAISSE
// consume an async iterable of raw lines and yield StreamEvents. The HTTP layer
// (streamAgent) fetches with opts.fetchImpl || electron net.fetch, then feeds the
// response body lines into the matching parser. This split lets tests drive the
// parsers with synthetic bytes and never touch electron/network.

import type { ToolSchema } from '../tools/types';
import type { Block, Message, StreamEvent } from './types';
import { formatForAnthropic, formatForOpenAI } from '../tools/formatters';

export type Provider = 'anthropic' | 'openai' | 'deepseek' | 'gemini' | 'custom';

export interface StreamReq {
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface StreamOpts {
  /** Injected fetch (web-fetch shape). Defaults to electron `net.fetch`. */
  fetchImpl?: (url: string, init: any) => Promise<any>;
}

export type StreamAgentFn = (req: StreamReq, opts?: StreamOpts) => AsyncIterable<StreamEvent>;

const ANTHROPIC_MAX_TOKENS = 8192;

/** Top-level dispatcher: pick the family and stream StreamEvents. Never throws —
 *  a transport/setup failure surfaces as an error + done event pair. */
export async function* streamAgent(req: StreamReq, opts: StreamOpts = {}): AsyncIterable<StreamEvent> {
  try {
    if (req.provider === 'anthropic') {
      yield* anthropicStream(req, opts);
    } else if (req.provider === 'gemini') {
      // Minimal-effort correct path: gemini function-calling isn't wired here.
      yield {
        kind: 'error',
        error:
          'Gemini agent mode (tool calling) is not supported. Use anthropic, openai, deepseek, or a custom OpenAI-compatible endpoint.',
      };
      yield { kind: 'done', stopReason: 'error' };
    } else {
      yield* openaiStream(req, opts);
    }
  } catch (error) {
    yield { kind: 'error', error: errMsg(error) };
    yield { kind: 'done', stopReason: 'error' };
  }
}

// --- Anthropic ---------------------------------------------------------------

async function* anthropicStream(req: StreamReq, opts: StreamOpts): AsyncIterable<StreamEvent> {
  const fetchImpl = getFetch(opts);
  const base = (req.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const url = base + '/v1/messages';

  const body: Record<string, any> = {
    model: req.model || 'claude-opus-4-8',
    max_tokens: ANTHROPIC_MAX_TOKENS,
    stream: true,
    messages: mapMessagesAnthropic(req.messages),
    tools: formatForAnthropic(req.tools),
  };
  if (req.system) body.system = req.system;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    yield { kind: 'error', error: `anthropic ${res.status}: ${await safeText(res)}` };
    yield { kind: 'done', stopReason: 'error' };
    return;
  }

  yield* parseAnthropicSSE(bodyToLines(res.body));
}

/** Map our Block-shaped history to the Anthropic messages wire format. */
function mapMessagesAnthropic(messages: Message[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // system is passed top-level
    const content = m.content.map((b) => blockToAnthropic(b)).filter(Boolean);
    if (content.length) out.push({ role: m.role, content });
  }
  return out;
}

function blockToAnthropic(b: Block): any {
  switch (b.kind) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'thinking': {
      const t: any = { type: 'thinking', thinking: b.thinking };
      if (b.signature) t.signature = b.signature;
      return t;
    }
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, is_error: b.isError };
    default:
      return null;
  }
}

/**
 * Pure Anthropic SSE parser. Consumes raw lines, tracks partial tool_use JSON per
 * block index, and yields StreamEvents. No electron, no network.
 */
export async function* parseAnthropicSSE(lines: AsyncIterable<string>): AsyncIterable<StreamEvent> {
  const toolBlocks: Record<number, { id: string; name: string; json: string }> = {};
  let stopReason: string | undefined;

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;

    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }

    switch (ev.type) {
      case 'message_start':
        if (ev.message?.usage) {
          yield {
            kind: 'usage',
            usage: {
              inputTokens: ev.message.usage.input_tokens || 0,
              outputTokens: ev.message.usage.output_tokens || 0,
            },
          };
        }
        break;

      case 'content_block_start':
        if (ev.content_block?.type === 'tool_use') {
          toolBlocks[ev.index] = { id: ev.content_block.id, name: ev.content_block.name, json: '' };
        }
        break;

      case 'content_block_delta': {
        const d = ev.delta;
        if (!d) break;
        if (d.type === 'text_delta') yield { kind: 'text', text: d.text || '' };
        else if (d.type === 'thinking_delta') yield { kind: 'thinking', thinking: d.thinking || '' };
        else if (d.type === 'signature_delta') yield { kind: 'signature', signature: d.signature || '' };
        else if (d.type === 'input_json_delta') {
          const b = toolBlocks[ev.index];
          if (b) b.json += d.partial_json || '';
        }
        break;
      }

      case 'content_block_stop': {
        const b = toolBlocks[ev.index];
        if (b) {
          yield { kind: 'tool_use', id: b.id, name: b.name, input: parseJsonOr(b.json, {}) };
          delete toolBlocks[ev.index];
        }
        break;
      }

      case 'message_delta':
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage) yield { kind: 'usage', usage: { inputTokens: 0, outputTokens: ev.usage.output_tokens || 0 } };
        break;

      case 'message_stop':
        yield { kind: 'done', stopReason };
        break;
    }
  }
}

// --- OpenAI-compatible -------------------------------------------------------

async function* openaiStream(req: StreamReq, opts: StreamOpts): AsyncIterable<StreamEvent> {
  const fetchImpl = getFetch(opts);
  const base = openaiBase(req).replace(/\/$/, '');
  const url = base + '/chat/completions';

  const body: Record<string, any> = {
    model: req.model || openaiDefaultModel(req.provider),
    stream: true,
    messages: mapMessagesOpenAI(req.system, req.messages),
    tools: formatForOpenAI(req.tools),
    tool_choice: 'auto',
  };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (req.apiKey) headers['authorization'] = `Bearer ${req.apiKey}`;

  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    yield { kind: 'error', error: `openai ${res.status}: ${await safeText(res)}` };
    yield { kind: 'done', stopReason: 'error' };
    return;
  }

  yield* parseOpenAISSE(bodyToLines(res.body));
}

function openaiBase(req: StreamReq): string {
  if (req.provider === 'openai') return req.baseUrl || 'https://api.openai.com/v1';
  if (req.provider === 'deepseek') return req.baseUrl || 'https://api.deepseek.com/v1';
  return req.baseUrl || 'http://localhost:8080/v1'; // custom (llama.cpp)
}

function openaiDefaultModel(provider: Provider): string {
  if (provider === 'openai') return 'gpt-4o';
  if (provider === 'deepseek') return 'deepseek-chat';
  return 'local';
}

/** Map Block-shaped history to OpenAI chat-completions messages. tool_result blocks
 *  become role:'tool' messages (keyed by tool_call_id); assistant tool_use blocks
 *  become an assistant message carrying `tool_calls`. */
function mapMessagesOpenAI(system: string, messages: Message[]): any[] {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: textOf(m) });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b) => b.kind === 'text')
        .map((b) => (b as any).text)
        .join('');
      const toolUses = m.content.filter((b) => b.kind === 'tool_use') as Extract<Block, { kind: 'tool_use' }>[];
      const msg: any = { role: 'assistant', content: text || '' };
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input || {}) },
        }));
      }
      out.push(msg);
    } else {
      // user turn: tool_result blocks become tool messages; text becomes a user message.
      const toolResults = m.content.filter((b) => b.kind === 'tool_result') as Extract<Block, { kind: 'tool_result' }>[];
      for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content });
      const text = m.content
        .filter((b) => b.kind === 'text')
        .map((b) => (b as any).text)
        .join('');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

/**
 * Pure OpenAI-compatible SSE parser. `data:` lines carry a chat-completions chunk;
 * tool_calls stream across chunks and are accumulated per index (id+name arrive
 * first, arguments as string fragments). Flushes accumulated tool calls on [DONE]
 * or stream end.
 */
export async function* parseOpenAISSE(lines: AsyncIterable<string>): AsyncIterable<StreamEvent> {
  const toolCalls: Record<number, { id: string; name: string; args: string }> = {};
  let stopReason: string | undefined;

  const flushTools = function* (): Generator<StreamEvent> {
    const idxs = Object.keys(toolCalls)
      .map(Number)
      .sort((a, b) => a - b);
    for (const i of idxs) {
      const tc = toolCalls[i];
      yield { kind: 'tool_use', id: tc.id || `call_${i}`, name: tc.name, input: parseJsonOr(tc.args, {}) };
      delete toolCalls[i];
    }
  };

  for await (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      yield* flushTools();
      yield { kind: 'done', stopReason };
      return;
    }

    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }

    if (ev.usage) {
      yield {
        kind: 'usage',
        usage: { inputTokens: ev.usage.prompt_tokens || 0, outputTokens: ev.usage.completion_tokens || 0 },
      };
    }

    const choice = ev.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};

    if (delta.content) yield { kind: 'text', text: delta.content };
    if (delta.reasoning_content) yield { kind: 'thinking', thinking: delta.reasoning_content };

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', args: '' };
        const slot = toolCalls[idx];
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
    }

    if (choice.finish_reason) stopReason = choice.finish_reason;
  }

  // Stream ended without an explicit [DONE].
  yield* flushTools();
  yield { kind: 'done', stopReason };
}

// --- HTTP body → lines -------------------------------------------------------

/** Read a web Response body (ReadableStream) and yield text lines split on `\n`.
 *  SSE event separators (`\n\n`) surface as empty lines the parsers skip. */
async function* bodyToLines(body: any): AsyncIterable<string> {
  if (!body || typeof body.getReader !== 'function') return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  buf += decoder.decode();
  if (buf) yield buf;
}

// --- helpers -----------------------------------------------------------------

function getFetch(opts: StreamOpts): (url: string, init: any) => Promise<any> {
  if (opts.fetchImpl) return opts.fetchImpl;
  // Lazily require electron so this module is importable under plain node/tsx.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { net } = require('electron');
  return (url: string, init: any) => net.fetch(url, init);
}

function textOf(m: Message): string {
  return m.content
    .filter((b) => b.kind === 'text')
    .map((b) => (b as any).text)
    .join('');
}

function parseJsonOr(s: string, fallback: any): any {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

async function safeText(res: any): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return `HTTP ${res?.status ?? '?'}`;
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}
