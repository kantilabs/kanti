<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { scopeStore, type ScopeSettings } from '$lib/stores/scope';
  import {
    websocketConnections,
    websocketMessages,
    activeConnectionId,
    websocketMessageCounts,
    websocketFilter,
    loadConnections,
    loadMessages,
    clearWebSockets,
    setActiveConnection,
    updateFilter,
    initWebSocketListeners,
    type WsConnection,
    type WsMessage,
    type WsFilter
  } from '$lib/stores/websocket';

  // Props (mirrors SitemapTab/AuthTab: standalone when popped into its own window).
  export let standalone = false;

  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  // Store-backed state
  let connections: WsConnection[] = [];
  let messagesByConn: Record<string, WsMessage[]> = {};
  let counts: Record<string, { sent: number; recv: number }> = {};
  let activeId: string | null = null;
  let filter: WsFilter = { search: '', status: '', scopeOnly: false };
  let scopeSettings: ScopeSettings = { inScope: [], outOfScope: [] };
  let loading = true;
  let showFilterOptions = false;
  let cleanup: () => void = () => {};

  const unsubConns = websocketConnections.subscribe((v) => (connections = v));
  const unsubMsgs = websocketMessages.subscribe((v) => (messagesByConn = v));
  const unsubCounts = websocketMessageCounts.subscribe((v) => (counts = v));
  const unsubActive = activeConnectionId.subscribe((v) => (activeId = v));
  const unsubFilter = websocketFilter.subscribe((v) => (filter = v));
  const unsubScope = scopeStore.subscribe((v: ScopeSettings) => (scopeSettings = v));

  // Selected connection + its cached messages.
  $: selectedConnection = connections.find((c) => c.id === activeId) ?? null;
  $: connectionMessages = activeId ? messagesByConn[activeId] ?? [] : [];

  // --- Scope matching (same semantics as the requests/sitemap tabs) ----------
  function isInScope(host: string): boolean {
    if (scopeSettings.inScope.includes(host)) {
      // still honour explicit out-of-scope below
    }
    const inScopeMatch =
      scopeSettings.inScope.includes(host) ||
      scopeSettings.inScope.some((pattern) => {
        if (pattern.startsWith('*.')) {
          const domain = pattern.substring(2);
          return host === domain || host.endsWith('.' + domain);
        }
        return false;
      });
    if (!inScopeMatch) return false;

    const excluded = scopeSettings.outOfScope.some((pattern) => {
      if (pattern === host) return true;
      if (pattern.startsWith('*.')) {
        const domain = pattern.substring(2);
        return host === domain || host.endsWith('.' + domain);
      }
      return false;
    });
    return !excluded;
  }

  // --- Filtering -------------------------------------------------------------
  $: filteredConnections = connections.filter((conn) => {
    if (filter.scopeOnly && !isInScope(conn.host)) return false;
    if (filter.status && conn.status && !String(conn.status).includes(filter.status)) {
      return false;
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return (
        conn.host.toLowerCase().includes(q) ||
        conn.path.toLowerCase().includes(q) ||
        conn.url.toLowerCase().includes(q)
      );
    }
    return true;
  });

  $: filterActive = filter.scopeOnly || !!filter.search || !!filter.status;

  // --- Formatting ------------------------------------------------------------
  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }
  function formatFull(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
  function directionLabel(dir: string): string {
    return dir === 'outgoing' ? '↑ Sent' : '↓ Received';
  }
  function isText(opcode: string): boolean {
    return opcode === 'text';
  }

  // --- Actions ---------------------------------------------------------------
  function selectConnection(conn: WsConnection) {
    setActiveConnection(conn.id);
    if (isElectron) loadMessages(conn.id);
  }

  async function handleClear() {
    if (!confirm('Clear all captured WebSocket data?')) return;
    await clearWebSockets();
  }

  function toggleFilterOptions() {
    showFilterOptions = !showFilterOptions;
  }

  async function loadInitialData() {
    if (!isElectron) {
      loading = false;
      return;
    }
    await loadConnections();
    loading = false;
  }

  onMount(() => {
    loadInitialData();
    if (isElectron) cleanup = initWebSocketListeners();
  });

  onDestroy(() => {
    cleanup();
    unsubConns();
    unsubMsgs();
    unsubCounts();
    unsubActive();
    unsubFilter();
    unsubScope();
  });
</script>

<div class="ws-tab" class:standalone>
  <!-- Controls -->
  <div class="request-controls">
    <div class="control-group">
      <div class="status-indicator running" title="WebSocket capture active">
        <div class="status-dot"></div>
        <span>WebSocket Capture Active</span>
      </div>

      <div class="control-buttons">
        <button class="btn btn-sm btn-danger" on:click={handleClear}>Clear</button>
        <div class="ws-filter-dropdown">
          <button
            class="btn btn-sm"
            class:btn-primary={filterActive}
            on:click={toggleFilterOptions}
          >
            Filter {filterActive ? '(Active)' : ''} <span class="dropdown-arrow">&#9662;</span>
          </button>

          {#if showFilterOptions}
            <div class="ws-filter-panel panel">
              <input
                class="input input-sm"
                type="text"
                placeholder="Search host / path / url"
                value={filter.search}
                on:input={(e) => updateFilter({ search: (e.currentTarget as HTMLInputElement).value })}
              />
              <input
                class="input input-sm"
                type="text"
                placeholder="Filter by status (open / closed)"
                value={filter.status}
                on:input={(e) => updateFilter({ status: (e.currentTarget as HTMLInputElement).value })}
              />
              <label class="filter-option">
                <input
                  type="checkbox"
                  checked={filter.scopeOnly}
                  on:change={(e) => updateFilter({ scopeOnly: (e.currentTarget as HTMLInputElement).checked })}
                />
                <span>In-scope connections only</span>
              </label>
              {#if filteredConnections.length === 0 && connections.length > 0}
                <div class="filter-warning">No connections match the current filters</div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Main panel -->
  <div class="ws-main">
    {#if loading}
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
        <div>Loading WebSocket connections&hellip;</div>
      </div>
    {/if}

    <!-- Connection list -->
    <div class="panel ws-connections">
      <div class="panel-header">
        <h3>Connections</h3>
        <span class="count-badge">{filteredConnections.length}</span>
      </div>
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Host</th>
              <th>Path</th>
              <th>Proto</th>
              <th>Status</th>
              <th>Msgs</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredConnections as conn (conn.id)}
              <tr
                class:selected={activeId === conn.id}
                on:click={() => selectConnection(conn)}
              >
                <td class="mono">{conn.host}</td>
                <td class="mono path-cell" title={conn.path}>{conn.path}</td>
                <td><span class="proto-badge proto-{conn.protocol}">{conn.protocol}</span></td>
                <td><span class="status-badge status-{conn.status}">{conn.status}</span></td>
                <td class="mono">
                  {#if counts[conn.id]}
                    <span class="dir-out">{counts[conn.id].sent}</span>/<span class="dir-in">{counts[conn.id].recv}</span>
                  {:else}
                    0/0
                  {/if}
                </td>
                <td>{formatTime(conn.timestamp)}</td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if filteredConnections.length === 0}
          <div class="empty-state">
            {#if connections.length === 0}
              <h3>No WebSocket Connections</h3>
              <p>Plaintext ws:// traffic through the proxy will appear here.</p>
            {:else}
              <p>No connections match your current filters.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Details + messages -->
    <div class="ws-detail">
      <div class="panel ws-conn-info">
        <div class="panel-header">
          <h3>Connection Details</h3>
        </div>
        <div class="panel-content">
          {#if selectedConnection}
            <div class="detail-grid">
              <div class="detail-row"><label>URL</label><span class="mono">{selectedConnection.url}</span></div>
              <div class="detail-row"><label>Host</label><span class="mono">{selectedConnection.host}</span></div>
              <div class="detail-row"><label>Path</label><span class="mono">{selectedConnection.path}</span></div>
              <div class="detail-row">
                <label>Protocol</label>
                <span class="proto-badge proto-{selectedConnection.protocol}">{selectedConnection.protocol}</span>
              </div>
              <div class="detail-row">
                <label>Status</label>
                <span class="status-badge status-{selectedConnection.status}">{selectedConnection.status}</span>
              </div>
              <div class="detail-row"><label>Created</label><span>{formatFull(selectedConnection.timestamp)}</span></div>
            </div>
            {#if selectedConnection.protocol === 'wss'}
              <div class="wss-note">
                wss:// is TLS-tunnelled: the handshake is captured, but per-frame
                payloads are not (they stay opaque inside the CONNECT tunnel).
              </div>
            {/if}
          {:else}
            <div class="empty-state"><p>Select a connection to inspect it.</p></div>
          {/if}
        </div>
      </div>

      <div class="panel ws-messages">
        <div class="panel-header">
          <h3>Messages</h3>
          {#if selectedConnection}
            <span class="count-badge">{connectionMessages.length}</span>
          {/if}
        </div>
        <div class="panel-content messages-panel">
          {#if selectedConnection}
            {#if connectionMessages.length > 0}
              <div class="messages-list">
                {#each connectionMessages as message (message.id)}
                  <div class="message-item {message.direction}">
                    <div class="message-header">
                      <span class="message-direction">{directionLabel(message.direction)}</span>
                      <span class="opcode-badge">{message.opcode}</span>
                      <span class="message-time">{formatTime(message.timestamp)}</span>
                      <span class="message-size">{message.length} B</span>
                    </div>
                    <div class="message-content">
                      {#if isText(message.opcode)}
                        <pre>{message.payload}</pre>
                      {:else}
                        <div class="binary-data">{message.opcode} frame &middot; {message.length} bytes</div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="empty-state">
                <h3>No Messages</h3>
                <p>No frames captured for this connection yet.</p>
              </div>
            {/if}
          {:else}
            <div class="empty-state"><p>Select a connection to view its messages.</p></div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .ws-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--space-sm);
    overflow: hidden;
  }

  .ws-main {
    position: relative;
    display: flex;
    gap: var(--space-sm);
    flex: 1;
    min-height: 0;
  }

  .ws-connections {
    flex: 1 1 48%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .ws-connections .table-container {
    flex: 1;
    overflow: auto;
    margin: 0;
  }

  .ws-detail {
    flex: 1 1 52%;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }

  .ws-conn-info {
    flex: 0 0 auto;
  }

  .ws-messages {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .ws-messages .panel-content {
    flex: 1;
    overflow: auto;
    padding: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .count-badge {
    background-color: var(--color-surface-tertiary);
    color: var(--color-text-secondary);
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
  }

  .mono {
    font-family: monospace;
    font-size: var(--font-size-sm);
  }

  .path-cell {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Filter dropdown */
  .ws-filter-dropdown {
    position: relative;
  }

  .ws-filter-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    min-width: 260px;
  }

  .filter-option {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .filter-warning {
    font-size: var(--font-size-xs);
    color: var(--color-status-warning);
  }

  .dropdown-arrow {
    font-size: 0.7em;
  }

  /* Badges */
  .status-badge,
  .proto-badge,
  .opcode-badge {
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    text-transform: capitalize;
    display: inline-block;
  }

  .status-open {
    background-color: var(--color-status-success);
    color: var(--color-button-text);
  }
  .status-closed {
    background-color: var(--color-surface-tertiary);
    color: var(--color-text-secondary);
  }

  .proto-ws {
    background-color: var(--color-accent-light);
    color: var(--color-text-primary);
  }
  .proto-wss {
    background-color: var(--color-warning-bg);
    color: var(--color-warning-text);
  }

  .opcode-badge {
    background-color: var(--color-surface-tertiary);
    color: var(--color-text-secondary);
    text-transform: none;
  }

  .dir-out {
    color: var(--color-status-success);
  }
  .dir-in {
    color: var(--color-accent-primary);
  }

  /* Details */
  .detail-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
  }
  .detail-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }
  .detail-row label {
    min-width: 90px;
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
  .detail-row span {
    word-break: break-all;
  }

  .wss-note {
    margin: 0 var(--space-md) var(--space-sm);
    padding: var(--space-sm);
    font-size: var(--font-size-xs);
    color: var(--color-warning-text);
    background-color: var(--color-warning-bg);
    border-radius: var(--radius-sm);
  }

  /* Messages */
  .messages-list {
    display: flex;
    flex-direction: column;
  }
  .message-item {
    border-bottom: 1px solid var(--color-border-primary);
    padding: var(--space-sm) var(--space-md);
  }
  .message-item.outgoing {
    background-color: color-mix(in srgb, var(--color-status-success) 8%, transparent);
  }
  .message-item.incoming {
    background-color: color-mix(in srgb, var(--color-accent-primary) 8%, transparent);
  }
  .message-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-xs);
    font-size: var(--font-size-xs);
    flex-wrap: wrap;
  }
  .message-direction {
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
  }
  .message-item.outgoing .message-direction {
    color: var(--color-status-success);
  }
  .message-item.incoming .message-direction {
    color: var(--color-accent-primary);
  }
  .message-time,
  .message-size {
    color: var(--color-text-muted);
    margin-left: auto;
  }
  .message-size {
    margin-left: 0;
  }
  .message-content pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }
  .binary-data {
    color: var(--color-text-secondary);
    font-style: italic;
    font-size: var(--font-size-sm);
  }

  .empty-state {
    text-align: center;
    padding: var(--space-xl) var(--space-md);
    color: var(--color-text-muted);
  }
  .empty-state h3 {
    margin: 0 0 var(--space-xs);
    color: var(--color-text-secondary);
  }
  .empty-state p {
    margin: 0;
    font-size: var(--font-size-sm);
  }
</style>
