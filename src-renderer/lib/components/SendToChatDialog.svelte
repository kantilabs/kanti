<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';

  export let request: CapturedRequest;
  export let visible: boolean = false;

  const dispatch = createEventDispatcher();

  // Dialog state
  let mode: 'context' | 'analyze' = 'analyze';
  let includeFullResponse = false;
  let customQuestion = '';

  function handleSend() {
    dispatch('send', {
      request,
      mode,
      includeFullResponse,
      customQuestion: mode === 'context' ? customQuestion : ''
    });
    close();
  }

  function close() {
    dispatch('close');
    // Reset state
    mode = 'analyze';
    includeFullResponse = false;
    customQuestion = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={close} on:keydown={handleKeydown} transition:fade={{ duration: 150 }}>
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-container send-to-chat" on:click|stopPropagation on:keydown={handleKeydown}>
      <div class="modal-header">
        <h3>Send to Chat</h3>
        <button class="close-button" on:click={close}>×</button>
      </div>

      <div class="modal-content">
        <div class="section">
          <h4>Mode</h4>
          <label class="option-card">
            <input class="radio" type="radio" bind:group={mode} value="analyze">
            <div class="option-body">
              <span class="option-title">Analyze with default prompt</span>
              <p class="option-description">Automatically send for security and behavior analysis</p>
            </div>
          </label>

          <label class="option-card">
            <input class="radio" type="radio" bind:group={mode} value="context">
            <div class="option-body">
              <span class="option-title">Add as context</span>
              <p class="option-description">Add request/response data and ask your own question</p>
            </div>
          </label>
        </div>

        {#if mode === 'context'}
          <div class="section">
            <h4>Your Question</h4>
            <textarea
              class="input textarea"
              bind:value={customQuestion}
              placeholder="What would you like to know about this request/response?"
              rows="4"
            ></textarea>
          </div>
        {/if}

        <div class="section">
          <h4>Response Body</h4>
          <label class="option-card">
            <input class="checkbox" type="checkbox" bind:checked={includeFullResponse}>
            <div class="option-body">
              <span class="option-title">Include full response body</span>
              <p class="option-description">
                {#if includeFullResponse}
                  Full response will be included (may be large)
                {:else}
                  Response will be truncated to ~5000 characters
                {/if}
              </p>
            </div>
          </label>
        </div>

        <div class="request-preview">
          <h4>Request Preview</h4>
          <div class="preview-content">
            <div><strong>Method:</strong> {request.method}</div>
            <div><strong>URL:</strong> {request.protocol}://{request.host}{request.path}</div>
            <div><strong>Status:</strong> {request.status || 'Pending'}</div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn" on:click={close}>Cancel</button>
        <button
          class="btn btn-primary"
          on:click={handleSend}
          disabled={mode === 'context' && !customQuestion.trim()}
        >
          Send to Chat
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .send-to-chat {
    max-width: 600px;
  }

  .section {
    margin-bottom: 20px;
  }

  .section h4 {
    margin: 0 0 12px 0;
    color: var(--accent-primary);
    font-size: 14px;
    font-weight: 600;
  }

  .option-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    cursor: pointer;
    margin-bottom: 10px;
    transition: background-color 0.2s;
  }

  .option-card:hover {
    background-color: var(--bg-hover);
  }

  .option-card input {
    margin-top: 2px;
    cursor: pointer;
  }

  .option-body {
    flex: 1;
  }

  .option-title {
    display: block;
    color: var(--text-primary);
    font-weight: 500;
  }

  .option-description {
    margin: 4px 0 0 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .request-preview {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    padding: 12px;
  }

  .request-preview h4 {
    margin: 0 0 12px 0;
    color: var(--text-tertiary);
    font-size: 13px;
  }

  .preview-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .preview-content strong {
    color: var(--text-primary);
  }
</style>
