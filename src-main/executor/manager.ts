// BackendManager owns the ONE active exec Backend for the app. The renderer's
// BackendSelector picks a kind; the chat Agent (next phase) runs its tools through
// exec(). Provision is lazy — the container/workspace is created on first use, not
// on select — so switching backends in the UI is cheap. Ported in spirit from how
// the harness threads a single Executor per run.
import { DEFAULT_TOOLBOX_IMAGE } from './backend';
import type { Backend, RunSpec, ExecParams, ExecOutput } from './backend';
import { LocalBackend } from './local';
import { DockerBackend } from './docker';
import { resolve } from './resolve';

export interface SelectOpts {
  /** Docker image (docker backend). Defaults to DEFAULT_TOOLBOX_IMAGE. */
  image?: string;
  /** Host workspace dir. Empty defers to the backend's default (userData/...). */
  workDir?: string;
  /** Labels the container / names the workspace subdir. */
  runId?: string;
  proxyUrl?: string;
  proxyCAFile?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
}

export interface BackendStatus {
  /** The kind actually in use after resolution (a docker request may downgrade). */
  kind: 'local' | 'docker';
  /** The kind the user requested (before any downgrade). */
  requested: 'local' | 'docker';
  provisioned: boolean;
  containerId: string;
  image: string;
  /** Downgrade explanation from resolve(), if any. */
  warning?: string;
}

export class BackendManager {
  private backend: Backend | null = null;
  private requested: 'local' | 'docker' = 'local';
  private kind: 'local' | 'docker' = 'local';
  private provisioned = false;
  private warning?: string;
  private opts: SelectOpts = {};

  /**
   * select tears down any current backend, resolves the requested kind (a docker
   * request may downgrade to local), and constructs — but does NOT provision — the
   * new backend. Returns the resulting status (including any downgrade warning).
   */
  async select(kind: 'local' | 'docker', opts: SelectOpts = {}): Promise<BackendStatus> {
    await this.teardown();
    this.requested = kind;
    this.opts = opts;
    const image = opts.image || DEFAULT_TOOLBOX_IMAGE;
    const r = await resolve(kind, image);
    this.kind = r.chosen;
    this.warning = r.warn;
    this.backend =
      r.chosen === 'docker'
        ? new DockerBackend(image, opts.workDir ?? '')
        : new LocalBackend(opts.workDir ?? '');
    this.provisioned = false;
    return this.status();
  }

  /** provision provisions the active backend if not already done (idempotent).
   *  Selects a default local backend first if select() was never called. */
  async provision(): Promise<BackendStatus> {
    if (!this.backend) await this.select('local', this.opts);
    if (!this.provisioned) {
      await this.backend!.provision(this.buildSpec());
      this.provisioned = true;
    }
    return this.status();
  }

  /** exec provisions lazily then runs a one-shot command. */
  async exec(params: ExecParams): Promise<ExecOutput> {
    await this.provision();
    return this.backend!.exec(params);
  }

  /** teardown disposes the active backend (container removed / sessions killed). */
  async teardown(): Promise<void> {
    if (this.backend && this.provisioned) {
      try {
        await this.backend.teardown();
      } catch {
        /* best-effort */
      }
    }
    this.provisioned = false;
  }

  status(): BackendStatus {
    const containerId =
      this.backend instanceof DockerBackend ? this.backend.container : '';
    return {
      kind: this.kind,
      requested: this.requested,
      provisioned: this.provisioned,
      containerId,
      image: this.opts.image || DEFAULT_TOOLBOX_IMAGE,
      warning: this.warning,
    };
  }

  /** The active backend, or null before the first select/provision. Used by the
   *  agent phase for session/stream/fs calls beyond one-shot exec. */
  active(): Backend | null {
    return this.backend;
  }

  private buildSpec(): RunSpec {
    return {
      image: this.opts.image || DEFAULT_TOOLBOX_IMAGE,
      workDir: this.opts.workDir ?? '',
      runId: this.opts.runId ?? '',
      proxyUrl: this.opts.proxyUrl,
      proxyCAFile: this.opts.proxyCAFile,
      memory: this.opts.memory,
      cpus: this.opts.cpus,
      pidsLimit: this.opts.pidsLimit,
    };
  }
}
