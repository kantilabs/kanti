// Integration smoke test for the exec-backend substrate. Run with:
//   cd <kanti> && npx tsx src-main/executor/_smoketest.ts
// Electron-free: imports the backends directly and drives them against live
// child_process and docker. NOT imported by production code.
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalBackend } from './local';
import { DockerBackend } from './docker';
import { resolve } from './resolve';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const results: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1;
    results.push(`  PASS  ${name}`);
  } else {
    fail += 1;
    results.push(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`);
  }
}

function skip(name: string, why = ''): void {
  results.push(`  SKIP  ${name}${why ? ' :: ' + why : ''}`);
}

async function localSuite(): Promise<void> {
  results.push('[LOCAL backend]');
  const work = path.join(os.tmpdir(), 'kanti-be-test', 'local-' + Date.now().toString(36));
  const be = new LocalBackend(work);
  await be.provision({ workDir: work, runId: 'lt', image: '' });

  // 1. simple shell echo (length-1 → sh -c)
  {
    const o = await be.exec({ cmd: ['echo hello'] });
    check('exec echo hello → stdout "hello"', o.stdout.trim() === 'hello' && o.exitCode === 0,
      `stdout=${JSON.stringify(o.stdout)} exit=${o.exitCode}`);
  }

  // 2. argv form with explicit sh -c and exit code
  {
    const o = await be.exec({ cmd: ['sh', '-c', 'echo multi && exit 3'] });
    check('exec argv sh -c "echo multi && exit 3" → "multi", exit 3',
      o.stdout.trim() === 'multi' && o.exitCode === 3,
      `stdout=${JSON.stringify(o.stdout)} exit=${o.exitCode}`);
  }

  // 3. piped command (proves sh -c for length-1)
  {
    const o = await be.exec({ cmd: ['echo hi | tr a-z A-Z'] });
    check('exec "echo hi | tr a-z A-Z" → "HI"', o.stdout.trim() === 'HI',
      `stdout=${JSON.stringify(o.stdout)}`);
  }

  // 3b. multi-element argv must NOT reinterpret shell metachars
  {
    const o = await be.exec({ cmd: ['echo', 'a|b'] });
    check('exec ["echo","a|b"] → literal "a|b" (no shell)', o.stdout.trim() === 'a|b',
      `stdout=${JSON.stringify(o.stdout)}`);
  }

  // 4. writeFile / readFile / listDir round-trip
  {
    await be.writeFile('sub/hello.txt', Buffer.from('roundtrip'));
    const rd = await be.readFile('sub/hello.txt');
    const ents = await be.listDir('sub');
    check('writeFile/readFile round-trip', rd.toString() === 'roundtrip',
      `read=${JSON.stringify(rd.toString())}`);
    check('listDir shows written file', ents.some((e) => e.name === 'hello.txt' && !e.isDir),
      JSON.stringify(ents));
  }

  // 5. safePath: writeFile traversal MUST reject
  {
    let rejected = false;
    try {
      await be.writeFile('../escape.txt', Buffer.from('x'));
    } catch {
      rejected = true;
    }
    check('safePath rejects writeFile("../escape.txt")', rejected);
    // confirm nothing was written outside the workspace
    let leaked = false;
    try {
      await fs.access(path.join(path.dirname(work), 'escape.txt'));
      leaked = true;
    } catch {
      /* good, not present */
    }
    check('safePath: no file leaked outside workspace', !leaked);
  }

  // 6. session: spawn, writeStdin, readSession contains output, killSession
  {
    const id = await be.spawnSession({ cmd: [] }); // defaults to sh -i
    await be.writeStdin(id, Buffer.from('echo sess\n'));
    await sleep(400);
    const chunk = await be.readSession(id, 0);
    check('session readSession contains "sess"', chunk.data.toString().includes('sess'),
      `data=${JSON.stringify(chunk.data.toString())}`);
    await be.killSession(id);
    let gone = false;
    try {
      await be.readSession(id, 0);
    } catch {
      gone = true;
    }
    check('killSession removes the session', gone);
  }

  // 7. timeout: a 5s sleep with 500ms timeout returns promptly, killed
  {
    const t0 = Date.now();
    const o = await be.exec({ cmd: ['sleep 5'], timeoutMs: 500 });
    const dt = Date.now() - t0;
    check('exec timeout kills promptly (<2.5s)', dt < 2500, `elapsed=${dt}ms`);
    check('exec timeout marks [timed out]', o.stderr.includes('[timed out]'),
      `stderr=${JSON.stringify(o.stderr)}`);
  }

  // 8. output cap / truncation
  {
    const o = await be.exec({ cmd: ['yes aaaaaaaa | head -n 100000'], maxBytes: 1024 });
    check('exec output cap truncates', o.truncated === true, `truncated=${o.truncated} len=${o.stdout.length}`);
  }

  // 9. proxy env injection (run-level) surfaces http_proxy + CA vars
  {
    const beP = new LocalBackend(work);
    await beP.provision({ workDir: work, runId: 'lt', image: '', proxyUrl: 'http://127.0.0.1:9090', proxyCAFile: '/tmp/ca.pem' });
    const o = await beP.exec({ cmd: ['printf "%s|%s" "$http_proxy" "$SSL_CERT_FILE"'] });
    check('proxy env injects http_proxy + SSL_CERT_FILE', o.stdout.trim() === 'http://127.0.0.1:9090|/tmp/ca.pem',
      `stdout=${JSON.stringify(o.stdout)}`);
    // per-exec proxyUrl override wins; per-exec env wins last
    const o2 = await beP.exec({ cmd: ['printf "%s|%s" "$http_proxy" "$FOO"'], proxyUrl: 'http://127.0.0.1:7000', env: { FOO: 'bar' } });
    check('per-exec proxyUrl + env override win', o2.stdout.trim() === 'http://127.0.0.1:7000|bar',
      `stdout=${JSON.stringify(o2.stdout)}`);
    await beP.teardown();
  }

  // 10. cwd resolution honors workspace-relative dir
  {
    await be.writeFile('cwdtest/marker.txt', Buffer.from('x'));
    const o = await be.exec({ cmd: ['pwd; ls'], cwd: 'cwdtest' });
    check('exec cwd resolves workspace-relative', o.stdout.includes('marker.txt') && o.stdout.includes('cwdtest'),
      `stdout=${JSON.stringify(o.stdout)}`);
  }

  await be.teardown();
  // verify sessions were cleared on teardown (spawn one, teardown, read fails)
  {
    const be2 = new LocalBackend(work);
    await be2.provision({ workDir: work, runId: 'lt2', image: '' });
    const id = await be2.spawnSession({ cmd: [] });
    await be2.teardown();
    // after teardown the session map is cleared
    let gone = false;
    try {
      await be2.readSession(id, 0);
    } catch {
      gone = true;
    }
    check('teardown clears sessions', gone);
  }
}

async function dockerSuite(): Promise<void> {
  results.push('[DOCKER backend]');
  // docker version probe
  let dockerUp = false;
  try {
    await execFileAsync('docker', ['version'], { timeout: 10_000 });
    dockerUp = true;
  } catch {
    dockerUp = false;
  }

  // pick a usable, already-present image
  let image = '';
  if (dockerUp) {
    try {
      const { stdout } = await execFileAsync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], {
        timeout: 10_000,
      });
      const imgs = stdout.split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => !s.includes('<none>'));
      // prefer small well-known images
      image = imgs.find((i) => i.startsWith('alpine')) || imgs.find((i) => i.startsWith('busybox')) || imgs[0] || '';
    } catch {
      /* ignore */
    }
    if (!image) {
      // try pulling alpine (network may be blocked)
      try {
        await execFileAsync('timeout', ['60', 'docker', 'pull', 'alpine'], { timeout: 65_000 });
        image = 'alpine:latest';
      } catch {
        image = '';
      }
    }
  }

  if (dockerUp && image) {
    results.push(`  (live docker, image=${image})`);
    const work = path.join(os.tmpdir(), 'kanti-be-test', 'docker-' + Date.now().toString(36));
    const be = new DockerBackend(image, work);
    let provisioned = false;
    try {
      await be.provision({ image, runId: 'test', workDir: work });
      provisioned = true;
    } catch (e) {
      check('docker provision', false, String((e as Error).message));
    }

    if (provisioned) {
      check('docker provision sets containerId', be.container.length > 0, `cid=${be.container}`);

      // exec inside container
      {
        const o = await be.exec({ cmd: ['echo indocker'] });
        check('docker exec "echo indocker" → "indocker"', o.stdout.trim() === 'indocker' && o.exitCode === 0,
          `stdout=${JSON.stringify(o.stdout)} exit=${o.exitCode} stderr=${JSON.stringify(o.stderr)}`);
      }

      // label present
      {
        const { stdout } = await execFileAsync('docker', ['ps', '--filter', 'label=kanti.run=test', '-q']);
        check('docker container has label kanti.run=test', stdout.trim().length > 0, `q=${JSON.stringify(stdout.trim())}`);
      }

      // piped command inside container (proves dockerWrapCmd sh -c for length-1)
      {
        const o = await be.exec({ cmd: ['echo hi | tr a-z A-Z'] });
        check('docker exec piped "echo hi | tr a-z A-Z" → "HI"', o.stdout.trim() === 'HI',
          `stdout=${JSON.stringify(o.stdout)} stderr=${JSON.stringify(o.stderr)}`);
      }

      // non-zero exit is data, not a throw
      {
        const o = await be.exec({ cmd: ['sh', '-c', 'echo out; exit 7'] });
        check('docker exec non-zero exit is data (exit 7)', o.exitCode === 7 && o.stdout.trim() === 'out',
          `exit=${o.exitCode} stdout=${JSON.stringify(o.stdout)}`);
      }

      // bind-mounted workspace fs: write via local fs, read inside container
      {
        await be.writeFile('mnt.txt', Buffer.from('mounted-ok'));
        const o = await be.exec({ cmd: ['cat /workspace/mnt.txt'] });
        check('docker bind-mount fs visible in container', o.stdout.trim() === 'mounted-ok',
          `stdout=${JSON.stringify(o.stdout)}`);
      }

      // cwd resolution: workspace-relative cwd maps under /workspace
      {
        await be.writeFile('cdir/here.txt', Buffer.from('y'));
        const o = await be.exec({ cmd: ['pwd; ls'], cwd: 'cdir' });
        check('docker exec cwd resolves under /workspace', o.stdout.includes('/workspace/cdir') && o.stdout.includes('here.txt'),
          `stdout=${JSON.stringify(o.stdout)}`);
      }

      // in-container timeout backstop maps exit 124 → [timed out]
      {
        const t0 = Date.now();
        const o = await be.exec({ cmd: ['sleep 30'], timeoutMs: 800 });
        const dt = Date.now() - t0;
        check('docker exec timeout returns promptly + [timed out]', dt < 4000 && o.stderr.includes('[timed out]'),
          `elapsed=${dt}ms stderr=${JSON.stringify(o.stderr)}`);
      }

      // docker session round-trip
      {
        const id = await be.spawnSession({ cmd: [] });
        await be.writeStdin(id, Buffer.from('echo dsess\n'));
        await sleep(600);
        const chunk = await be.readSession(id, 0);
        check('docker session readSession contains "dsess"', chunk.data.toString().includes('dsess'),
          `data=${JSON.stringify(chunk.data.toString())}`);
        await be.killSession(id);
      }

      // teardown removes container
      const cid = be.container;
      await be.teardown();
      check('docker teardown clears containerId', be.container === '', `cid=${be.container}`);
      {
        const { stdout } = await execFileAsync('docker', ['ps', '-a', '--filter', `id=${cid}`, '-q']);
        check('docker container removed after teardown', stdout.trim().length === 0, `q=${JSON.stringify(stdout.trim())}`);
      }
    }
  } else {
    skip('live docker exec', dockerUp ? 'no usable image' : 'docker unavailable');
    // Verify the downgrade paths instead.
    const r = await resolve('docker', 'definitely-not-a-real-image:nope-' + Date.now());
    check('resolve(docker, bogus image) downgrades to local', r.chosen === 'local' && !!r.warn,
      JSON.stringify(r));
    // DockerBackend.exec with unset containerId degrades to local exec
    const work = path.join(os.tmpdir(), 'kanti-be-test', 'docker-degrade-' + Date.now().toString(36));
    const be = new DockerBackend('alpine:latest', work);
    const o = await be.exec({ cmd: ['echo degraded'] });
    check('DockerBackend.exec (unprovisioned) degrades to local', o.stdout.trim() === 'degraded',
      `stdout=${JSON.stringify(o.stdout)}`);
    await be.teardown();
  }

  // Always verify: DockerBackend.exec before provision degrades to local (even in live mode).
  {
    const work = path.join(os.tmpdir(), 'kanti-be-test', 'docker-degrade2-' + Date.now().toString(36));
    const be = new DockerBackend('alpine:latest', work);
    const o = await be.exec({ cmd: ['echo predegrade'] });
    check('DockerBackend.exec before provision degrades to local', o.stdout.trim() === 'predegrade',
      `stdout=${JSON.stringify(o.stdout)}`);
    await be.teardown();
  }
}

async function main(): Promise<void> {
  await localSuite();
  await dockerSuite();
  console.log(results.join('\n'));
  console.log('');
  console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
  console.log(`VERDICT: ${fail === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoketest crashed:', e);
  process.exit(2);
});
