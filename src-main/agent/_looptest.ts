// tsx smoketest for the agent loop (not imported by prod). Drives AgentSession with
// a MOCK streamAgent + the REAL LocalBackend, exercising: approve→dispatch→finish,
// deny, and mid-run abort.
//   run: npx tsx src-main/agent/_looptest.ts
import path from 'node:path';
import os from 'node:os';
import { AgentSession } from './loop';
import type { AgentSessionCfg } from './loop';
import type { StreamEvent } from './types';
import type { StreamReq } from './providers';
import { getToolSchemas } from '../tools/registry';
import { getBackendManager } from '../executor/ipc';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A mock streamAgent: turn 1 → tool_use agent_shell_exec{cmd:'echo hi'} then done;
// turn 2 → tool_use finish{summary:'done'} then done; afterwards → empty end_turn.
function makeMockStream() {
  let call = 0;
  return async function* (_req: StreamReq): AsyncIterable<StreamEvent> {
    call++;
    if (call === 1) {
      yield { kind: 'text', text: 'working on it' };
      yield { kind: 'tool_use', id: 't1', name: 'agent_shell_exec', input: { cmd: 'echo hi' } };
      yield { kind: 'done', stopReason: 'end_turn' };
    } else if (call === 2) {
      yield { kind: 'tool_use', id: 't2', name: 'finish', input: { summary: 'done' } };
      yield { kind: 'done', stopReason: 'end_turn' };
    } else {
      yield { kind: 'done', stopReason: 'end_turn' };
    }
  };
}

function baseCfg(over: Partial<AgentSessionCfg>): AgentSessionCfg {
  return {
    streamAgent: makeMockStream(),
    provider: 'anthropic',
    apiKey: 'x',
    system: 'test system',
    tools: getToolSchemas(),
    autoApproveReadOnly: false,
    getProjectManager: () => null,
    onEvent: () => {},
    ...over,
  };
}

async function main() {
  // Pin the LocalBackend to an explicit workDir. Under tsx's ESM the backend's
  // defaultWorkDir() path calls `require('node:os')`, which only resolves in the
  // real Electron main (CJS); selecting with a workDir skips it. No-op in prod.
  await getBackendManager().select('local', { workDir: path.join(os.tmpdir(), 'kanti-agent-looptest') });

  // --- Scenario 1: approve → dispatch → finish ---
  {
    const events: any[] = [];
    const session = new AgentSession(
      baseCfg({
        streamAgent: makeMockStream(),
        requestApproval: async () => 'allow',
        onEvent: (ev) => events.push(ev),
      }),
    );
    session.enqueueUserMessage('start');
    await session.run(new AbortController());

    const toolCalls = events.filter((e) => e.kind === 'tool_call');
    ok(
      toolCalls.some((e) => e.name === 'agent_shell_exec'),
      'allow: tool_call(agent_shell_exec) emitted',
    );
    const execResult = events.find((e) => e.kind === 'tool_result' && e.name === 'agent_shell_exec');
    ok(!!execResult && String(execResult.content).includes('hi'), 'allow: tool_result contains "hi"');
    ok(
      toolCalls.some((e) => e.name === 'finish'),
      'allow: tool_call(finish) emitted',
    );
    const end = events.find((e) => e.kind === 'turn_end' && e.reason === 'finish');
    ok(!!end, 'allow: turn_end reason=finish');
    ok(!!end && end.finishMsg === 'done', 'allow: finishMsg propagated');
    ok(events.some((e) => e.kind === 'approval_request' && e.name === 'agent_shell_exec'), 'allow: approval_request emitted');
    ok(events.some((e) => e.kind === 'done'), 'allow: done emitted');
  }

  // --- Scenario 2: deny → tool_result "Denied" ---
  {
    const events: any[] = [];
    const session = new AgentSession(
      baseCfg({
        streamAgent: makeMockStream(),
        requestApproval: async () => 'deny',
        onEvent: (ev) => events.push(ev),
      }),
    );
    session.enqueueUserMessage('start');
    await session.run(new AbortController());

    const denied = events.find(
      (e) => e.kind === 'tool_result' && e.name === 'agent_shell_exec' && e.isError,
    );
    ok(!!denied && /denied by user/i.test(String(denied.content)), 'deny: tool_result denied by user');
    // The exec was never dispatched, so its result must not contain command output.
    ok(!!denied && !String(denied.content).includes('hi'), 'deny: exec did not run (no "hi")');
  }

  // --- Scenario 3: stop() mid-run aborts a pending approval ---
  {
    const events: any[] = [];
    const controller = new AbortController();
    const session = new AgentSession(
      baseCfg({
        streamAgent: makeMockStream(),
        // No requestApproval → the loop blocks on the internal approval gate,
        // which we then abort.
        onEvent: (ev) => events.push(ev),
      }),
    );
    session.enqueueUserMessage('start');
    const runPromise = session.run(controller);

    // Wait for the approval_request to be emitted, then abort.
    for (let i = 0; i < 50 && !events.some((e) => e.kind === 'approval_request'); i++) await sleep(5);
    ok(events.some((e) => e.kind === 'approval_request'), 'abort: approval_request reached');
    controller.abort();
    await runPromise;

    const stopped = events.find((e) => e.kind === 'turn_end' && e.reason === 'stopped');
    ok(!!stopped, 'abort: turn_end reason=stopped');
    ok(!events.some((e) => e.kind === 'tool_result'), 'abort: no tool_result after abort');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
