// Tool dispatch (MAIN) — the in-process rewrite of the paid executor
// (app/src-renderer/lib/tools/executor.ts). Where the paid version reached the
// go-backend / project / repeater through the renderer's window.electronAPI, this
// runs entirely in the Electron main process:
//   - kanti_proxy_*   → electron `net.fetch` against ctx.proxyBaseUrl + /api/proxy/...
//   - kanti_repeater_ → node http/https in-process (same path main.ts's 'send-request'
//                       IPC handler uses), no renderer round-trip.
//   - kanti_project_* → the in-process ProjectManager (ctx.getProjectManager()).
//   - kanti_encode/decode → node Buffer (no atob/btoa/document in main).
//   - agent_shell_*   → the Phase-4 BackendManager (getBackendManager()).
//   - agent_fs_*      → the active backend's readFile/writeFile/listDir.
//   - finish          → marks ctx.finished and stores the summary.
// dispatch NEVER throws: every failure is returned as ToolResult{success:false,error}.

import type { ToolCall, ToolResult, ToolCtx } from './types';
import { getToolSchema, hasToolWithName } from './registry';
import { getBackendManager } from '../executor/ipc';

/** Default go-backend proxy API base, matching the paid executor. */
const DEFAULT_PROXY_BASE = 'http://localhost:9090';

/**
 * dispatch executes a single tool call in MAIN. It first enforces the approval gate
 * (requiresApproval tools ask ctx.requestApproval, unless readOnly + autoApproveReadOnly),
 * then routes by name prefix. All errors are captured into a failure ToolResult.
 */
export async function dispatch(ctx: ToolCtx, call: ToolCall): Promise<ToolResult> {
  const { name } = call;
  const parameters = call.parameters || {};

  const schema = getToolSchema(name);
  if (!schema || !hasToolWithName(name)) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  // Approval gate.
  const autoApproved = !!schema.readOnly && ctx.autoApproveReadOnly;
  if (schema.requiresApproval && !autoApproved) {
    try {
      const decision = await ctx.requestApproval(call);
      if (decision !== 'allow') {
        return { success: false, error: `Tool call denied by user: ${name}` };
      }
    } catch (error) {
      return { success: false, error: approvalErr(error) };
    }
  }

  try {
    if (name.startsWith('kanti_proxy_')) {
      return await dispatchProxy(ctx, name, parameters);
    } else if (name.startsWith('kanti_repeater_')) {
      return await dispatchRepeater(name, parameters);
    } else if (name.startsWith('kanti_project_')) {
      return await dispatchProject(ctx, name);
    } else if (name === 'kanti_encode' || name === 'kanti_decode') {
      return dispatchEncoding(name, parameters);
    } else if (name.startsWith('agent_shell_')) {
      return await dispatchShell(name, parameters);
    } else if (name.startsWith('agent_fs_')) {
      return await dispatchFs(name, parameters);
    } else if (name === 'finish') {
      ctx.finished = true;
      ctx.finishMsg = String(parameters.summary ?? '');
      return { success: true, data: { summary: ctx.finishMsg }, message: 'Agent finished' };
    }
    return { success: false, error: `No dispatch implemented for tool: ${name}` };
  } catch (error) {
    return { success: false, error: errMsg(error) };
  }
}

// --- proxy: electron net.fetch against the go-backend ------------------------

