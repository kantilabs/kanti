<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import type { AuthRole, AuthTestResult, RoleTestResult } from '$lib/stores/auth';
  import type { CapturedRequest } from '$lib/types';

  // Props (mirrors SitemapTab: standalone when popped out into its own window)
  export let standalone = false;

  // Store-backed state
  let roles: AuthRole[] = [];
  let testResults: AuthTestResult[] = [];
  let running = false;

  const unsubscribe = authStore.subscribe(state => {
    roles = state.roles;
    testResults = state.testResults;
    running = state.running;
  });

  // Captured requests available to replay
  let capturedRequests: CapturedRequest[] = [];
  let selectedIds: Set<number> = new Set();
  let loadingRequests = false;

  // Role editing
  let editingIndex = -1;
  let newRole: AuthRole = { label: '', cookie: '', headers: '' };
  let showAddForm = false;

  // --- Role management -------------------------------------------------------

  function addRole() {
    if (!newRole.label.trim()) {
      alert('Please give the role a label');
      return;
    }
    if (!newRole.cookie.trim() && !newRole.headers.trim()) {
      alert('Provide a cookie value and/or header(s) for this role');
      return;
    }
    const role: AuthRole = {
      label: newRole.label.trim(),
      cookie: newRole.cookie,
      headers: newRole.headers
    };
    authStore.addRole(role);
    authStore.saveToStorage([...roles, role]);
    newRole = { label: '', cookie: '', headers: '' };
    showAddForm = false;
  }

  function removeRole(index: number) {
    if (!confirm('Remove this role?')) return;
    authStore.removeRole(index);
    authStore.saveToStorage(roles.filter((_, i) => i !== index));
  }

  function startEdit(index: number) {
    editingIndex = index;
  }

  function cancelEdit() {
    editingIndex = -1;
  }

  function saveEdit(index: number, role: AuthRole) {
    authStore.updateRole(index, role);
    authStore.saveToStorage(roles);
    editingIndex = -1;
  }

  // --- Captured request loading ---------------------------------------------

  async function loadRequests() {
    if (!window.electronAPI?.proxy) return;
    loadingRequests = true;
    try {
      const reqs = await window.electronAPI.proxy.getRequests();
      // Ensure every request has a usable id for selection
      capturedRequests = (reqs || []).map((r: CapturedRequest, i: number) => ({
        ...r,
        id: r.id ?? i
      }));
    } catch (error) {
      console.error('Failed to load captured requests:', error);
    } finally {
      loadingRequests = false;
    }
  }

  function toggleSelected(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function selectAll() {
    selectedIds = new Set(capturedRequests.map(r => r.id as number));
  }

  function clearSelection() {
    selectedIds = new Set();
  }

  // --- Replay engine ---------------------------------------------------------

  // Parse raw "Name: value" lines into a header map.
  function parseHeaderLines(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const line of raw.split('\n')) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (name) out[name] = value;
    }
    return out;
  }

  function buildUrl(req: CapturedRequest): string {
    const query = req.query ? (req.query.startsWith('?') ? req.query : `?${req.query}`) : '';
    return `${req.protocol}://${req.host}${req.path}${query}`;
  }

  // Merge the original request headers with a role's cookie/header overrides.
  function buildHeaders(req: CapturedRequest, role: AuthRole): Record<string, string> {
    const headers: Record<string, string> = {};
    // Start from the original request headers, dropping ones the role overrides
    // or that shouldn't be replayed verbatim.
    for (const [k, v] of Object.entries(req.headers || {})) {
      const lk = k.toLowerCase();
      if (lk === 'cookie' && role.cookie.trim()) continue;
      if (lk === 'content-length') continue;
      headers[k] = v;
    }
    if (role.cookie.trim()) headers['Cookie'] = role.cookie.trim();
    // Role headers win over original headers
    for (const [k, v] of Object.entries(parseHeaderLines(role.headers))) {
      headers[k] = v;
    }
    return headers;
  }

  async function replayOne(req: CapturedRequest, role: AuthRole): Promise<RoleTestResult> {
    const url = buildUrl(req);
    const headers = buildHeaders(req, role);
    const start = Date.now();
    try {
      const api = (window as any).electronAPI;
      if (!api?.fetch) {
        return {
          roleLabel: role.label,
          statusCode: 0,
          responseTime: 0,
          responseLength: 0,
          success: false,
          error: 'electronAPI.fetch unavailable'
        };
      }
      // Electron IPC fetch -> { ok, status, headers, body } (avoids CORS)
      const res = await api.fetch(url, {
        method: req.method,
        headers,
        body: req.body
      });
      const responseTime = Date.now() - start;
      const body: string = typeof res.body === 'string' ? res.body : (res.body ? String(res.body) : '');
      return {
        roleLabel: role.label,
        statusCode: res.status ?? 0,
        responseTime,
        responseLength: body.length,
        success: true
      };
    } catch (error) {
      return {
        roleLabel: role.label,
        statusCode: 0,
        responseTime: Date.now() - start,
        responseLength: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Request failed'
      };
    }
  }

  async function runTests() {
    if (roles.length === 0) {
      alert('Define at least one role/session before running tests');
      return;
    }
    const targets = capturedRequests.filter(r => selectedIds.has(r.id as number));
    if (targets.length === 0) {
      alert('Select at least one captured request to replay');
      return;
    }

    authStore.setRunning(true);
    try {
      for (const req of targets) {
        const results: RoleTestResult[] = [];
        for (const role of roles) {
          results.push(await replayOne(req, role));
        }
        // Flag potential broken access control: successful responses whose
        // status codes diverge across roles for the same request.
        const okStatuses = results.filter(r => r.success).map(r => r.statusCode);
        const mismatch = new Set(okStatuses).size > 1;
        authStore.addTestResult({ request: req, results, mismatch });
      }
    } finally {
      authStore.setRunning(false);
    }
  }

  // --- Display helpers -------------------------------------------------------

  function statusClass(code: number): string {
    if (code >= 200 && code < 300) return 'status-2xx';
    if (code >= 300 && code < 400) return 'status-3xx';
    if (code >= 400) return 'status-4xx';
    return 'status-5xx';
  }

  function clearResults() {
    authStore.clearTestResults();
  }

  onMount(() => {
    if (standalone && typeof document !== 'undefined') {
      document.title = 'Kanti - Auth';
    }
    authStore.loadFromStorage();
    loadRequests();
  });

  onDestroy(() => {
    unsubscribe();
  });
