// DockerBackend drives a per-run container through the `docker` CLI (not
// dockerode — no heavy SDK dependency). The container is the security boundary;
// workspace I/O is served from a bind-mounted host dir via an embedded
// LocalBackend, which is also the degrade target when exec runs before provision.
// Ported from internal/executor/docker.go (simplified: no Snapshot/commit, no
// orphan-PID reaping label scheme kept minimal, PortMap best-effort). Kept
// electron-free at import: it only uses the embedded LocalBackend's lazy paths.
import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_TOOLBOX_IMAGE, timeoutMs, maxBytes, truncate } from './backend';
import type {
  Backend,
  RunSpec,
  ExecParams,
  ExecOutput,
  ExecEvent,
  ExecCapabilities,
  SessionChunk,
  DirEntry,
} from './backend';
import { LocalBackend, killGroup, streamChild } from './local';

const execFileAsync = promisify(execFile);

interface DockerSession {
  child: ChildProcess;
  chunks: Buffer[];
  done: boolean;
}

let sessionCounter = 0;
function newSessionId(): string {
  sessionCounter += 1;
  return `dsess-${Date.now().toString(36)}-${sessionCounter}`;
}

export class DockerBackend implements Backend {
  private containerId = '';
  private image: string;
  private local: LocalBackend;
  private localReady = false;
  private sessions = new Map<string, DockerSession>();

  constructor(image = DEFAULT_TOOLBOX_IMAGE, workDir = '') {
    this.image = image || DEFAULT_TOOLBOX_IMAGE;
    this.local = new LocalBackend(workDir);
  }

  async provision(spec: RunSpec): Promise<void> {
    const img = spec.image || this.image;
    this.image = img;
    // Prepare the bind-mounted workspace (also the local-degrade fallback root).
    await this.local.provision(spec);
    this.localReady = true;
    const args = provisionArgs(spec, img, this.local.workDir, process.pid);
    const { stdout } = await execFileAsync('docker', args, { maxBuffer: 1 << 20 });
    this.containerId = stdout.trim();
  }

  async teardown(): Promise<void> {
    for (const s of this.sessions.values()) killGroup(s.child);
    this.sessions.clear();
    if (this.containerId) {
      try {
        await execFileAsync('docker', ['rm', '-f', this.containerId]);
      } catch {
        /* best-effort */
      }
      this.containerId = '';
    }
    await this.local.teardown();
  }

  /** ensureLocal provisions the embedded LocalBackend on-demand so the
   *  degrade-to-local path works even if exec is called before provision. */
  private async ensureLocal(): Promise<LocalBackend> {
    if (!this.localReady) {
      await this.local.provision({ workDir: '', runId: '', image: this.image });
      this.localReady = true;
    }
    return this.local;
  }

