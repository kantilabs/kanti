<script lang="ts">
  import { onMount } from 'svelte';
  import { hotkeyConfigs, hotkeysEnabled, updateHotkey, resetHotkey, resetAllHotkeys } from '$lib/stores/hotkeys';
  import { hotkeyManager } from '$lib/utils/hotkey-manager';

  // State
  let editingHotkeyId: string | null = null;
  let recordingHotkey = false;
  let currentRecording: string[] = [];
  let filterCategory: 'all' | 'navigation' | 'actions' | 'tools' = 'all';
  let searchQuery = '';

  // Filtered hotkeys
  $: filteredHotkeys = $hotkeyConfigs.filter(config => {
    const matchesCategory = filterCategory === 'all' || config.category === filterCategory;
    const matchesSearch = searchQuery === '' ||
      config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      config.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Start recording a new hotkey
  function startRecording(hotkeyId: string): void {
    editingHotkeyId = hotkeyId;
    recordingHotkey = true;
    currentRecording = [];

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];

      if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');

      // Handle special keys
      const key = event.key;
      if (key && key !== 'Control' && key !== 'Alt' && key !== 'Shift' && key !== 'Meta') {
        const normalizedKey = hotkeyManager.normalizeKey(key, event.code);
        if (normalizedKey && !parts.includes(normalizedKey)) {
          parts.push(normalizedKey);
        }
      }

      if (parts.length >= 2) {
        const hotkeyString = parts.join('+');

        // Validate the hotkey
        if (hotkeyManager.isValidHotkey(hotkeyString)) {
          // Check if this hotkey is already assigned to another function
          const isDuplicate = $hotkeyConfigs.some(config =>
            config.id !== hotkeyId && config.currentKey === hotkeyString && config.enabled
          );

          if (isDuplicate) {
            alert('This hotkey is already assigned to another function. Please choose a different combination.');
          } else {
            updateHotkey(hotkeyId, { currentKey: hotkeyString });
            stopRecording();
          }
        } else {
          alert('Invalid hotkey combination. Please use a valid modifier + key combination.');
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopRecording();
      }
    };

    // Add temporary event listeners
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keyup', handleKeyUp, { capture: true });

    // Store cleanup function
    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup', handleKeyUp, { capture: true });
    };

    // Set timeout to auto-cancel after 5 seconds
    const timeout = setTimeout(() => {
      if (recordingHotkey) {
        stopRecording();
        alert('Hotkey recording timed out. Please try again.');
      }
    }, 5000);

    // Store cleanup in component state
    (window as any).hotkeyRecordingCleanup = { cleanup, timeout };
  }

  // Stop recording
  function stopRecording(): void {
    recordingHotkey = false;
    editingHotkeyId = null;
    currentRecording = [];

    const cleanup = (window as any).hotkeyRecordingCleanup;
    if (cleanup) {
      cleanup.cleanup();
      clearTimeout(cleanup.timeout);
      (window as any).hotkeyRecordingCleanup = null;
    }
  }

  // Clear a hotkey
  function clearHotkey(hotkeyId: string): void {
    updateHotkey(hotkeyId, { currentKey: '' });
  }

  // Toggle hotkey enabled state
  function toggleHotkey(hotkeyId: string): void {
    const config = $hotkeyConfigs.find(c => c.id === hotkeyId);
    if (config) {
      updateHotkey(hotkeyId, { enabled: !config.enabled });
    }
  }

  // Reset all hotkeys to defaults
  function handleResetAll(): void {
    if (confirm('Are you sure you want to reset all hotkeys to their default values?')) {
      resetAllHotkeys();
    }
  }

  // Get category display name
  function getCategoryDisplayName(category: string): string {
    switch (category) {
      case 'navigation': return 'Navigation';
      case 'actions': return 'Actions';
      case 'tools': return 'Tools';
      default: return category;
    }
  }

  // Cleanup on component destroy
  onMount(() => {
    return () => {
      if (recordingHotkey) {
        stopRecording();
      }
    };
  });
</script>

