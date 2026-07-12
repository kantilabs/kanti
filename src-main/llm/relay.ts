// Main-process IPC relay for LLM/provider calls. The renderer cannot reach
// providers directly (CORS) and there is no server route in a packaged
// adapter-static build, so provider traffic is relayed through here via
// Electron's `net.fetch`.
import type { IpcMain } from 'electron';
import { net } from 'electron';
import * as providers from './providers';

interface RawFetchOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Register the LLM IPC handlers. Call from main.ts alongside the other
 * `registerX` handler setup.
 */
export function registerLlmIpc(ipcMain: IpcMain): void {
  // High-level: dispatch a chat request to the configured provider.
  ipcMain.handle('llm:chat', (_e, req: providers.ChatRequest) => providers.chat(req));

  // Low-level: CORS-free raw fetch escape hatch for the renderer. Returns the
  // body as text so it survives the IPC boundary.
  ipcMain.handle('llm:fetch', async (_e, { url, method, headers, body }: RawFetchOptions) => {
    const response = await net.fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  });
}

/**
 * Register the general-purpose network fetch IPC handler. Distinct from
 * `llm:fetch` (which is scoped to provider traffic): this is the arbitrary-HTTP
 * escape hatch used by automation workflows and agent tools. It additionally
 * returns the response headers as a plain object so callers can evaluate
 * header-based conditions. Call from main.ts alongside `registerLlmIpc`.
 */
export function registerNetIpc(ipcMain: IpcMain): void {
  ipcMain.handle('net:fetch', async (_e, { url, method, headers, body }: RawFetchOptions) => {
    const response = await net.fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body
    });

    // Flatten response headers into a plain object so they survive the IPC
    // boundary and are consumable by the renderer's condition evaluator.
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      headers: responseHeaders,
      body: await response.text()
    };
  });
}
