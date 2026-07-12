<script lang="ts">
  import { backendStore } from '../stores/backend';

  // Dropdown to pick the agent's exec backend (local | docker) plus a status chip
  // and any downgrade warning. Mounted in the Agent header (next phase).
  $: state = $backendStore;

  async function onChange(event: Event) {
    const kind = (event.target as HTMLSelectElement).value as 'local' | 'docker';
    await backendStore.select(kind);
  }
</script>

<div class="backend-selector">
  <label class="field">
    <span class="label">Backend</span>
    <select class="input" value={state.requested} on:change={onChange} disabled={state.busy}>
      <option value="local">Local</option>
      <option value="docker">Docker</option>
    </select>
  </label>

  <span
    class="chip"
    class:running={state.provisioned}
    class:downgraded={state.requested === 'docker' && state.kind === 'local'}
    title={state.containerId ? `container ${state.containerId.slice(0, 12)}` : ''}
  >
    {#if state.busy}
      …
    {:else if state.provisioned}
      {state.kind === 'docker' ? `docker · ${state.containerId.slice(0, 12) || 'up'}` : 'local · ready'}
    {:else}
      {state.kind} · idle
    {/if}
  </span>
</div>

{#if state.warning}
  <p class="warning">⚠ {state.warning}</p>
{/if}

<style>
  .backend-selector {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .input {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    padding: 4px 8px;
    font-size: 13px;
  }

  .chip {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: var(--radius-md);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .chip.running {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .chip.downgraded {
    border-color: #b8860b;
    color: #e0a800;
  }

  .warning {
    margin: 6px 0 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: #e0a800;
  }
</style>
