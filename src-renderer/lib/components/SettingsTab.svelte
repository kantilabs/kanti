<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ProxySettings from './settings/ProxySettings.svelte';
  import AISettings from './settings/AISettings.svelte';
  import ScopeSettings from './settings/ScopeSettings.svelte';
  import ProjectSettings from './settings/ProjectSettings.svelte';
  import ThemeSettings from './settings/ThemeSettings.svelte';
  import HotkeySettings from './settings/HotkeySettings.svelte';

  // Props that can be passed to the component
  export let standalone = false; // Whether the component is running in standalone mode (new window)
  
  // State
  let selectedSection = 'Project'; // Default to Project settings
  
  // Handle section selection
  function selectSection(section: string) {
    selectedSection = section;
  }
  
  // Initialize the UI after component is mounted
  onMount(() => {
    console.log(`SettingsTab mounted, standalone: ${standalone}`);
    
    // Hide parent sidebar and tabs if in standalone mode
    if (standalone) {
      // This is a workaround to hide the sidebar and tabs when in standalone mode
      // These elements might be present from the parent layout
      const sidebar = document.querySelector('.sidebar') as HTMLElement;
      const tabs = document.querySelector('.tabs') as HTMLElement;
      
      if (sidebar) sidebar.style.display = 'none';
      if (tabs) tabs.style.display = 'none';
    }
  });
</script>

<div class="settings-container">
  <!-- Settings Sidebar -->
<div class="settings-sidebar">
    <div class="sidebar-item" class:active={selectedSection === 'Project'} on:click={() => selectSection('Project')}>Project</div>
    <div class="sidebar-item" class:active={selectedSection === 'Proxy'} on:click={() => selectSection('Proxy')}>Proxy</div>
    <div class="sidebar-item" class:active={selectedSection === 'AI'} on:click={() => selectSection('AI')}>AI</div>
    <div class="sidebar-item" class:active={selectedSection === 'Scope'} on:click={() => selectSection('Scope')}>Scope</div>
    <div class="sidebar-item" class:active={selectedSection === 'Theme'} on:click={() => selectSection('Theme')}>Theme</div>
    <div class="sidebar-item" class:active={selectedSection === 'Hotkeys'} on:click={() => selectSection('Hotkeys')}>Keyboard Shortcuts</div>
  </div>
  
  <!-- Settings Content -->
  <div class="settings-content">
    {#if selectedSection === 'Project'}
      <div class="settings-section">
        <h2>Project Settings</h2>
        <svelte:component this={ProjectSettings} />
      </div>
    {:else if selectedSection === 'Proxy'}
      <div class="settings-section">
        <h2>Proxy Settings</h2>
        <svelte:component this={ProxySettings} />
      </div>
    {:else if selectedSection === 'AI'}
      <div class="settings-section">
        <h2>AI Settings</h2>
        <svelte:component this={AISettings} />
      </div>
    {:else if selectedSection === 'Scope'}
      <div class="settings-section">
        <h2>Scope Settings</h2>
        <svelte:component this={ScopeSettings} />
      </div>
    {:else if selectedSection === 'Theme'}
      <div class="settings-section">
        <h2>Theme & Visual Options</h2>
        <svelte:component this={ThemeSettings} />
      </div>
    {:else if selectedSection === 'Hotkeys'}
      <div class="settings-section">
        <h2>Keyboard Shortcuts</h2>
        <svelte:component this={HotkeySettings} />
      </div>
    {/if}
  </div>
</div>

<style>
  .settings-container {
    display: flex;
    height: 97.3%;
    width: 100%;
    gap: 15px;
    background-color: transparent;
  }
  
  .settings-sidebar {
    width: 200px;
    background-color: var(--bg-secondary);
    padding: 15px 0;
    border-radius: 8px;
    box-shadow: 0 4px 8px var(--shadow-md);
    overflow: hidden;
    border: 1px solid var(--border-primary);
  }
  
  .sidebar-item {
    padding: 12px 20px;
    cursor: pointer;
    color: var(--text-primary);
    transition: all 0.2s ease;
    margin: 2px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-primary);
    font-weight: 500;
  }
  
  .sidebar-item:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }
  
  .sidebar-item.active {
    background-color: var(--bg-hover);
    color: var(--text-primary);
    border: 2px solid var(--accent-primary);
    font-weight: 600;
  }
  
  .settings-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    background-color: var(--bg-secondary);
    border-radius: 8px;
    box-shadow: 0 4px 8px var(--shadow-md);
    border: 1px solid var(--border-primary);
  }
  
  .settings-section {
    max-width: 800px;
  }
  
  .settings-section h2 {
    margin-top: 0;
    color: var(--text-primary);
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-primary);
    font-size: 24px;
    font-weight: 600;
  }

  /* Global styles for input elements within settings */
  :global(.settings-container input[type="text"]),
  :global(.settings-container input[type="number"]),
  :global(.settings-container select) {
    background-color: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text-primary);
    width: 100%;
    margin-bottom: 15px;
    transition: border-color 0.2s ease;
  }

  :global(.settings-container input[type="text"]:focus),
  :global(.settings-container input[type="number"]:focus),
  :global(.settings-container select:focus) {
    outline: none;
    border-color: var(--input-focus);
  }

  :global(.settings-container button) {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    padding: 8px 15px;
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  :global(.settings-container button:hover) {
    background-color: var(--bg-hover);
    border-color: var(--border-hover);
  }

  :global(.settings-container button.primary) {
    background-color: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  :global(.settings-container button.primary:hover) {
    background-color: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  :global(.settings-container .form-group) {
    margin-bottom: 20px;
    background-color: var(--bg-tertiary);
    padding: 15px;
    border-radius: 8px;
    border: 1px solid var(--border-primary);
  }

  :global(.settings-container .form-group label) {
    display: block;
    margin-bottom: 8px;
    color: var(--text-primary);
    font-weight: 500;
  }
</style>