async function dispatchProxy(
  ctx: ToolCtx,
  name: string,
  parameters: Record<string, any>,
): Promise<ToolResult> {
  const base = ctx.proxyBaseUrl || DEFAULT_PROXY_BASE;

  switch (name) {
    case 'kanti_proxy_start': {
      const port = parameters.port || 8080;
      const data = await proxyFetch(base, '/api/proxy/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port }),
      });
      if (!data.success) return { success: false, error: data.error };
      return { success: true, data: data.data, message: `Proxy started on port ${data.data?.port}` };
    }

    case 'kanti_proxy_stop': {
      const data = await proxyFetch(base, '/api/proxy/stop', { method: 'POST' });
      if (!data.success) return { success: false, error: data.error };
      return { success: true, data: data.data, message: 'Proxy stopped' };
    }

    case 'kanti_proxy_status': {
      const data = await proxyFetch(base, '/api/proxy/status', { method: 'GET' });
      if (!data.success) return { success: false, error: data.error };
      return {
        success: true,
        data: data.data,
        message: `Proxy is ${data.data?.isRunning ? 'running' : 'stopped'}`,
      };
    }

    case 'kanti_proxy_get_requests': {
      const data = await proxyFetch(base, '/api/proxy/requests', { method: 'GET' });
      if (!data.success) return { success: false, error: data.error };
      let requests = data.data || [];
      if (parameters.filter) {
        const filterLower = String(parameters.filter).toLowerCase();
        requests = requests.filter((req: any) => {
          const url = `${req.method} ${req.url}`.toLowerCase();
          const host = (req.host || '').toLowerCase();
          return url.includes(filterLower) || host.includes(filterLower);
        });
      }
      if (parameters.limit && parameters.limit > 0) {
        requests = requests.slice(0, parameters.limit);
      }
      return { success: true, data: requests, message: `Found ${requests.length} requests` };
    }

    case 'kanti_proxy_clear_requests': {
      const data = await proxyFetch(base, '/api/proxy/clear', { method: 'POST' });
      if (!data.success) return { success: false, error: data.error };
      return { success: true, message: 'All requests cleared' };
    }

    case 'kanti_proxy_set_scope': {
      const data = await proxyFetch(base, '/api/proxy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inScope: parameters.inScope || [],
          outOfScope: parameters.outOfScope || [],
        }),
      });
      if (!data.success) return { success: false, error: data.error };
      return {
        success: true,
        data: data.data,
        message: `Scope updated: ${(parameters.inScope || []).length} domains in scope`,
      };
    }

    case 'kanti_proxy_get_scope': {
      const data = await proxyFetch(base, '/api/proxy/config', { method: 'GET' });
      if (!data.success) return { success: false, error: data.error };
      return {
        success: true,
        data: { inScope: data.data?.inScope || [], outOfScope: data.data?.outOfScope || [] },
        message: 'Scope settings retrieved',
      };
    }

    case 'kanti_proxy_export_certificate': {
      const data = await proxyFetch(base, '/api/proxy/status', { method: 'GET' });
      if (!data.success) return { success: false, error: data.error };
      return {
        success: true,
        data: { certificatePath: data.data?.certificatePath },
        message: `Certificate available at: ${data.data?.certificatePath}`,
      };
    }

    default:
      return { success: false, error: `Unknown proxy tool: ${name}` };
  }
}

/** Perform a JSON go-backend request over electron net and parse the {success,...} body. */
async function proxyFetch(base: string, path: string, init: any): Promise<any> {
  // Lazily require electron so this module is importable under plain node/tsx.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { net } = require('electron');
  const res = await net.fetch(base + path, init);
  return res.json();
}

// --- repeater: node http/https in-process ------------------------------------

async function dispatchRepeater(name: string, parameters: Record<string, any>): Promise<ToolResult> {
  if (name !== 'kanti_repeater_send') {
    return { success: false, error: `Unknown repeater tool: ${name}` };
  }

  const request = {
    method: parameters.method,
    protocol: parameters.protocol || 'https',
    host: parameters.host,
    path: parameters.path,
    headers: parameters.headers || {},
    body: parameters.body || '',
  };

  const result = await sendHttpRequest(request);
  return {
    success: true,
    data: result,
    message: `Request sent: ${request.method} ${request.host}${request.path} - Status ${result.status}`,
  };
}

/**
 * sendHttpRequest reuses main.ts's 'send-request' IPC handler logic in-process:
 * node http/https, no cert validation, gzip/deflate/br decompression of the body.
 * Rejects on transport error so the dispatch try/catch turns it into a ToolResult.
 */