<div class="hotkey-settings">
  <div class="settings-header">
    <p class="description">Configure keyboard shortcuts for quick navigation and actions.</p>
  </div>

  <!-- Global Controls -->
  <div class="global-controls">
    <label class="toggle-label">
      <input type="checkbox" bind:checked={$hotkeysEnabled} />
      <span class="toggle-slider"></span>
      Enable Keyboard Shortcuts
    </label>

    <button class="btn" on:click={handleResetAll}>
      Reset All to Defaults
    </button>
  </div>

  <!-- Search and Filter -->
  <div class="filter-controls">
    <div class="search-box">
      <input
        type="text"
        placeholder="Search shortcuts..."
        bind:value={searchQuery}
        class="input input-search"
      />
    </div>

    <div class="category-filters">
      <button
        class="btn"
        class:active={filterCategory === 'all'}
        on:click={() => filterCategory = 'all'}
      >
        All
      </button>
      <button
        class="btn"
        class:active={filterCategory === 'navigation'}
        on:click={() => filterCategory = 'navigation'}
      >
        Navigation
      </button>
      <button
        class="btn"
        class:active={filterCategory === 'actions'}
        on:click={() => filterCategory = 'actions'}
      >
        Actions
      </button>
    </div>
  </div>

  <!-- Hotkey List -->
  <div class="hotkey-list">
    {#each filteredHotkeys as config (config.id)}
      <div class="hotkey-item" class:disabled={!config.enabled}>
        <div class="hotkey-info">
          <div class="hotkey-name">{config.name}</div>
          <div class="hotkey-description">{config.description}</div>
          <div class="hotkey-category">{getCategoryDisplayName(config.category)}</div>
        </div>

        <div class="hotkey-controls">
          {#if recordingHotkey && editingHotkeyId === config.id}
            <div class="recording-indicator">
              <div class="recording-dot"></div>
              Press a key combination...
            </div>
            <button class="btn" on:click={stopRecording}>
              Cancel
            </button>
          {:else}
            <div class="hotkey-display">
              {#if config.currentKey}
                <span class="hotkey-combination">
                  {hotkeyManager.formatHotkeyForDisplay(config.currentKey)}
                </span>
              {:else}
                <span class="no-hotkey">Not assigned</span>
              {/if}
            </div>

            <div class="hotkey-actions">
              <button
                class="btn btn-primary btn-sm"
                on:click={() => startRecording(config.id)}
                disabled={!$hotkeysEnabled}
              >
                {config.currentKey ? 'Change' : 'Assign'}
              </button>

              {#if config.currentKey}
                <button
                  class="btn btn-sm"
                  on:click={() => clearHotkey(config.id)}
                  disabled={!$hotkeysEnabled}
                >
                  Clear
                </button>
                <button
                  class="btn btn-sm"
                  on:click={() => resetHotkey(config.id)}
                  disabled={!$hotkeysEnabled}
                >
                  Reset
                </button>
              {/if}

              <label class="toggle-small">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  on:change={() => toggleHotkey(config.id)}
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Recording Overlay -->
  {#if recordingHotkey}
    <div class="recording-overlay">
      <div class="recording-modal">
        <h3>Recording Hotkey</h3>
        <p>Press the key combination you want to assign...</p>
        <div class="recording-hint">
          <p>• Use Ctrl/Cmd, Alt/Option, or Shift with any letter, number, or special key</p>
          <p>• Press Escape to cancel</p>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .hotkey-settings {
    max-width: 800px;
  }

  .settings-header {
    margin-bottom: var(--space-lg);
  }

  .description {
    color: var(--color-text-secondary);
    margin: 0;
    font-size: var(--font-size-sm);
  }

  .global-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-lg);
    padding: var(--space-lg);
    background-color: var(--color-surface-tertiary);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-primary);
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
  }

  .toggle-label input {
    display: none;
  }

  .toggle-slider {
    position: relative;
    width: 50px;
    height: 24px;
    background-color: var(--color-surface-hover);
    border-radius: 12px;
    transition: background-color 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 20px;
    height: 20px;
    background-color: var(--color-text-primary);
    border-radius: 50%;
    top: 2px;
    left: 2px;
    transition: transform 0.2s ease;
  }

  input:checked + .toggle-slider {
    background-color: var(--color-accent-primary);
  }

  input:checked + .toggle-slider::before {
    transform: translateX(26px);
  }

  .filter-controls {
    display: flex;
    gap: var(--space-lg);
    margin-bottom: var(--space-lg);
    align-items: center;
  }

  .search-box {
    flex: 1;
  }

  .category-filters {
    display: flex;
    gap: var(--space-sm);
  }

  .category-filters .btn.active {
    background-color: var(--color-accent-primary);
    color: white;
    border-color: var(--color-accent-primary);
  }

  .hotkey-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .hotkey-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-lg);
    background-color: var(--color-surface-tertiary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--radius-lg);
    transition: all 0.2s ease;
  }

  .hotkey-item.disabled {
    opacity: 0.6;
  }

  .hotkey-item:hover {
    background-color: var(--color-surface-hover);
  }

  .hotkey-info {
    flex: 1;
  }

  .hotkey-name {
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
    margin-bottom: 4px;
  }

  .hotkey-description {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    margin-bottom: 4px;
  }

  .hotkey-category {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .hotkey-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .hotkey-display {
    min-width: 100px;
    text-align: center;
  }

  .hotkey-combination {
    background-color: var(--color-surface-secondary);
    border: 1px solid var(--color-border-primary);
    border-radius: var(--radius-sm);
    padding: 6px 12px;
    font-family: monospace;
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .no-hotkey {
    color: var(--color-text-muted);
    font-style: italic;
    font-size: var(--font-size-sm);
  }

  .hotkey-actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .toggle-small {
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .toggle-small input {
    display: none;
  }

  .toggle-small .toggle-slider {
    width: 36px;
    height: 18px;
  }

  .toggle-small .toggle-slider::before {
    width: 14px;
    height: 14px;
    top: 2px;
    left: 2px;
  }

  .toggle-small input:checked + .toggle-slider::before {
    transform: translateX(18px);
  }

  .recording-indicator {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--color-accent-primary);
    font-weight: var(--font-weight-medium);
  }

  .recording-dot {
    width: 8px;
    height: 8px;
    background-color: var(--color-accent-primary);
    border-radius: 50%;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .recording-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: var(--z-modal);
  }

  .recording-modal {
    background-color: var(--color-surface-tertiary);
    padding: var(--space-xl);
    border-radius: var(--radius-lg);
    text-align: center;
    max-width: 400px;
    border: 2px solid var(--color-accent-primary);
  }

  .recording-modal h3 {
    margin: 0 0 15px 0;
    color: var(--color-text-primary);
  }

  .recording-modal p {
    margin: 0 0 20px 0;
    color: var(--color-text-secondary);
  }

  .recording-hint {
    text-align: left;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .recording-hint p {
    margin: 5px 0;
  }
</style>
