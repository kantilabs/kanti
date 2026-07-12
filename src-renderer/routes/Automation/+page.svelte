<script lang="ts">
  import { onMount } from 'svelte';
  import AutomationTab from '$lib/components/AutomationTab.svelte';
  
  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  
  onMount(() => {
    console.log('Standalone Automation page mounted');
    
    // Set the page title
    document.title = 'Kanti - Automation';
  });
</script>

<div class="standalone-container">
  <AutomationTab />
</div>

<style>
  :global(body) {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    height: calc(100vh - 40px);
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
  
  .standalone-container {
    padding: 10px;
  }
</style>
