// Smoketest for the MAIN tool layer. Runs under `npx tsx` WITHOUT electron: it
// drives dispatch() against the real LocalBackend (via getBackendManager) plus a
// stub ProjectManager, and asserts the exec / fs / encode / decode / finish paths.
// Not imported from production. Run: npx tsx src-main/tools/_smoketest.ts
import os from 'node:os';
import path from 'node:path';
import { dispatch } from './dispatch';
import { getBackendManager } from '../executor/ipc';
import type { ToolCtx, ToolCall } from './types';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  // Point the backend at an isolated temp workspace so fs tools stay contained.
  const workDir = path.join(os.tmpdir(), 'kanti-tools-smoketest', String(Date.now()));
  const mgr = getBackendManager();
  await mgr.select('local', { workDir });

  const stubProject = {
    getCurrentProject: () => ({ name: 'SmokeProj' }),
    saveProject: async () => ({ success: true, path: '/tmp/smoke.kanti' }),
  };

  const ctx: ToolCtx = {
    finished: false,
    proxyBaseUrl: 'http://localhost:9090',
    getProjectManager: () => stubProject,
    autoApproveReadOnly: true,
    requestApproval: async () => 'allow',
    emit: () => {},
  };

  const run = (name: string, parameters: Record<string, any>): Promise<any> =>
    dispatch(ctx, { name, parameters } as ToolCall);

  // 1. agent_shell_exec echo hi
  const echo = await run('agent_shell_exec', { cmd: 'echo hi' });
  check(
    'agent_shell_exec echo hi',
    echo.success && (echo.data?.stdout ?? '').trim() === 'hi' && echo.data?.exitCode === 0,
    JSON.stringify(echo),
  );

  // 2. agent_fs_write then agent_fs_read round-trip
  const w = await run('agent_fs_write', { path: 'smoke.txt', content: 'roundtrip-123' });
  check('agent_fs_write', w.success, JSON.stringify(w));
  const r = await run('agent_fs_read', { path: 'smoke.txt' });
  check('agent_fs_read round-trip', r.success && r.data?.content === 'roundtrip-123', JSON.stringify(r));

  // 2b. agent_fs_list sees the file
  const ls = await run('agent_fs_list', { path: '.' });
  check(
    'agent_fs_list sees smoke.txt',
    ls.success && Array.isArray(ls.data) && ls.data.some((e: any) => e.name === 'smoke.txt'),
    JSON.stringify(ls),
  );

  // 3. kanti_encode base64 'hi' -> 'aGk='
  const enc = await run('kanti_encode', { data: 'hi', encoding: 'base64' });
  check('kanti_encode base64 hi -> aGk=', enc.success && enc.data === 'aGk=', JSON.stringify(enc));
  const dec = await run('kanti_decode', { data: 'aGk=', encoding: 'base64' });
  check('kanti_decode base64 aGk= -> hi', dec.success && dec.data === 'hi', JSON.stringify(dec));

  // 3b. extra encodings round-trip (hex/url/html)
  for (const encoding of ['hex', 'url', 'html'] as const) {
    const sample = '<a> & b=1';
    const e = await run('kanti_encode', { data: sample, encoding });
    const d = await run('kanti_decode', { data: e.data, encoding });
    check(`kanti_${encoding} round-trip`, e.success && d.success && d.data === sample, JSON.stringify({ e, d }));
  }

  // 4. finish sets ctx.finished
  const fin = await run('finish', { summary: 'all done' });
  check('finish sets ctx.finished', fin.success && ctx.finished === true && ctx.finishMsg === 'all done', JSON.stringify(fin));

  // 5. approval gate: a denied exec returns a failure result
  const denyCtx: ToolCtx = { ...ctx, requestApproval: async () => 'deny' };
  const denied = await dispatch(denyCtx, { name: 'agent_shell_exec', parameters: { cmd: 'echo nope' } } as ToolCall);
  check('approval deny blocks exec', denied.success === false && /denied/i.test(denied.error || ''), JSON.stringify(denied));

  // 6. unknown tool -> failure, never throws
  const unknown = await run('does_not_exist', {});
  check('unknown tool -> failure', unknown.success === false, JSON.stringify(unknown));

  // 7. project tool via stub
  const proj = await run('kanti_project_get_current', {});
  check('kanti_project_get_current', proj.success && proj.data?.name === 'SmokeProj', JSON.stringify(proj));
  const save = await run('kanti_project_save', {});
  check('kanti_project_save', save.success === true, JSON.stringify(save));

  await mgr.teardown();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log('FAIL: uncaught', e);
  process.exit(1);
});
