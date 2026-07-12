<script lang="ts">
  import type { ToolItem } from '../../stores/agent';

  // One tool invocation in the agent transcript: name + pretty-printed args, a
  // spinner while it runs, and a collapsible result (stdout/stderr/exit or the
  // formatted tool output) once it completes.
  export let card: ToolItem;

  let showResult = false;

  function pretty(input: Record<string, any>): string {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }

  // Result content can be large; collapse by default and only show a preview.
  const PREVIEW = 600;
  $: content = card.content ?? '';
  $: truncated = content.length > PREVIEW;
  $: preview = truncated ? content.slice(0, PREVIEW) : content;
</script>

<div class="tool-card" class:error={card.status === 'error'}>
  <div class="tool-head">
    <span class="tool-icon" aria-hidden="true">⚙</span>
    <span class="tool-name">{card.name}</span>
    <span class="tool-status status-{card.status}">
      {#if card.status === 'running'}
        <span class="spinner"></span> running
      {:else if card.status === 'awaiting'}
        awaiting approval
      {:else if card.status === 'error'}
        error
      {:else}
        done
      {/if}
    </span>
  </div>

  {#if Object.keys(card.input || {}).length > 0}
    <pre class="tool-args">{pretty(card.input)}</pre>
  {/if}

  {#if card.status === 'done' || card.status === 'error'}
    <button class="result-toggle" on:click={() => (showResult = !showResult)}>
      {showResult ? '▾' : '▸'} {card.isError ? 'error output' : 'output'}
      {#if content}<span class="bytes">({content.length} chars)</span>{/if}
    </button>
    {#if showResult}
      <pre class="tool-result">{showResult && !truncated ? content : preview}{#if truncated && showResult}
… (truncated){/if}</pre>
    {/if}
  {/if}
</div>

<style>
  .tool-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    background-color: var(--bg-secondary);
    padding: 10px 12px;
    font-family: 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
  }
  .tool-card.error {
    border-color: var(--status-error);
  }
  .tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tool-icon {
    color: var(--accent-primary);
  }
  .tool-name {
    font-weight: 600;
    color: var(--text-primary);
  }
  .tool-status {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .status-awaiting {
    color: var(--status-warning);
  }
  .status-error {
    color: var(--status-error);
  }
  .status-done {
    color: var(--status-success);
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .tool-args,
  .tool-result {
    margin: 8px 0 0 0;
    padding: 8px;
    background-color: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    max-height: 320px;
    overflow-y: auto;
  }
  .result-toggle {
    margin-top: 8px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 0;
    font-family: inherit;
  }
  .result-toggle:hover {
    color: var(--text-primary);
  }
  .bytes {
    color: var(--text-muted);
  }
</style>
