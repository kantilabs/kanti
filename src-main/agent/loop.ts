// The HITL agent turn loop (MAIN). A simplified port of harness
// internal/core/session.go Run/oneTurn/dispatchAll:
//   - loop turn = 0..maxTurns: drain queued operator messages, emit turn_start,
//     stream one model response (oneTurn), then dispatch its tool calls sequentially.
//   - oneTurn accumulates text/thinking/tool_use blocks and emits COALESCED
//     text_delta/thinking_delta (batched ~50ms / ~200 chars — the GUI lock-up fix),
//     emitting tool_call as each tool_use completes.
//   - Termination is keyed on the PRESENCE of tool calls, not the stop reason. A
//     no-tool turn ends the turn and (KeepAlive) blocks awaiting the next operator
//     message, so the chat stays live; abort or the finish tool return the loop.
//   - Each requiresApproval tool clears a human approval gate before dispatch runs.
// Dropped vs harness: parallel tool phase (sequential here), compaction, retries.

import type { AgentEvent, Block, Message, StreamEvent } from './types';
import type { ToolCall, ToolCtx, ToolSchema } from '../tools/types';
import type { Provider, StreamAgentFn } from './providers';
import { dispatch } from '../tools/dispatch';
import { getToolSchema } from '../tools/registry';
import { formatToolResultContent } from '../tools/formatters';

export interface AgentSessionCfg {
  /** Streaming provider adapter — injectable so tests can drive the loop with a mock. */
  streamAgent: StreamAgentFn;
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Fully-assembled system prompt (assembleSystem output). */
  system: string;
  tools: ToolSchema[];
  autoApproveReadOnly: boolean;
  maxTurns?: number;
  /** go-backend proxy API base for the kanti_proxy_* tools. */
  proxyBaseUrl?: string;
  /** Returns the in-process ProjectManager for the kanti_project_* tools. */
  getProjectManager?: () => any;
  /** Optional direct approval source (tests / headless). When absent, approvals are
   *  driven by resolveApproval() — the renderer round-trip. */
  requestApproval?: (call: ToolCall) => Promise<'allow' | 'deny'>;
  /** Sink for every AgentEvent (manager wires this to webContents.send). */
  onEvent: (ev: AgentEvent) => void;
}

const DEFAULT_MAX_TURNS = 24;
const COALESCE_CHARS = 200;
const COALESCE_MS = 50;

export class AgentSession {
  private history: Message[] = [];
  private readonly ctx: ToolCtx;
  private readonly maxTurns: number;
  private readonly autoApproveReadOnly: boolean;

  private queue: string[] = [];
  private waiter: ((v: boolean) => void) | null = null;
  private pendingApprovals = new Map<string, (v: 'allow' | 'deny') => void>();
  private controller: AbortController | null = null;
  private done = false;
  private turnCount = 0;

  constructor(private cfg: AgentSessionCfg) {
    this.maxTurns = cfg.maxTurns && cfg.maxTurns > 0 ? cfg.maxTurns : DEFAULT_MAX_TURNS;
    this.autoApproveReadOnly = !!cfg.autoApproveReadOnly;
    this.ctx = {
      finished: false,
      proxyBaseUrl: cfg.proxyBaseUrl || 'http://localhost:9090',
      getProjectManager: cfg.getProjectManager || (() => null),
      autoApproveReadOnly: this.autoApproveReadOnly,
      // The loop is the single approval gate; dispatch's own gate is a pass-through
      // here so a tool is never prompted twice.
      requestApproval: async () => 'allow',
      emit: () => {
        /* dispatch telemetry is not surfaced to the renderer */
      },
    };
  }

