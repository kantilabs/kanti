<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PendingApproval } from '../../stores/agent';

  // Inline human-approval gate. Shows the tool the agent wants to run, its
  // arguments, a destructive badge for state-changing/exec/network tools, and
  // Approve / Deny buttons. The parent wires the events to
  // agentStore.approve / agentStore.deny.
  export let approval: PendingApproval;

  const dispatch = createEventDispatcher<{ approve: string; deny: string }>();

  function pretty(input: Record<string, any>): string {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
</script>

<div class="approval-card" class:destructive={approval.destructive}>
  <div class="approval-head">
    <span class="approval-title">Approval required</span>
    {#if approval.destructive}
      <span class="badge destructive-badge">destructive</span>
    {:else}
      <span class="badge">needs approval</span>
    {/if}
  </div>

  <div class="approval-tool">
    The agent wants to run <code>{approval.name}</code>
  </div>

  {#if Object.keys(approval.input || {}).length > 0}
    <pre class="approval-args">{pretty(approval.input)}</pre>
  {/if}

  <div class="approval-actions">
    <button class="btn btn-danger btn-sm" on:click={() => dispatch('deny', approval.toolCallId)}>
      Deny
    </button>
    <button class="btn btn-primary btn-sm" on:click={() => dispatch('approve', approval.toolCallId)}>
      Approve
    </button>
  </div>
</div>

<style>
  .approval-card {
    border: 1px solid var(--status-warning);
    border-radius: var(--radius-md);
    background-color: var(--bg-secondary);
    padding: 12px 14px;
  }
  .approval-card.destructive {
    border-color: var(--status-error);
  }
  .approval-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .approval-title {
    font-weight: 600;
    color: var(--text-primary);
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 10px;
    background-color: var(--bg-tertiary);
    color: var(--status-warning);
    border: 1px solid var(--status-warning);
  }
  .destructive-badge {
    color: white;
    background-color: var(--status-error);
    border-color: var(--status-error);
  }
  .approval-tool {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .approval-tool code {
    background-color: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: 'Fira Code', monospace;
  }
  .approval-args {
    margin: 0 0 10px 0;
    padding: 8px;
    background-color: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: 'Fira Code', monospace;
    font-size: 12px;
    color: var(--text-secondary);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow-y: auto;
  }
  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