</script>

<div class="auth-tab">
  <div class="auth-header">
    <div>
      <h2>Auth Testing</h2>
      <p class="subtitle">Replay captured requests under different sessions/roles to spot broken access control.</p>
    </div>
    <button class="btn btn-primary" on:click={runTests} disabled={running}>
      {running ? 'Running…' : 'Run Auth Tests'}
    </button>
  </div>

  <div class="content">
    <!-- Roles / Sessions -->
    <div class="panel section">
      <div class="panel-header">
        <h3>Roles &amp; Sessions</h3>
        <button class="btn btn-sm btn-primary" on:click={() => (showAddForm = !showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Role'}
        </button>
      </div>

      {#if showAddForm}
        <div class="role-form">
          <input
            class="input input-sm"
            type="text"
            placeholder="Label (e.g. Admin, Anonymous)"
            bind:value={newRole.label}
          />
          <input
            class="input input-sm"
            type="text"
            placeholder="Cookie value (e.g. session=abc; csrf=xyz)"
            bind:value={newRole.cookie}
          />
          <textarea
            class="input textarea"
            placeholder={'Extra headers, one per line\nAuthorization: Bearer ...'}
            bind:value={newRole.headers}
          ></textarea>
          <button class="btn btn-success" on:click={addRole}>Add Role</button>
        </div>
      {/if}

      <div class="roles-list">
        {#if roles.length === 0}
          <div class="empty-state">
            <p>No roles configured</p>
            <p class="help-text">Add sessions/roles (cookies and/or headers) to replay requests under different identities.</p>
          </div>
        {:else}
          {#each roles as role, index}
            <div class="role-item">
              {#if editingIndex === index}
                <div class="role-edit">
                  <input class="input input-sm" type="text" bind:value={role.label} placeholder="Label" />
                  <input class="input input-sm" type="text" bind:value={role.cookie} placeholder="Cookie value" />
                  <textarea class="input textarea" bind:value={role.headers} placeholder="Extra headers"></textarea>
                  <div class="role-actions">
                    <button class="btn btn-sm btn-success" on:click={() => saveEdit(index, role)}>Save</button>
                    <button class="btn btn-sm" on:click={cancelEdit}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div class="role-info">
                  <div class="role-label">{role.label}</div>
                  <div class="role-details">
                    {#if role.cookie.trim()}
                      <code>{role.cookie.substring(0, 40)}{role.cookie.length > 40 ? '…' : ''}</code>
                    {/if}
                    {#if role.headers.trim()}
                      <span class="hdr-count">{role.headers.split('\n').filter(l => l.includes(':')).length} header(s)</span>
                    {/if}
                  </div>
                </div>
                <div class="role-actions">
                  <button class="btn btn-sm" on:click={() => startEdit(index)}>Edit</button>
                  <button class="btn btn-sm btn-danger" on:click={() => removeRole(index)}>Remove</button>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Captured request picker -->
    <div class="panel section">
      <div class="panel-header">
        <h3>Requests to Replay</h3>
        <div class="header-actions">
          <button class="btn btn-sm" on:click={loadRequests} disabled={loadingRequests}>
            {loadingRequests ? 'Loading…' : 'Refresh'}
          </button>
          <button class="btn btn-sm" on:click={selectAll} disabled={capturedRequests.length === 0}>Select All</button>
          <button class="btn btn-sm" on:click={clearSelection} disabled={selectedIds.size === 0}>Clear</button>
        </div>
      </div>

      <div class="table-container requests-picker">
        {#if capturedRequests.length === 0}
          <div class="empty-state">
            <p>No captured requests</p>
            <p class="help-text">Browse through the proxy, then refresh to pick requests to replay.</p>
          </div>
        {:else}
          <table class="table">
            <thead>
              <tr>
                <th style="width:32px"></th>
                <th>Method</th>
                <th>Host</th>
                <th>Path</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each capturedRequests as req (req.id)}
                <tr
                  class:selected={selectedIds.has(req.id as number)}
                  on:click={() => toggleSelected(req.id as number)}
                >
                  <td>
                    <input
                      class="checkbox"
                      type="checkbox"
                      checked={selectedIds.has(req.id as number)}
                      on:click|stopPropagation={() => toggleSelected(req.id as number)}
                    />
                  </td>
                  <td class="method {req.method.toLowerCase()}">{req.method}</td>
                  <td>{req.host}</td>
                  <td class="path">{req.path}</td>
                  <td>{req.status || '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div class="picker-footer">{selectedIds.size} selected · {capturedRequests.length} captured</div>
    </div>

    <!-- Results -->
    <div class="panel section">
      <div class="panel-header">
        <h3>Results</h3>
        {#if testResults.length > 0}
          <button class="btn btn-sm" on:click={clearResults}>Clear Results</button>
        {/if}
      </div>

      <div class="results-list">
        {#if testResults.length === 0}
          <div class="empty-state">
            <p>No results yet</p>
            <p class="help-text">Define roles, select requests, and run the tests.</p>
          </div>
        {:else}
          {#each testResults as result}
            <div class="result-card" class:mismatch={result.mismatch}>
              <div class="result-header">
                <span class="request-info">
                  <strong class="method {result.request.method.toLowerCase()}">{result.request.method}</strong>
                  {result.request.protocol}://{result.request.host}{result.request.path}
                </span>
                {#if result.mismatch}
                  <span class="mismatch-flag">⚠ status mismatch</span>
                {/if}
              </div>

              <table class="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Length</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {#each result.results as r}
                    <tr>
                      <td>{r.roleLabel}</td>
                      <td>
                        {#if r.success}
                          <span class="status-code {statusClass(r.statusCode)}">{r.statusCode}</span>
                        {:else}
                          <span class="status-code status-5xx" title={r.error}>ERR</span>
                        {/if}
                      </td>
                      <td>{r.success ? r.responseLength : '-'}</td>
                      <td>{r.responseTime}ms</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .auth-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--space-md);
    overflow-y: auto;
    background-color: transparent;
  }

  .auth-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-md);
    margin-bottom: var(--space-md);
    padding-bottom: var(--space-sm);
    border-bottom: 1px solid var(--color-border-primary);
  }

  .auth-header h2 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-semibold);
  }

  .subtitle {
    margin: var(--space-xs) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }

  .section {
    flex: none;
    height: auto;
    overflow: visible;
    padding-bottom: var(--space-sm);
    box-shadow: var(--shadow-md);
  }

  .header-actions {
    display: flex;
    gap: var(--space-xs);
  }

  .role-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    margin: var(--space-sm);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
  }

  .role-form .textarea {
    min-height: 60px;
  }

  .roles-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-sm);
  }

  .role-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    background-color: var(--color-surface-secondary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--radius-md);
  }

  .role-info {
    flex: 1;
    min-width: 0;
  }

  .role-label {
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    margin-bottom: var(--space-xs);
  }

  .role-details {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
    flex-wrap: wrap;
  }

  .role-details code {
    background-color: var(--color-surface-primary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: monospace;
  }

  .hdr-count {
    color: var(--color-text-muted);
  }

  .role-actions {
    display: flex;
    gap: var(--space-xs);
  }

  .role-edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    flex: 1;
  }

  .role-edit .textarea {
    min-height: 50px;
  }

  .requests-picker {
    max-height: 260px;
    min-height: 0;
    margin: var(--space-sm);
    width: auto;
  }

  .requests-picker .table tr {
    cursor: pointer;
  }

  .picker-footer {
    padding: 0 var(--space-md) var(--space-xs);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-sm);
  }

  .result-card {
    background-color: var(--color-surface-secondary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--radius-md);
    padding: var(--space-md);
  }

  .result-card.mismatch {
    border-color: var(--color-status-warning);
  }

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-sm);
    padding-bottom: var(--space-sm);
    border-bottom: 1px solid var(--color-border-primary);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    word-break: break-all;
  }

  .mismatch-flag {
    color: var(--color-status-warning);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .empty-state {
    text-align: center;
    padding: var(--space-xl) var(--space-md);
    color: var(--color-text-secondary);
  }

  .empty-state p {
    margin: var(--space-xs) 0;
  }

  .help-text {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .result-card .table td {
    text-align: left;
  }
</style>