  /** Queue an operator message; wakes a KeepAlive-blocked loop. */
  enqueueUserMessage(text: string): void {
    this.queue.push(text);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(true);
    }
  }

  /** Resolve a pending approval (from the resolveApproval IPC). */
  resolveApproval(id: string, verdict: 'allow' | 'deny'): void {
    const r = this.pendingApprovals.get(id);
    if (r) {
      this.pendingApprovals.delete(id);
      r(verdict);
    }
  }

  /** Abort the run (turn-boundary + streaming + pending approvals). */
  stop(): void {
    this.controller?.abort();
  }

  getState() {
    return {
      running: !this.done,
      finished: this.ctx.finished,
      turns: this.turnCount,
      historyLength: this.history.length,
      pendingApprovals: this.pendingApprovals.size,
      queued: this.queue.length,
    };
  }

  /** Run the turn loop until finish / abort / error / max turns. */
  async run(controller: AbortController): Promise<void> {
    this.controller = controller;
    const signal = controller.signal;

    for (let turn = 0; turn < this.maxTurns; turn++) {
      this.turnCount = turn;
      if (signal.aborted) return this.finish('turn_end', 'stopped');

      this.drainQueue();
      this.emit({ kind: 'turn_start', turn });

      let assistant: Message;
      let toolUses: Extract<Block, { kind: 'tool_use' }>[];
      let stop: string | undefined;
      try {
        const r = await this.oneTurn(signal);
        assistant = r.assistant;
        toolUses = r.toolUses;
        stop = r.stop;
      } catch (error) {
        if (signal.aborted) return this.finish('turn_end', 'stopped');
        this.emit({ kind: 'error', error: errMsg(error) });
        return this.end();
      }

      this.history.push(assistant);

      if (toolUses.length === 0) {
        // No tool calls: a legitimate turn boundary. Emit turn_end and (KeepAlive)
        // block for the next operator message so the chat stays live.
        this.emit({ kind: 'turn_end', reason: stop || 'end_turn' });
        const more = await this.waitForNext(signal);
        if (!more) return this.end();
        turn--; // the wait didn't consume a real turn
        continue;
      }

      // Dispatch this turn's tool calls sequentially.
      const results: Block[] = [];
      let aborted = false;
      for (const b of toolUses) {
        if (signal.aborted) {
          aborted = true;
          break;
        }
        const call: ToolCall = { id: b.id, name: b.name, parameters: b.input || {} };
        const def = getToolSchema(b.name);
        const needsApproval = !!def?.requiresApproval && !(def?.readOnly && this.autoApproveReadOnly);

        if (needsApproval) {
          let verdict: 'allow' | 'deny';
          try {
            verdict = await this.approve(call, signal);
          } catch {
            aborted = true; // rejected on abort
            break;
          }
          if (verdict === 'deny') {
            const content = `Tool call denied by user: ${b.name}`;
            this.emit({ kind: 'tool_result', id: b.id, name: b.name, content, isError: true });
            results.push({ kind: 'tool_result', toolUseId: b.id, content, isError: true });
            continue;
          }
        }

        const result = await dispatch(this.ctx, call);
        const content = formatToolResultContent(result);
        this.emit({ kind: 'tool_result', id: b.id, name: b.name, content, isError: !result.success });
        results.push({ kind: 'tool_result', toolUseId: b.id, content, isError: !result.success });
      }

      if (aborted || signal.aborted) return this.finish('turn_end', 'stopped');

      this.history.push({ role: 'user', content: results });

      if (this.ctx.finished) {
        this.emit({ kind: 'turn_end', reason: 'finish', finishMsg: this.ctx.finishMsg });
        return this.end();
      }
    }

    this.emit({ kind: 'turn_end', reason: 'max_turns' });
    return this.end();
  }

  // --- one streamed model response -------------------------------------------

  private async oneTurn(
    signal: AbortSignal,
  ): Promise<{ assistant: Message; toolUses: Extract<Block, { kind: 'tool_use' }>[]; stop?: string }> {
    const req = {
      provider: this.cfg.provider,
      apiKey: this.cfg.apiKey,
      baseUrl: this.cfg.baseUrl,
      model: this.cfg.model,
      system: this.cfg.system,
      messages: this.history,
      tools: this.cfg.tools,
    };

    const blocks: Block[] = [];
    const toolUses: Extract<Block, { kind: 'tool_use' }>[] = [];
    let stop: string | undefined;

    // Block accumulation (for history).
    let curText = '';
    let curThink = '';
    let curSig = '';
    // Emit coalescing (batched deltas — the GUI lock-up fix).
    let emitBuf = '';
    let emitKind: 'text' | 'thinking' | null = null;
    let emitSince = 0;

    const flushEmit = () => {
      if (emitBuf && emitKind) {
        this.emit(emitKind === 'text' ? { kind: 'text_delta', text: emitBuf } : { kind: 'thinking_delta', text: emitBuf });
      }
      emitBuf = '';
      emitKind = null;
    };
    const pushEmit = (kind: 'text' | 'thinking', text: string) => {
      if (emitKind && emitKind !== kind) flushEmit();
      if (!emitKind) {
        emitKind = kind;
        emitSince = Date.now();
      }
      emitBuf += text;
      if (emitBuf.length >= COALESCE_CHARS || Date.now() - emitSince >= COALESCE_MS) flushEmit();
    };
    const flushText = () => {
      if (curText) {
        blocks.push({ kind: 'text', text: curText });
        curText = '';
      }
    };
    const flushThink = () => {
      if (curThink) {
        blocks.push({ kind: 'thinking', thinking: curThink, signature: curSig || undefined });
        curThink = '';
        curSig = '';
      }
    };

    const stream: AsyncIterable<StreamEvent> = this.cfg.streamAgent(req, {});
    for await (const ev of stream) {
      if (signal.aborted) throw new Error('aborted');
      switch (ev.kind) {
        case 'text':
          flushThink();
          curText += ev.text;
          pushEmit('text', ev.text);
          break;
        case 'thinking':
          flushText();
          curThink += ev.thinking;
          pushEmit('thinking', ev.thinking);
          break;
        case 'signature':
          curSig += ev.signature;
          break;
        case 'tool_use': {
          flushText();
          flushThink();
          flushEmit();
          const b: Extract<Block, { kind: 'tool_use' }> = {
            kind: 'tool_use',
            id: ev.id,
            name: ev.name,
            input: ev.input || {},
          };
          blocks.push(b);
          toolUses.push(b);
          this.emit({ kind: 'tool_call', id: b.id, name: b.name, input: b.input });
          break;
        }
        case 'usage':
          this.emit({ kind: 'usage', inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens });
          break;
        case 'done':
          if (ev.stopReason) stop = ev.stopReason;
          break;
        case 'error':
          throw new Error(ev.error);
      }
    }
    flushEmit();
    flushText();
    flushThink();

    return { assistant: { role: 'assistant', content: blocks }, toolUses, stop };
  }

  // --- approvals + queue -----------------------------------------------------

  private approve(call: ToolCall, signal: AbortSignal): Promise<'allow' | 'deny'> {
    this.emit({ kind: 'approval_request', id: call.id || '', name: call.name, input: call.parameters });
    if (this.cfg.requestApproval) return this.cfg.requestApproval(call);
    return new Promise((resolve, reject) => {
      const id = call.id || '';
      this.pendingApprovals.set(id, resolve);
      const onAbort = () => {
        this.pendingApprovals.delete(id);
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private drainQueue(): void {
    while (this.queue.length) {
      const t = this.queue.shift() as string;
      this.history.push({ role: 'user', content: [{ kind: 'text', text: t }] });
    }
  }

  private waitForNext(signal: AbortSignal): Promise<boolean> {
    if (this.queue.length) return Promise.resolve(true);
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.waiter = resolve;
      const onAbort = () => {
        if (this.waiter) {
          this.waiter = null;
          resolve(false);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private emit(ev: AgentEvent): void {
    this.cfg.onEvent(ev);
  }

  private finish(kind: 'turn_end', reason: string): void {
    this.emit({ kind, reason });
    this.end();
  }

  private end(): void {
    this.done = true;
    this.emit({ kind: 'done' });
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}
