<script lang="ts">
  import { onMount } from 'svelte';
  import WebSocketTab from '$lib/components/WebSocketTab.svelte';

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  onMount(() => {
    console.log('Standalone WebSocket page mounted');

    // Set the page title
    document.title = 'Kanti - WebSocket';
  });
</script>

<div class="standalone-container">
  <WebSocketTab standalone={true} />
</div>

<style>
  :global(body) {
    background-color: #212121;
    color: #fff;
    height: calc(100vh - 40px);
    margin: 0;
    padding: 0;
  }

  .standalone-container {
    height: 91%;
    width: 100%;
    padding: 10px;
  }
</style>
