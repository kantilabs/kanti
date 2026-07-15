// LocalBackend runs commands directly on the host inside a scoped workDir. It is
// the no-Docker fallback; it carries NO host sandbox, so it is for development and
// authorized local use only — scope/SSRF enforcement still happens at the proxy.
// Ported from internal/executor/local.go (simplified: no Snapshot/Restore, no
// proxy-shim scripts). Kept electron-free at import time: the app path is only
// touched lazily inside provision() when no workDir was injected, so this file is
// unit-testable under `npx tsx`.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { timeoutMs, maxBytes, truncate } from './backend';
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

interface LocalSession {
  child: ChildProcess;
  chunks: Buffer[];
  done: boolean;
}

let sessionCounter = 0;
function newSessionId(prefix: string): string {
  sessionCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${sessionCounter}`;
}

/**
 * defaultWorkDir resolves the scoped workspace for a run when none is injected.
 * `electron` is required LAZILY (inside this function only) so importing local.ts
 * under plain Node/tsx never loads electron. Falls back to os.tmpdir when electron
 * is unavailable (e.g. unit tests).
 */
function defaultWorkDir(runId: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'kanti-agents', runId || 'default');
    }
  } catch {
    // electron not loaded (tsx/unit-test context) — fall through to tmp.
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os');
  return path.join(os.tmpdir(), 'kanti-agents', runId || 'default');
}

export class LocalBackend implements Backend {
  private work: string;
  private proxyUrl = '';
  private caFile = '';
  private sessions = new Map<string, LocalSession>();

  /** workDir may be injected (unit tests / explicit config). Empty defers to
   *  defaultWorkDir at provision time. */
  constructor(workDir = '') {
    this.work = workDir;
  }

  async provision(spec: RunSpec): Promise<void> {
    this.proxyUrl = spec.proxyUrl ?? '';
    this.caFile = spec.proxyCAFile ?? '';
    if (spec.workDir) this.work = spec.workDir;
    if (!this.work) this.work = defaultWorkDir(spec.runId);
    await fs.mkdir(this.work, { recursive: true });
  }

  async teardown(): Promise<void> {
    for (const s of this.sessions.values()) killGroup(s.child);
    this.sessions.clear();
  }

  async exec(p: ExecParams): Promise<ExecOutput> {
    if (!p.cmd || p.cmd.length === 0) throw new Error('empty command');
    const start = Date.now();
    const cap = maxBytes(p);
    const { file, args } = wrapCmd(p);
    const child = spawn(file, args, {
      cwd: this.execCwd(p),
      env: this.buildEnv(p),
      detached: true, // own process group so a timeout reaps the whole pipeline
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
      }, timeoutMs(p));

      const finish = (exitCode: number) => {
        clearTimeout(timer);
        if (stdout.length > cap) {
          stdout = truncate(stdout, cap);
          truncated = true;
        }
        if (timedOut) {
          truncated = true;
          stderr += '\n[timed out]';
        }
        if (spawnErr && !timedOut) {
          stderr += '\n' + spawnErr.message;
          exitCode = 127;
        }
        resolve({ stdout, stderr, exitCode, truncated, elapsedMs: Date.now() - start });
      };

      child.on('error', (err) => {
        spawnErr = err;
      });
      child.on('close', (code, signal) => {
        // A signalled death with no code (e.g. our SIGKILL on timeout) reports 137.
        finish(code == null ? (signal ? 137 : 127) : code);
      });
    });
  }

  async *execStream(p: ExecParams): AsyncIterable<ExecEvent> {
    if (!p.cmd || p.cmd.length === 0) throw new Error('empty command');
    const { file, args } = wrapCmd(p);
    const child = spawn(file, args, {
      cwd: this.execCwd(p),
      env: this.buildEnv(p),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (p.stdin) child.stdin?.write(p.stdin);
    child.stdin?.end();
    yield* streamChild(child);
  }

  async spawnSession(p: ExecParams): Promise<string> {
    const cmd = p.cmd && p.cmd.length ? p : { ...p, cmd: ['sh', '-i'] };
    const { file, args } = wrapCmd(cmd);
    const child = spawn(file, args, {
      cwd: this.execCwd(p),
      env: this.buildEnv(p),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const sess: LocalSession = { child, chunks: [], done: false };
    child.stdout?.on('data', (b: Buffer) => sess.chunks.push(b));
    child.stderr?.on('data', (b: Buffer) => sess.chunks.push(b));
    child.on('close', () => {
      sess.done = true;
    });
    const id = newSessionId('sess');
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

  async readFile(p: string): Promise<Buffer> {
    return fs.readFile(this.safePath(p));
  }

  async writeFile(p: string, data: Buffer): Promise<void> {
    const abs = this.safePath(p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }

  async listDir(p: string): Promise<DirEntry[]> {
    const ents = await fs.readdir(this.safePath(p), { withFileTypes: true });
    return ents.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  }

  resolvePath(rel: string): string {
    try {
      return this.safePath(rel);
    } catch {
      return this.work;
    }
  }

  capabilities(): ExecCapabilities {
    return { pty: false, rawSockets: false, persistent: true };
  }

  /** Exposed so DockerBackend can reuse the host workspace + proxy config for its
   *  bind-mounted fs and local-degrade fallback. */
  get workDir(): string {
    return this.work;
  }

  // --- helpers ---

  private execCwd(p: ExecParams): string {
    if (p.cwd) {
      try {
        return this.safePath(p.cwd);
      } catch {
        // fall through to workspace root on traversal
      }
    }
    return this.work;
  }

  /**
   * buildEnv layers, in order: the host env, the run/per-exec proxy env, WORKSPACE,
   * then per-exec env LAST (so per-agent overrides win). Later keys overwrite
   * earlier ones (unlike naive duplicate-key appending, which is unreliable).
   */
  private buildEnv(p: ExecParams): NodeJS.ProcessEnv {
    const purl = p.proxyUrl || this.proxyUrl;
    const env: NodeJS.ProcessEnv = { ...process.env };
    Object.assign(env, proxyEnv(purl, this.caFile));
    env.WORKSPACE = this.work;
    if (p.env) Object.assign(env, p.env);
    return env;
  }

  /** safePath resolves a workspace-relative path, rejecting traversal outside work. */
  private safePath(rel: string): string {
    const root = path.resolve(this.work);
    const clean = path.resolve(root, rel);
    if (clean !== root && !clean.startsWith(root + path.sep)) {
      throw new Error(`path escapes workspace: ${rel}`);
    }
    return clean;
  }
}

/**
 * wrapCmd applies the shared CMD CONVENTION: a single element is a shell command
 * string (`sh -c`) so pipes/globs/builtins work; multiple elements are a direct
 * argv with no shell reinterpretation.
 */
export function wrapCmd(p: ExecParams): { file: string; args: string[] } {
  if (p.cmd.length === 1) return { file: 'sh', args: ['-c', p.cmd[0]] };
  return { file: p.cmd[0], args: p.cmd.slice(1) };
}

/**
 * proxyEnv routes HTTP(S) egress through the scope-proxy and trusts its MITM CA.
 * Every recon tool that honors http_proxy then traverses the proxy — so
 * out-of-scope hosts are blocked and in-scope hosts are captured. localhost is
 * excluded so loopback/IPC bypasses the proxy. Returns {} when no proxy is set.
 */
export function proxyEnv(purl: string, caFile: string): Record<string, string> {
  if (!purl) return {};
  const env: Record<string, string> = {
    http_proxy: purl,
    https_proxy: purl,
    HTTP_PROXY: purl,
    HTTPS_PROXY: purl,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  };
  if (caFile) {
    // Cover the common trust-store env vars: Go tooling reads SSL_CERT_FILE; curl
    // CURL_CA_BUNDLE; python-requests REQUESTS_CA_BUNDLE; node NODE_EXTRA_CA_CERTS.
    env.SSL_CERT_FILE = caFile;
    env.CURL_CA_BUNDLE = caFile;
    env.REQUESTS_CA_BUNDLE = caFile;
    env.NODE_EXTRA_CA_CERTS = caFile;
    env.GIT_SSL_CAINFO = caFile;
  }
  return env;
}

/**
 * killGroup SIGKILLs the entire process group led by the child (negative pid),
 * reaping children spawned via `sh -c` pipelines. Falls back to killing just the
 * leader if the group kill fails (e.g. group already gone).
 */
export function killGroup(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

/**
 * streamChild adapts a spawned child's stdout/stderr/exit into an async iterable
 * of ExecEvents, backed by a promise-signalled queue. Shared by LocalBackend and
 * DockerBackend's execStream.
 */
export async function* streamChild(child: ChildProcess): AsyncIterable<ExecEvent> {
  const queue: ExecEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let ended = false;

  const push = (ev: ExecEvent) => {
    queue.push(ev);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };

  child.stdout?.on('data', (b: Buffer) => push({ kind: 'stdout', bytes: Buffer.from(b) }));
  child.stderr?.on('data', (b: Buffer) => push({ kind: 'stderr', bytes: Buffer.from(b) }));
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    push({ kind: 'exit', code: code == null ? (signal ? 137 : 127) : code });
    ended = true;
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };
  child.on('close', onExit);
  child.on('error', () => onExit(127, null));

  while (true) {
    if (queue.length) {
      const ev = queue.shift()!;
      yield ev;
      if (ev.kind === 'exit') return;
      continue;
    }
    if (ended) return;
    await new Promise<void>((r) => {
      resolveNext = r;
    });
  }
}
