<script lang="ts">
  import { onMount } from 'svelte';
  import AuthTab from '$lib/components/AuthTab.svelte';

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  onMount(() => {
    console.log('Standalone Auth page mounted');

    // Set the page title
    document.title = 'Kanti - Auth';
  });
</script>

<div class="standalone-container">
  <AuthTab standalone={true} />
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
