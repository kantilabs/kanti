// IPC surface for the exec-backend, registered from main.ts. Owns one process-wide
// BackendManager. The renderer's backend store / BackendSelector drive select +
// status; the chat Agent (next phase) drives exec. Proxy context (URL + CA path)
// is injected via getProxyContext so this module stays decoupled from go-backend.
import type { IpcMain } from 'electron';
import { BackendManager } from './manager';
import type { SelectOpts, BackendStatus } from './manager';
import type { ExecParams } from './backend';
import { resolve } from './resolve';

export interface BackendIpcOptions {
  /** Supplies the current scope-proxy URL + CA file so selected backends route
   *  agent egress through the proxy. Called on select; failures are ignored. */
  getProxyContext?: () => Promise<{ proxyUrl?: string; proxyCAFile?: string }>;
}

/** The single manager instance, shared with the agent phase via getBackendManager. */
let manager: BackendManager | null = null;

/** Accessor so the agent phase reuses the SAME provisioned backend as the IPC. */
export function getBackendManager(): BackendManager {
  if (!manager) manager = new BackendManager();
  return manager;
}

export function registerBackendIpc(ipcMain: IpcMain, options: BackendIpcOptions = {}): void {
  const mgr = getBackendManager();

  const withProxy = async (opts: SelectOpts): Promise<SelectOpts> => {
    // Only auto-fill proxy context the caller didn't already specify.
    if (opts.proxyUrl || opts.proxyCAFile || !options.getProxyContext) return opts;
    try {
      const ctx = await options.getProxyContext();
      return { ...opts, proxyUrl: ctx.proxyUrl, proxyCAFile: ctx.proxyCAFile };
    } catch {
      return opts;
    }
  };

  // list: the selectable kinds + whether docker is currently usable (so the UI can
  // show a downgrade hint before the user picks it).
  ipcMain.handle('backend:list', async () => {
    const dockerProbe = await resolve('docker');
    return [
      { kind: 'local', available: true },
      { kind: 'docker', available: dockerProbe.chosen === 'docker', warn: dockerProbe.warn },
    ];
  });

  ipcMain.handle('backend:select', async (_e, kind: 'local' | 'docker', opts: SelectOpts = {}): Promise<BackendStatus> => {
    return mgr.select(kind, await withProxy(opts));
  });

  ipcMain.handle('backend:status', async (): Promise<BackendStatus> => mgr.status());

  ipcMain.handle('backend:provision', async (): Promise<BackendStatus> => mgr.provision());

  ipcMain.handle('backend:teardown', async (): Promise<BackendStatus> => {
    await mgr.teardown();
    return mgr.status();
  });

  ipcMain.handle('backend:exec', async (_e, params: ExecParams) => mgr.exec(params));
}
