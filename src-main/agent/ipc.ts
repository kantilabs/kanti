// Agent IPC (MAIN). registerAgentIpc wires the AgentManager to ipcMain handlers the
// renderer's electronAPI.agent calls. Events flow the other way — the manager pushes
// 'agent:event' via webContents.send, which preload re-broadcasts to onEvent.
import type { IpcMain } from 'electron';
import { AgentManager } from './manager';
import type { AgentManagerOpts, AgentRunCfg } from './manager';

export function registerAgentIpc(ipcMain: IpcMain, opts: AgentManagerOpts): AgentManager {
  const manager = new AgentManager(opts);

  ipcMain.handle('agent:sendMessage', async (_e, convId: string, text: string, cfg: AgentRunCfg) => {
    await manager.sendMessage(convId, text, cfg);
    return { ok: true };
  });

  ipcMain.handle('agent:stop', async (_e, convId: string) => {
    manager.stop(convId);
    return { ok: true };
  });

  ipcMain.handle('agent:resolveApproval', async (_e, convId: string, id: string, verdict: 'allow' | 'deny') => {
    manager.resolveApproval(convId, id, verdict);
    return { ok: true };
  });

  ipcMain.handle('agent:getState', async (_e, convId: string) => manager.getState(convId));

  return manager;
}