  async exec(p: ExecParams): Promise<ExecOutput> {
    if (!p.cmd || p.cmd.length === 0) throw new Error('empty command');
    if (!this.containerId) return (await this.ensureLocal()).exec(p); // not provisioned: degrade to local
    const start = Date.now();
    const cap = maxBytes(p);
    const to = timeoutMs(p);
    const backstop = Math.floor(to / 1000) + 3;
    const args = ['exec', ...execFlags(p)];
    if (p.stdin) args.push('-i');
    args.push(this.containerId, ...dockerWrapCmd(p, backstop));

    const child = spawn('docker', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (p.stdin) child.stdin?.write(p.stdin);
    child.stdin?.end();

    let stdout = '';
    let stderr = '';
    let truncated = false;
    child.stdout?.on('data', (b: Buffer) => {
      if (stdout.length < cap) stdout += b.toString('utf8');
      else truncated = true;
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });

    return await new Promise<ExecOutput>((resolve) => {
      let timedOut = false;
      let spawnErr: Error | null = null;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(child);
      }, to);

      child.on('error', (err) => {
        spawnErr = err;
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        let exitCode = code == null ? (signal ? 137 : 127) : code;
        if (stdout.length > cap) {
          stdout = truncate(stdout, cap);
          truncated = true;
        }
        if (timedOut) {
          truncated = true;
          stderr += '\n[timed out]';
        } else if (exitCode === 124) {
          // in-container `timeout` backstop fired
          truncated = true;
          stderr += '\n[timed out]';
        }
        if (spawnErr && !timedOut) {
          stderr += '\n' + spawnErr.message;
          exitCode = 127;
        }
        resolve({ stdout, stderr, exitCode, truncated, elapsedMs: Date.now() - start });
      });
    });
  }

  async *execStream(p: ExecParams): AsyncIterable<ExecEvent> {
    if (!p.cmd || p.cmd.length === 0) throw new Error('empty command');
    if (!this.containerId) {
      yield* (await this.ensureLocal()).execStream(p); // not provisioned: degrade to local
      return;
    }
    const backstop = Math.floor(timeoutMs(p) / 1000) + 3;
    const args = ['exec', ...execFlags(p)];
    if (p.stdin) args.push('-i');
    args.push(this.containerId, ...dockerWrapCmd(p, backstop));
    const child = spawn('docker', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (p.stdin) child.stdin?.write(p.stdin);
    child.stdin?.end();
    yield* streamChild(child);
  }

  async spawnSession(p: ExecParams): Promise<string> {
    if (!this.containerId) return (await this.ensureLocal()).spawnSession(p); // degrade to local
    const cmd = p.cmd && p.cmd.length ? p : { ...p, cmd: ['sh', '-i'] };
    const args = ['exec', '-i', ...execFlags(cmd), this.containerId, ...dockerWrapCmd(cmd, 0)];
    const child = spawn('docker', args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const sess: DockerSession = { child, chunks: [], done: false };
    child.stdout?.on('data', (b: Buffer) => sess.chunks.push(b));
    child.stderr?.on('data', (b: Buffer) => sess.chunks.push(b));
    child.on('close', () => {
      sess.done = true;
    });
    const id = newSessionId();
    this.sessions.set(id, sess);
    return id;
  }

  async writeStdin(id: string, data: Buffer): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    s.child.stdin?.write(data);
  }

  async readSession(id: string, since: number): Promise<SessionChunk> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    const data = Buffer.concat(s.chunks);
    if (since > data.length) since = data.length;
    return { data: data.subarray(since), cursor: data.length, done: s.done };
  }

  async killSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    if (s) killGroup(s.child);
  }

  // Workspace I/O is served from the bind-mounted host dir via the embedded Local.
  readFile(p: string): Promise<Buffer> {
    return this.local.readFile(p);
  }
  writeFile(p: string, data: Buffer): Promise<void> {
    return this.local.writeFile(p, data);
  }
  listDir(p: string): Promise<DirEntry[]> {
    return this.local.listDir(p);
  }

  /** Maps a workspace-relative path to its in-container path under /workspace
   *  (absolute paths pass through). */
  resolvePath(rel: string): string {
    return containerCwd(rel) || '/workspace';
  }

  capabilities(): ExecCapabilities {
    return { pty: false, rawSockets: true, persistent: true };
  }

  /** Container id (empty until provisioned / after teardown). Exposed for status. */
  get container(): string {
    return this.containerId;
  }
}

/**
 * provisionArgs builds the `docker run` argv for the run container. Pure (no docker
 * probes, no globals besides the passed pid) so it is unit-testable.
 */
