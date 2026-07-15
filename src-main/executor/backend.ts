// Exec-backend abstraction for the chat Agent's tools. Ported from the harness Go
// executor (internal/executor/executor.go): one interface, two implementations —
// LOCAL (child_process on the host in a scoped workDir) and DOCKER (the `docker`
// CLI driving a per-run container). The container is the real isolation boundary;
// local is the sandboxless dev fallback. Simplified from the Go original: no
// Snapshot/Restore, no CRIU, PortMap is optional/minimal.

/**
 * RunSpec describes the container/workspace to provision. Mirrors the Go RunSpec
 * (minus NetAdmin, kept implicit here). WorkDir is the host dir mounted as the
 * run's scratch/output space; for docker it is bind-mounted at /workspace.
 */
export interface RunSpec {
  /** Docker image for the DOCKER backend. Ignored by LOCAL. Defaults to
   *  DEFAULT_TOOLBOX_IMAGE when unset. */
  image?: string;
  /** Host path used as the run's scratch/output dir (bind-mounted at /workspace
   *  under docker). Empty lets the backend choose a default. */
  workDir: string;
  /** Labels the docker container as `kanti.run=<runId>` so it can be located
   *  later by run. Empty leaves the container unlabeled (local backend ignores). */
  runId: string;
  /** Extra environment injected into every exec. */
  env?: Record<string, string>;
  /** Scope-proxy URL. When set, shell egress is routed through it (http_proxy/…). */
  proxyUrl?: string;
  /** Path to the scope-proxy CA cert (PEM). When set, the CA is trusted so HTTPS
   *  recon tools traverse the MITM proxy. */
  proxyCAFile?: string;
  /** docker --memory (e.g. "8g"). Empty omits the flag. */
  memory?: string;
  /** docker --cpus (e.g. "2"). Empty omits the flag. */
  cpus?: string;
  /** docker --pids-limit (fork-bomb guard). Zero/undefined omits the flag. */
  pidsLimit?: number;
  /** Container ports to publish to the host loopback (docker `-p
   *  127.0.0.1:host:container`). hostPort 0/undefined = kernel-assigned. */
  publishPorts?: PortPublish[];
}

/** PortPublish requests a host-loopback publish of a container port. */
export interface PortPublish {
  /** Host loopback port; 0/undefined lets the kernel assign an ephemeral one. */
  hostPort?: number;
  containerPort: number;
}

/**
 * ExecParams is a one-shot or session command. CMD CONVENTION (both backends):
 *  - cmd.length === 1 → run via `sh -c cmd[0]` so pipes/globs/builtins work.
 *  - cmd.length  >  1 → direct argv, no shell reinterpretation.
 */
export interface ExecParams {
  cmd: string[];
  /** Written to the process stdin when set. */
  stdin?: string;
  /** Working dir. Workspace-relative (resolved under workDir/`/workspace`) or
   *  absolute. Empty = the workspace root. */
  cwd?: string;
  /** Per-exec environment (last-wins over the run env / proxy env). */
  env?: Record<string, string>;
  /** Per-exec proxy override (per-agent egress). Overrides RunSpec.proxyUrl for
   *  THIS command's http(s)_proxy env. Loopback URL; docker rewrites the host. */
  proxyUrl?: string;
  /** Timeout in ms. <=0/undefined = DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Max stdout bytes captured; excess is truncated + `truncated` is set.
   *  <=0/undefined = DEFAULT_MAX_BYTES. */
  maxBytes?: number;
}

/** ExecOutput is capped one-shot output (error-as-result: a non-zero exit is
 *  data, not a thrown error). */
export interface ExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  elapsedMs: number;
}

/** A streamed exec event. `bytes` is set for stdout/stderr; `code` for exit. */
export interface ExecEvent {
  kind: 'stdout' | 'stderr' | 'exit';
  bytes?: Buffer;
  code?: number;
}

/** Incremental session output since a cursor. */
export interface SessionChunk {
  data: Buffer;
  cursor: number;
  done: boolean;
}

/** A workspace directory listing entry. */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** What a backend supports, so callers don't pick an unsupported path. */
export interface ExecCapabilities {
  pty: boolean;
  rawSockets: boolean;
  persistent: boolean;
}

/**
 * Backend is the per-run command/IO interface the Agent runs its tools on.
 * Both LocalBackend and DockerBackend implement it. Provision is lazy (the
 * BackendManager provisions on first use). Exec is error-as-result: a command
 * that exits non-zero resolves with that exit code, it does not reject.
 */
export interface Backend {
  provision(spec: RunSpec): Promise<void>;
  teardown(): Promise<void>;

  exec(p: ExecParams): Promise<ExecOutput>;
  execStream(p: ExecParams): AsyncIterable<ExecEvent>;

  spawnSession(p: ExecParams): Promise<string>;
  writeStdin(id: string, data: Buffer): Promise<void>;
  readSession(id: string, since: number): Promise<SessionChunk>;
  killSession(id: string): Promise<void>;

  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;

  /** Maps a workspace-relative path to the absolute path as seen INSIDE the
   *  execution environment (host path for local, /workspace/… for docker). */
  resolvePath(rel: string): string;

  capabilities(): ExecCapabilities;
}

/** Default one-shot timeout (120s), matching the harness. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** Default stdout cap (4 MiB, codex parity), matching the harness. */
export const DEFAULT_MAX_BYTES = 4 << 20;

/** Default docker image when RunSpec.image is unset. Users build it with
 *  `docker build -t kanti-toolbox:latest -f Dockerfile.toolbox .` (see that file). */
export const DEFAULT_TOOLBOX_IMAGE = 'kanti-toolbox:latest';

/** Resolve the effective timeout (ms) for an exec. */
export function timeoutMs(p: ExecParams): number {
  return p.timeoutMs && p.timeoutMs > 0 ? p.timeoutMs : DEFAULT_TIMEOUT_MS;
}

/** Resolve the effective stdout cap (bytes) for an exec. */
export function maxBytes(p: ExecParams): number {
  return p.maxBytes && p.maxBytes > 0 ? p.maxBytes : DEFAULT_MAX_BYTES;
}

/** Truncate `s` to `max` bytes (utf-8 length approximated by string length,
 *  matching the harness's byte-length check), appending a marker when cut. */
export function truncate(s: string, max: number): string {
  if (s.length > max) {
    return s.slice(0, max) + '\n[output truncated]';
  }
  return s;
}
