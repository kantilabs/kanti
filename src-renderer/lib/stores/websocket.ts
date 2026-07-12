import { writable, derived, get } from 'svelte/store';

// WebSocket capture types. These mirror the Go backend's wire shapes exactly
// (github.com/1342tools/kanti/backend/pkg/models):
//   WebSocketConnection { id, url, host, path, protocol, timestamp, status }
//   WebSocketMessage    { id, connectionId, direction, opcode, payload, length, timestamp }
// They are intentionally local to this store (not the ambient globals the paid
// build used) so they stay aligned with what FREE's Go proxy actually emits.
export interface WsConnection {
  id: string;
  url: string;
  host: string;
  path: string;
  /** "ws" (plaintext, full per-frame capture) or "wss" (TLS, handshake only). */
  protocol: 'ws' | 'wss' | string;
  timestamp: string;
  /** "open" or "closed". */
  status: 'open' | 'closed' | string;
}

export interface WsMessage {
  id: string;
  connectionId: string;
  /** "outgoing" (client -> server) or "incoming" (server -> client). */
  direction: 'outgoing' | 'incoming' | string;
  /** "text" | "binary" | "ping" | "pong" | "close". */
  opcode: string;
  payload: string;
  /** True on-wire byte length (payload may be capped for storage). */
  length: number;
  timestamp: string;
}

export interface WsFilter {
  search: string;
  status: string;
  scopeOnly: boolean;
}

// ---- Stores ----------------------------------------------------------------

// All captured connections (newest first, matching the backend ordering).
export const websocketConnections = writable<WsConnection[]>([]);

// Per-connection message cache: connectionId -> ordered messages.
// Populated lazily on selection (getWebSocketMessages) and appended to live as
// websocket-message events arrive.
export const websocketMessages = writable<Record<string, WsMessage[]>>({});

// Currently selected connection id (drives the message pane).
export const activeConnectionId = writable<string | null>(null);

export const websocketFilter = writable<WsFilter>({
  search: '',
  status: '',
  scopeOnly: false
});

// Live per-connection message counts derived from whatever is in the cache.
// Grows in real time as websocket-message events land.
export const websocketMessageCounts = derived(websocketMessages, ($byConn) => {
  const counts: Record<string, { sent: number; recv: number }> = {};
  for (const [connId, msgs] of Object.entries($byConn)) {
    let sent = 0;
    let recv = 0;
    for (const m of msgs) {
      if (m.direction === 'outgoing') sent++;
      else recv++;
    }
    counts[connId] = { sent, recv };
  }
  return counts;
});

// ---- Mutations -------------------------------------------------------------

/** Insert or update a connection (dedupe by id, newest-first ordering kept). */
export function upsertConnection(conn: WsConnection) {
  websocketConnections.update((conns) => {
    const idx = conns.findIndex((c) => c.id === conn.id);
    if (idx >= 0) {
      const next = [...conns];
      next[idx] = { ...next[idx], ...conn };
      return next;
    }
    return [conn, ...conns];
  });
}

/** Append a captured message to its connection's cache (dedupe by message id). */
export function appendMessage(msg: WsMessage) {
  websocketMessages.update((byConn) => {
    const existing = byConn[msg.connectionId] ?? [];
    if (existing.some((m) => m.id === msg.id)) return byConn;
    return { ...byConn, [msg.connectionId]: [...existing, msg] };
  });
}

/** Mark a connection closed (websocket-close carries the full connection). */
export function markClosed(conn: WsConnection) {
  websocketConnections.update((conns) => {
    const idx = conns.findIndex((c) => c.id === conn.id);
    if (idx < 0) return conns;
    const next = [...conns];
    next[idx] = { ...next[idx], ...conn, status: 'closed' };
    return next;
  });
}

export function setActiveConnection(id: string | null) {
  activeConnectionId.set(id);
}

export function updateFilter(patch: Partial<WsFilter>) {
  websocketFilter.update((f) => ({ ...f, ...patch }));
}

// ---- Backend I/O -----------------------------------------------------------

function proxyApi() {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI?.proxy;
}

/** Load the full connection list from the Go backend. */
export async function loadConnections(): Promise<void> {
  const proxy = proxyApi();
  if (!proxy) return;
  try {
    const conns = (await proxy.getWebSocketConnections()) as WsConnection[];
    websocketConnections.set(Array.isArray(conns) ? conns : []);
  } catch (err) {
    console.error('Failed to load WebSocket connections:', err);
  }
}

/** Load (and cache) the message stream for a single connection. */
export async function loadMessages(connId: string): Promise<void> {
  const proxy = proxyApi();
  if (!proxy) return;
  try {
    const msgs = (await proxy.getWebSocketMessages(connId)) as WsMessage[];
    websocketMessages.update((byConn) => ({
      ...byConn,
      [connId]: Array.isArray(msgs) ? msgs : []
    }));
  } catch (err) {
    console.error('Failed to load WebSocket messages:', err);
  }
}

/** Clear all captured WebSocket data (backend + local stores). */
export async function clearWebSockets(): Promise<void> {
  const proxy = proxyApi();
  if (proxy) {
    try {
      await proxy.clearWebSockets();
    } catch (err) {
      console.error('Failed to clear WebSocket data:', err);
    }
  }
  websocketConnections.set([]);
  websocketMessages.set({});
  activeConnectionId.set(null);
}

/** Return the cached messages for a connection (empty if not yet loaded). */
export function messagesFor(connId: string): WsMessage[] {
  return get(websocketMessages)[connId] ?? [];
}

// ---- Live SSE wiring -------------------------------------------------------
//
// The Go proxy emits websocket-connection / websocket-message / websocket-close
// over the same SSE rail as proxy-request/response batches. The Electron MAIN
// process (go-backend.ts handleEvent) re-broadcasts every SSE event to the
// renderer verbatim on a channel named after the event type. So we just
// subscribe to those three channels via electronAPI.receive — exactly how the
// requests feed already listens for proxy-*-batch. Returns a no-op cleanup.
export function initWebSocketListeners(): () => void {
  if (typeof window === 'undefined' || !window.electronAPI) return () => {};

  window.electronAPI.receive('websocket-connection', (conn: WsConnection) => {
    if (conn && conn.id) upsertConnection(conn);
  });

  window.electronAPI.receive('websocket-message', (msg: WsMessage) => {
    if (msg && msg.connectionId) appendMessage(msg);
  });

  window.electronAPI.receive('websocket-close', (conn: WsConnection) => {
    if (conn && conn.id) markClosed(conn);
  });

  // electronAPI.receive registers ipcRenderer.on with no unsubscribe handle;
  // the listeners live for the window's lifetime (same as the requests feed).
  return () => {};
}
