// AgentManager (MAIN): one AgentSession per conversationId. Bridges the loop's
// AgentEvents to the renderer (webContents.send('agent:event', {conversationId, ...}))
// and threads the run's ToolCtx facts (proxy base, project manager, exec backend).
// Lazily selects the chosen exec backend on first message so the agent's shell/fs
// tools run on the SAME backend the user picked in the BackendSelector.

import { BrowserWindow } from 'electron';
import { AgentSession } from './loop';
import type { AgentEvent } from './types';
import type { Provider } from './providers';
import { streamAgent } from './providers';
import { assembleSystem } from './system';
import { getToolSchemas } from '../tools/registry';
import { getBackendManager } from '../executor/ipc';

export interface AgentRunCfg {
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  backend?: 'local' | 'docker';
  autoApproveReadOnly?: boolean;
  maxTurns?: number;
}

export interface AgentManagerOpts {
  /** The window to deliver agent:event on (falls back to any live window). */
  getWindow: () => BrowserWindow | null;
  /** go-backend proxy API base for the kanti_proxy_* tools. */
  getProxyBaseUrl?: () => string;
  /** In-process ProjectManager accessor for the kanti_project_* tools. */
  getProjectManager?: () => any;
}

interface Entry {
  session: AgentSession;
  controller: AbortController;
}

export class AgentManager {
  private sessions = new Map<string, Entry>();

  constructor(private opts: AgentManagerOpts) {}

  /** Send a message to a conversation: create + start a session on first message,
   *  otherwise enqueue onto the live one. */
  async sendMessage(convId: string, text: string, cfg: AgentRunCfg): Promise<void> {
    const existing = this.sessions.get(convId);
    if (existing) {
      existing.session.enqueueUserMessage(text);
      return;
    }

    // Point the shared backend at the user's chosen kind (provisioned lazily on
    // the first exec/fs tool). Best-effort — a select failure still lets chat run.
    if (cfg.backend) {
      try {
        await getBackendManager().select(cfg.backend);
      } catch {
        /* keep going; default local backend will provision on demand */
      }
    }

    const proxyBaseUrl = this.opts.getProxyBaseUrl?.() || 'http://localhost:9090';
    const system = assembleSystem({
      appName: 'kanti',
      execBackend: cfg.backend || 'local',
      availableTools: getToolSchemas().map((t) => t.name),
    });

    const session = new AgentSession({
      streamAgent,
      provider: cfg.provider,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      system,
      tools: getToolSchemas(),
      autoApproveReadOnly: !!cfg.autoApproveReadOnly,
      maxTurns: cfg.maxTurns,
      proxyBaseUrl,
      getProjectManager: this.opts.getProjectManager,
      onEvent: (ev) => this.deliver(convId, ev),
    });

    const controller = new AbortController();
    this.sessions.set(convId, { session, controller });
    session.enqueueUserMessage(text);

    // The run stays alive across quiet turns (KeepAlive); it returns only on
    // finish / abort / error / max-turns. Drop the entry then so a later message
    // starts a fresh session.
    void session
      .run(controller)
      .catch(() => {
        /* run already surfaced its own error event */
      })
      .finally(() => {
        if (this.sessions.get(convId)?.session === session) this.sessions.delete(convId);
      });
  }

  stop(convId: string): void {
    this.sessions.get(convId)?.controller.abort();
  }

  resolveApproval(convId: string, toolCallId: string, verdict: 'allow' | 'deny'): void {
    this.sessions.get(convId)?.session.resolveApproval(toolCallId, verdict);
  }

  getState(convId: string): any {
    const e = this.sessions.get(convId);
    return e ? e.session.getState() : { running: false };
  }

  private deliver(convId: string, ev: AgentEvent): void {
    const win = this.opts.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent:event', { conversationId: convId, ...ev });
    }
  }
}
