<script lang="ts">
  import {
    apiKeys,
    baseUrls,
    currentProvider,
    currentModel,
    modelConfigs,
    defaultModelConfigs,
    providerLabels,
    customPresets,
    PROVIDERS,
    type Provider,
    type CustomPreset
  } from '$lib/stores/settings';

  // Change the current provider (also resets/loads the per-provider model).
  function changeProvider(provider: Provider): void {
    currentProvider.set(provider);
  }

  // Update the API key for a given provider.
  function updateApiKey(provider: Provider, value: string): void {
    apiKeys.update(keys => ({ ...keys, [provider]: value }));
  }

  // Update the base URL for a given provider (used mainly for custom).
  function updateBaseUrl(provider: Provider, value: string): void {
    baseUrls.update(urls => ({ ...urls, [provider]: value }));
  }

  // Apply a local-runtime preset: select custom + point baseUrl at it.
  function applyPreset(preset: CustomPreset): void {
    currentProvider.set('custom');
    baseUrls.update(urls => ({ ...urls, custom: preset.baseUrl }));
    currentModel.set(preset.defaultModel);
  }

  // Placeholder text for the API key field, per provider.
  function keyPlaceholder(provider: Provider): string {
    switch (provider) {
      case 'openai':
      case 'deepseek':
        return 'sk-...';
      case 'gemini':
        return 'AIza...';
      case 'anthropic':
        return 'sk-ant-...';
      default:
        return 'Optional — most local runtimes ignore this';
    }
  }

  // Suggested models for the current provider (used as a datalist).
  $: suggestedModels =
    ($modelConfigs && $modelConfigs[$currentProvider]?.models) ||
    defaultModelConfigs[$currentProvider].models;
</script>

<div class="ai-settings">
  <div class="form-group ai-card">
    <h3>AI Provider</h3>
    <p class="description">
      Configure which AI provider Chat talks to. Cloud providers (OpenAI, Anthropic,
      Deepseek, Gemini) use their official endpoints; pick <strong>Custom</strong> for a
      self-hosted OpenAI-compatible server, or use a preset below for Ollama / LM Studio.
    </p>

    <div class="field">
      <label class="form-label" for="provider-select">Current Provider</label>
      <select
        id="provider-select"
        class="input select"
        bind:value={$currentProvider}
        on:change={(e) => changeProvider((e.target as HTMLSelectElement).value as Provider)}
      >
        {#each PROVIDERS as provider}
          <option value={provider}>{providerLabels[provider]}</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label class="form-label" for="model-input">Model</label>
      <input
        id="model-input"
        class="input"
        type="text"
        list="ai-model-suggestions"
        bind:value={$currentModel}
        placeholder={defaultModelConfigs[$currentProvider].defaultModel}
      />
      <datalist id="ai-model-suggestions">
        {#each suggestedModels as model}
          <option value={model}></option>
        {/each}
      </datalist>
      <span class="form-help">Type any model name your provider supports.</span>
    </div>
  </div>

  <div class="form-group ai-card">
    <h3>Credentials</h3>

    {#if $currentProvider !== 'custom'}
      <div class="field">
        <label class="form-label" for="api-key-input">{providerLabels[$currentProvider]} API Key</label>
        <input
          id="api-key-input"
          class="input"
          type="password"
          value={$apiKeys[$currentProvider]}
          on:input={(e) => updateApiKey($currentProvider, (e.target as HTMLInputElement).value)}
          placeholder={keyPlaceholder($currentProvider)}
        />
        <span class="form-help">Stored locally in this app only.</span>
      </div>
    {:else}
      <div class="field">
        <label class="form-label" for="base-url-input">Base URL</label>
        <input
          id="base-url-input"
          class="input"
          type="text"
          value={$baseUrls.custom}
          on:input={(e) => updateBaseUrl('custom', (e.target as HTMLInputElement).value)}
          placeholder="http://localhost:11434/v1"
        />
        <span class="form-help">OpenAI-compatible endpoint (usually ends in <code>/v1</code>).</span>
      </div>

      <div class="field">
        <label class="form-label" for="custom-key-input">API Key (optional)</label>
        <input
          id="custom-key-input"
          class="input"
          type="password"
          value={$apiKeys.custom}
          on:input={(e) => updateApiKey('custom', (e.target as HTMLInputElement).value)}
          placeholder={keyPlaceholder('custom')}
        />
      </div>

      <div class="presets">
        <span class="form-label">Local runtime presets</span>
        <div class="preset-buttons">
          {#each customPresets as preset}
            <button
              type="button"
              class="btn"
              class:active={$baseUrls.custom === preset.baseUrl}
              title={preset.hint}
              on:click={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if $currentProvider === 'custom'}
    <div class="form-group ai-card">
      <h3>Local AI Setup</h3>
      <div class="instructions">
        <h4>Ollama</h4>
        <ol>
          <li>Install Ollama from <a href="https://ollama.ai" target="_blank" rel="noreferrer">ollama.ai</a></li>
          <li>Pull a model: <code>ollama pull llama3.1</code></li>
          <li>Ensure it's running on the default port (11434), then click the <strong>Ollama</strong> preset</li>
        </ol>

        <h4>LM Studio</h4>
        <ol>
          <li>Download LM Studio from <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">lmstudio.ai</a></li>
          <li>Download a model and start the local server (default port 1234)</li>
          <li>Click the <strong>LM Studio</strong> preset and set the model to your loaded model</li>
        </ol>
      </div>
    </div>
  {/if}
</div>

<style>
  .ai-settings {
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .ai-card h3 {
    margin: 0 0 10px 0;
    color: var(--text-primary);
    font-size: 16px;
  }

  .description {
    color: var(--text-secondary);
    margin: 0 0 16px 0;
    font-size: 14px;
    line-height: 1.5;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 16px;
  }

  .field:last-child {
    margin-bottom: 0;
  }

  .presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preset-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .preset-buttons .btn.active {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .instructions {
    background-color: var(--bg-secondary);
    padding: 15px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-primary);
  }

  .instructions h4 {
    margin: 12px 0 8px 0;
    color: var(--accent-primary);
    font-size: 14px;
  }

  .instructions h4:first-child {
    margin-top: 0;
  }

  .instructions ol {
    margin: 0;
    padding-left: 20px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .instructions li {
    margin-bottom: 6px;
    line-height: 1.4;
  }

  code {
    background-color: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    color: var(--text-primary);
  }

  .instructions a {
    color: var(--accent-primary);
    text-decoration: none;
  }

  .instructions a:hover {
    text-decoration: underline;
  }
</style>