function sendHttpRequest(request: {
  method: string;
  protocol: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; headers: any; body: string; time: number; size: number }> {
  return new Promise(async (resolve, reject) => {
    try {
      const https = await import('node:https');
      const http = await import('node:http');
      const { parse } = await import('node:url');

      const protocol = request.protocol === 'https' ? https : http;
      const parsedUrl = parse(`${request.protocol}://${request.host}${request.path}`);

      const options: any = {
        hostname: request.host.split(':')[0],
        port: parsedUrl.port || (request.protocol === 'https' ? 443 : 80),
        path: request.path,
        method: request.method,
        headers: request.headers || {},
        rejectUnauthorized: false,
      };

      const startTime = Date.now();
      const req = protocol.request(options, (res: any) => {
        const chunks: Buffer[] = [];
        let responseSize = 0;
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          responseSize += chunk.length;
        });
        res.on('end', async () => {
          const responseTime = Date.now() - startTime;
          const responseBuffer = Buffer.concat(chunks);
          const contentEncoding = res.headers['content-encoding'];
          const decompressedBody = await decompressResponse(responseBuffer, contentEncoding);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: decompressedBody.toString(),
            time: responseTime,
            size: responseSize,
          });
        });
      });

      req.on('error', (error: Error) => reject(error));
      if (request.body) req.write(request.body);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** Decompress a possibly gzip/deflate/br encoded response body; passthrough otherwise. */
async function decompressResponse(buffer: Buffer, encoding?: string): Promise<Buffer> {
  if (!encoding) return buffer;
  const zlib = await import('node:zlib');
  const { promisify } = await import('node:util');
  try {
    switch (encoding) {
      case 'gzip':
        return await promisify(zlib.gunzip)(buffer);
      case 'deflate':
        return await promisify(zlib.inflate)(buffer);
      case 'br':
        return await promisify(zlib.brotliDecompress)(buffer);
      default:
        return buffer;
    }
  } catch {
    // If decompression fails, return the raw bytes rather than throwing.
    return buffer;
  }
}

// --- project: in-process ProjectManager --------------------------------------

async function dispatchProject(ctx: ToolCtx, name: string): Promise<ToolResult> {
  const pm = ctx.getProjectManager();
  if (!pm) return { success: false, error: 'Project manager not available' };

  switch (name) {
    case 'kanti_project_save': {
      const current = await pm.getCurrentProject();
      if (!current) return { success: false, error: 'No project loaded' };
      const result = await pm.saveProject(current);
      if (!result?.success) {
        return { success: false, error: result?.error || result?.canceled ? 'Save canceled' : 'Save failed' };
      }
      return { success: true, data: result, message: 'Project saved successfully' };
    }

    case 'kanti_project_get_current': {
      const project = await pm.getCurrentProject();
      return {
        success: true,
        data: project,
        message: project ? `Current project: ${project.name || 'Unnamed'}` : 'No project loaded',
      };
    }

    default:
      return { success: false, error: `Unknown project tool: ${name}` };
  }
}

// --- encoding: node Buffer ---------------------------------------------------

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_UNESCAPE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&apos;': "'",
};

function dispatchEncoding(name: string, parameters: Record<string, any>): ToolResult {
  const { data, encoding } = parameters;
  if (data === undefined || data === null) {
    return { success: false, error: 'Data parameter is required' };
  }
  const input = String(data);

  let result: string;
  if (name === 'kanti_decode') {
    switch (encoding) {
      case 'base64':
        result = Buffer.from(input, 'base64').toString('utf8');
        break;
      case 'url':
        result = decodeURIComponent(input);
        break;
      case 'html':
        result = input.replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (m) => HTML_UNESCAPE[m] ?? m);
        break;
      case 'hex':
        result = Buffer.from(input.replace(/[^0-9a-fA-F]/g, ''), 'hex').toString('utf8');
        break;
      default:
        return { success: false, error: `Unknown encoding: ${encoding}` };
    }
  } else {
    switch (encoding) {
      case 'base64':
        result = Buffer.from(input, 'utf8').toString('base64');
        break;
      case 'url':
        result = encodeURIComponent(input);
        break;
      case 'html':
        result = input.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
        break;
      case 'hex':
        result = Buffer.from(input, 'utf8').toString('hex');
        break;
      default:
        return { success: false, error: `Unknown encoding: ${encoding}` };
    }
  }

  return {
    success: true,
    data: result,
    message: `${name === 'kanti_decode' ? 'Decoded' : 'Encoded'} using ${encoding}`,
  };
}

