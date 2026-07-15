// tsx smoketest for the pure SSE parsers (not imported by prod). Feeds synthetic
// Anthropic + OpenAI SSE bytes and asserts the yielded StreamEvents.
//   run: npx tsx src-main/agent/_ssetest.ts
import { parseAnthropicSSE, parseOpenAISSE } from './providers';
import type { StreamEvent } from './types';

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label}`);
  }
}

async function* lines(s: string): AsyncIterable<string> {
  for (const line of s.split('\n')) yield line;
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const ANTHROPIC_SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"agent_fs_list"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"cmd\\":"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"ls\\"}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

const OPENAI_SSE = [
  'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}',
  '',
  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"agent_shell_exec","arguments":"{\\"cmd\\":"}}]}}]}',
  '',
  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}',
  '',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: [DONE]',
  '',
].join('\n');

async function main() {
  // --- Anthropic ---
  const a = await collect(parseAnthropicSSE(lines(ANTHROPIC_SSE)));
  const aText = a.find((e) => e.kind === 'text') as any;
  ok(!!aText && aText.text === 'Hello', 'anthropic: text delta "Hello"');
  const aTool = a.find((e) => e.kind === 'tool_use') as any;
  ok(!!aTool && aTool.name === 'agent_fs_list', 'anthropic: tool_use name');
  ok(!!aTool && aTool.input && aTool.input.cmd === 'ls', 'anthropic: tool_use input {cmd:"ls"}');
  const aDone = a.find((e) => e.kind === 'done') as any;
  ok(!!aDone && aDone.stopReason === 'tool_use', 'anthropic: done stop_reason tool_use');
  ok(a.some((e) => e.kind === 'usage'), 'anthropic: usage emitted');

  // --- OpenAI ---
  const o = await collect(parseOpenAISSE(lines(OPENAI_SSE)));
  const oText = o.find((e) => e.kind === 'text') as any;
  ok(!!oText && oText.text === 'Hi', 'openai: text delta "Hi"');
  const oTool = o.find((e) => e.kind === 'tool_use') as any;
  ok(!!oTool && oTool.name === 'agent_shell_exec', 'openai: tool_use name (streamed across chunks)');
  ok(!!oTool && oTool.id === 'call_1', 'openai: tool_use id');
  ok(!!oTool && oTool.input && oTool.input.cmd === 'ls', 'openai: tool_use parsed arguments {cmd:"ls"}');
  const oDone = o.find((e) => e.kind === 'done') as any;
  ok(!!oDone && oDone.stopReason === 'tool_calls', 'openai: done finish_reason tool_calls');

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