export function provisionArgs(spec: RunSpec, image: string, workMount: string, pid: number): string[] {
  const args = ['run', '-d', '--rm', '-w', '/workspace', '-v', `${workMount}:/workspace`];
  args.push('--label', `kanti.toolbox=1`, '--label', `kanti.pid=${pid}`);
  if (spec.runId) args.push('--label', `kanti.run=${spec.runId}`);
  if (spec.memory) args.push('--memory', spec.memory);
  if (spec.pidsLimit && spec.pidsLimit > 0) args.push('--pids-limit', String(spec.pidsLimit));
  if (spec.cpus) args.push('--cpus', spec.cpus);
  // Publish container ports to the HOST LOOPBACK only (never 0.0.0.0). host-port
  // 0/undefined = kernel-assigned.
  for (const pp of spec.publishPorts ?? []) {
    if (!pp.containerPort || pp.containerPort <= 0) continue;
    const host = pp.hostPort && pp.hostPort > 0 ? String(pp.hostPort) : '';
    args.push('-p', `127.0.0.1:${host}:${pp.containerPort}`);
  }
  args.push('--add-host', 'host.docker.internal:host-gateway');
  // Mirror the local backend: WORKSPACE points at the mounted scratch dir.
  args.push('-e', 'WORKSPACE=/workspace');
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push('-e', `${k}=${v}`);
  if (spec.proxyUrl) {
    // The proxy listens on the host loopback; from inside the container that is
    // reachable as host.docker.internal (wired via --add-host above).
    const purl = dockerProxyURL(spec.proxyUrl);
    args.push(
      '-e', `http_proxy=${purl}`, '-e', `https_proxy=${purl}`,
      '-e', `HTTP_PROXY=${purl}`, '-e', `HTTPS_PROXY=${purl}`,
      '-e', 'NO_PROXY=localhost,127.0.0.1,::1', '-e', 'no_proxy=localhost,127.0.0.1,::1',
    );
    if (spec.proxyCAFile) {
      const caPath = '/etc/kanti-proxy-ca.pem';
      args.push(
        '-v', `${spec.proxyCAFile}:${caPath}:ro`,
        '-e', `SSL_CERT_FILE=${caPath}`, '-e', `CURL_CA_BUNDLE=${caPath}`,
        '-e', `REQUESTS_CA_BUNDLE=${caPath}`, '-e', `NODE_EXTRA_CA_CERTS=${caPath}`,
        '-e', `GIT_SSL_CAINFO=${caPath}`,
      );
    }
  }
  args.push(image, 'sleep', 'infinity');
  return args;
}

/**
 * dockerProxyURL rewrites a host-loopback proxy URL to the address the container
 * reaches the host at (host.docker.internal, wired via --add-host).
 */
export function dockerProxyURL(url: string): string {
  return url.replace(/127\.0\.0\.1/g, 'host.docker.internal').replace(/localhost/g, 'host.docker.internal');
}

/** execFlags builds the per-exec `docker exec` flags: -w (cwd), -e (env), and a
 *  per-agent proxy override (rewritten to host.docker.internal). */
export function execFlags(p: ExecParams): string[] {
  const f: string[] = [];
  const c = containerCwd(p.cwd ?? '');
  if (c) f.push('-w', c);
  for (const [k, v] of Object.entries(p.env ?? {})) f.push('-e', `${k}=${v}`);
  if (p.proxyUrl) {
    const purl = dockerProxyURL(p.proxyUrl);
    f.push('-e', `http_proxy=${purl}`, '-e', `https_proxy=${purl}`, '-e', `HTTP_PROXY=${purl}`, '-e', `HTTPS_PROXY=${purl}`);
  }
  return f;
}

/** containerCwd resolves a workspace-relative cwd to a container path under
 *  /workspace (absolute paths pass through, empty stays empty). */
export function containerCwd(cwd: string): string {
  if (!cwd) return '';
  if (cwd.startsWith('/')) return cwd;
  return '/workspace/' + cwd;
}

/**
 * dockerWrapCmd builds the in-container argv, mirroring the CMD CONVENTION: a
 * single element is a shell string (`sh -c`); multiple elements are direct argv.
 * When backstopSecs>0 the command is wrapped with `timeout` so a killed docker-exec
 * client cannot orphan the in-container process tree.
 */
export function dockerWrapCmd(p: ExecParams, backstopSecs: number): string[] {
  let c: string[];
  if (p.cmd.length === 1) c = ['sh', '-c', p.cmd[0]];
  else c = [...p.cmd];
  if (backstopSecs > 0) c = ['timeout', String(backstopSecs), ...c];
  return c;
}