// --- agent shell: the Phase-4 backend ----------------------------------------

async function dispatchShell(name: string, parameters: Record<string, any>): Promise<ToolResult> {
  const mgr = getBackendManager();

  if (name === 'agent_shell_exec') {
    const cmd = parameters.cmd;
    if (!cmd || typeof cmd !== 'string') {
      return { success: false, error: 'cmd (a shell command line string) is required' };
    }
    // BackendManager.exec provisions lazily. A non-zero exit is data, not an error.
    const out = await mgr.exec({ cmd: [cmd], timeoutMs: parameters.timeoutMs, cwd: parameters.cwd });
    return {
      success: true,
      data: {
        stdout: out.stdout,
        stderr: out.stderr,
        exitCode: out.exitCode,
        truncated: out.truncated,
        elapsedMs: out.elapsedMs,
      },
      message: `Command exited ${out.exitCode}`,
    };
  }

  // Session tools need a provisioned backend instance.
  await mgr.provision();
  const backend = mgr.active();
  if (!backend) return { success: false, error: 'No backend active' };

  switch (name) {
    case 'agent_shell_session_start': {
      const cmd = typeof parameters.cmd === 'string' && parameters.cmd.length ? [parameters.cmd] : [];
      const id = await backend.spawnSession({ cmd });
      return { success: true, data: { sessionId: id }, message: `Session ${id} started` };
    }

    case 'agent_shell_write': {
      const { sessionId, data } = parameters;
      if (!sessionId) return { success: false, error: 'sessionId is required' };
      await backend.writeStdin(sessionId, Buffer.from(String(data ?? ''), 'utf8'));
      return { success: true, message: `Wrote to session ${sessionId}` };
    }

    case 'agent_shell_read': {
      const { sessionId } = parameters;
      if (!sessionId) return { success: false, error: 'sessionId is required' };
      const since = typeof parameters.since === 'number' ? parameters.since : 0;
      const chunk = await backend.readSession(sessionId, since);
      return {
        success: true,
        data: { data: chunk.data.toString('utf8'), cursor: chunk.cursor, done: chunk.done },
        message: `Read ${chunk.data.length} bytes from session ${sessionId}`,
      };
    }

    case 'agent_shell_kill': {
      const { sessionId } = parameters;
      if (!sessionId) return { success: false, error: 'sessionId is required' };
      await backend.killSession(sessionId);
      return { success: true, message: `Session ${sessionId} killed` };
    }

    default:
      return { success: false, error: `Unknown shell tool: ${name}` };
  }
}

// --- agent fs: the active backend --------------------------------------------

async function dispatchFs(name: string, parameters: Record<string, any>): Promise<ToolResult> {
  const mgr = getBackendManager();
  await mgr.provision();
  const backend = mgr.active();
  if (!backend) return { success: false, error: 'No backend active' };

  switch (name) {
    case 'agent_fs_read': {
      const p = parameters.path;
      if (!p) return { success: false, error: 'path is required' };
      const buf = await backend.readFile(p);
      return {
        success: true,
        data: { path: p, content: buf.toString('utf8') },
        message: `Read ${buf.length} bytes from ${p}`,
      };
    }

    case 'agent_fs_write': {
      const p = parameters.path;
      if (!p) return { success: false, error: 'path is required' };
      const content = String(parameters.content ?? '');
      await backend.writeFile(p, Buffer.from(content, 'utf8'));
      return { success: true, data: { path: p }, message: `Wrote ${content.length} bytes to ${p}` };
    }

    case 'agent_fs_list': {
      const p = parameters.path;
      if (!p) return { success: false, error: 'path is required' };
      const entries = await backend.listDir(p);
      return { success: true, data: entries, message: `Listed ${entries.length} entries in ${p}` };
    }

    default:
      return { success: false, error: `Unknown fs tool: ${name}` };
  }
}

// --- helpers -----------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

function approvalErr(error: unknown): string {
  return `Approval request failed: ${errMsg(error)}`;
}
