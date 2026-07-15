<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { projectState } from '$lib/stores/project';
  import { scopeStore } from '$lib/stores/scope';
  import { visualSettings } from '$lib/stores/settings';
  import RequestsTab from '$lib/components/RequestsTab.svelte';
  import RepeaterTab from '$lib/components/RepeaterTab.svelte';
  import SettingsTab from '$lib/components/SettingsTab.svelte';
  import DecodeEncodeTab from '$lib/components/DecodeEncodeTab.svelte';
  import FuzzTab from '$lib/components/FuzzTab.svelte';
  import ChatTab from '$lib/components/ChatTab.svelte';
  import SitemapTab from '$lib/components/SitemapTab.svelte';
  import AutomationTab from '$lib/components/AutomationTab.svelte';
  import AuthTab from '$lib/components/AuthTab.svelte';
  import WebSocketTab from '$lib/components/WebSocketTab.svelte';
  import { hotkeyManager } from '$lib/utils/hotkey-manager';
  import '$lib/styles/context-menu.css';
  
  // Check if we should display the startup dialog
  let showStartupDialog = false;
  
  // State for sidebar visibility
  let sidebarVisible = true;
  
  // State for tabs visibility based on visual settings
  let hideTopTabs = $visualSettings.hideTopTabs;
  
  // Subscribe to visual settings changes
  $: hideTopTabs = $visualSettings.hideTopTabs;
  
  // Track the active sidebar item
  let activeSidebarItem = 'Requests';
  
  // Tabs array for reordering
  let tabs = ['Requests', 'Repeater', 'Fuzzer', 'Automation', 'Chat', 'Decode', 'Sitemap', 'Auth', 'WebSocket'];
  let draggedTab: string | null = null;
  let draggedOverTab: string | null = null;
  
  // Tab scrolling state
  let tabsContainer: HTMLElement;
  let showLeftScroll = false;
  let showRightScroll = false;
  
  // Function to toggle sidebar visibility
  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    // The CSS handles most of the toggle behavior with the class:collapsed binding
  }
  
  // Drag and drop handlers for tab reordering
  function handleDragStart(event: DragEvent, tabName: string) {
    draggedTab = tabName;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', tabName);
    }
    // Add dragging class to the element
    (event.target as HTMLElement).classList.add('dragging');
  }
  
  function handleDragOver(event: DragEvent, tabName: string) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    draggedOverTab = tabName;
  }
  
  function handleDragEnter(event: DragEvent, tabName: string) {
    event.preventDefault();
    if (draggedTab && draggedTab !== tabName) {
      (event.target as HTMLElement).classList.add('drag-over');
    }
  }
  
  function handleDragLeave(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('drag-over');
  }
  
  function handleDrop(event: DragEvent, tabName: string) {
    event.preventDefault();
    (event.target as HTMLElement).classList.remove('drag-over');
    
    if (!draggedTab || draggedTab === tabName) return;
    
    // Find the indices
    const draggedIndex = tabs.indexOf(draggedTab);
    const targetIndex = tabs.indexOf(tabName);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // Reorder the tabs array
    const newTabs = [...tabs];
    newTabs.splice(draggedIndex, 1);
    newTabs.splice(targetIndex, 0, draggedTab);
    tabs = newTabs;
    
    // Save the order to localStorage
    saveTabsOrder();
  }
  
  function handleDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('dragging');
    draggedTab = null;
    draggedOverTab = null;
    
    // Remove drag-over class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('drag-over');
    });
  }
  
  // Save tabs order to localStorage
  function saveTabsOrder() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('tabsOrder', JSON.stringify(tabs));
    }
  }
  
  // Load tabs order from localStorage
  function loadTabsOrder() {
    if (typeof localStorage !== 'undefined') {
      const savedOrder = localStorage.getItem('tabsOrder');
      if (savedOrder) {
        try {
          tabs = JSON.parse(savedOrder);
        } catch (e) {
          console.error('Failed to parse saved tabs order:', e);
        }
      }
    }
  }
  
  // Check if tabs are overflowing and update scroll button visibility
  function checkTabsOverflow() {
    if (!tabsContainer) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = tabsContainer;
    showLeftScroll = scrollLeft > 0;
    showRightScroll = scrollLeft + clientWidth < scrollWidth - 1;
  }
  
  // Scroll tabs left
  function scrollTabsLeft() {
    if (!tabsContainer) return;
    tabsContainer.scrollBy({ left: -200, behavior: 'smooth' });
    setTimeout(checkTabsOverflow, 100);
  }
  
  // Scroll tabs right
  function scrollTabsRight() {
    if (!tabsContainer) return;
    tabsContainer.scrollBy({ left: 200, behavior: 'smooth' });
    setTimeout(checkTabsOverflow, 100);
  }

  // Function to show the selected interface and hide others
  function showInterface(interfaceName: string) {
    // Get references to the interface elements
    const requestsInterface = document.getElementById('requests-interface') as HTMLElement;
    const repeaterInterface = document.getElementById('repeater-interface') as HTMLElement;
    const decodeEncodeInterface = document.getElementById('decode-encode-interface') as HTMLElement;
    const settingsInterface = document.getElementById('settings-interface') as HTMLElement;
    const chatInterface = document.getElementById('chat-interface') as HTMLElement;
    const fuzzerInterface = document.getElementById('fuzzer-interface') as HTMLElement;
    const sitemapInterface = document.getElementById('sitemap-interface') as HTMLElement;
    const automationInterface = document.getElementById('automation-interface') as HTMLElement;
    const authInterface = document.getElementById('auth-interface') as HTMLElement;
    const websocketInterface = document.getElementById('websocket-interface') as HTMLElement;
    const tabsBar = document.querySelector('.tabs-wrapper') as HTMLElement;

    if (!requestsInterface || !repeaterInterface || !decodeEncodeInterface || !settingsInterface || !sitemapInterface || !fuzzerInterface || !tabsBar) return;

    // Hide all interface panels
    requestsInterface.style.display = 'none';
    repeaterInterface.style.display = 'none';
    decodeEncodeInterface.style.display = 'none';
    settingsInterface.style.display = 'none';
    chatInterface.style.display = 'none';
    fuzzerInterface.style.display = 'none';
    sitemapInterface.style.display = 'none';
    if (automationInterface) automationInterface.style.display = 'none';
    if (authInterface) authInterface.style.display = 'none';
    if (websocketInterface) websocketInterface.style.display = 'none';

    // Show/hide tabs based on the selected interface and visual settings
    if (interfaceName === 'Settings' || hideTopTabs) {
      if (tabsBar) tabsBar.style.display = 'none';
    } else {
      if (tabsBar) tabsBar.style.display = 'flex';
    }
    
    // Show the selected interface
    if (interfaceName === 'Repeater') {
      repeaterInterface.style.display = 'block';
    } else if (interfaceName === 'Decode') {
      decodeEncodeInterface.style.display = 'block';
    } else if (interfaceName === 'Settings') {
      settingsInterface.style.display = 'block';
    } else if (interfaceName === 'Fuzzer') {
      fuzzerInterface.style.display = 'block';
    } else if (interfaceName === 'Automation') {
      if (automationInterface) automationInterface.style.display = 'block';
    } else if (interfaceName === 'Chat') {
      chatInterface.style.display = 'block';
    } else if (interfaceName === 'Sitemap') {
      sitemapInterface.style.display = 'block';
    } else if (interfaceName === 'Auth') {
      if (authInterface) authInterface.style.display = 'block';
    } else if (interfaceName === 'WebSocket') {
      if (websocketInterface) websocketInterface.style.display = 'block';
    } else if (interfaceName === 'Requests') {
      requestsInterface.style.display = 'block';
    } else {
      // Default view (Requests)

    }
    
    // Update the active sidebar item
    activeSidebarItem = interfaceName;
  }
  
  // Handle tab and sidebar item clicks
  function handleTabClick(event: Event) {
    const tab = event.currentTarget as HTMLElement;
    const tabs = document.querySelectorAll('.tab');
    
    // Update active tab
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Show corresponding interface
    showInterface(tab.textContent || '');
  }
  
  // Function to handle the right-click event on sidebar items
  function handleContextMenu(event: MouseEvent, tabName: string) {
    // Only handle right-clicks for Repeater and Requests tabs
    if (tabName !== 'Settings' && tabName !== 'Repeater' && tabName !== 'Requests' && tabName !== 'Fuzzer' && tabName !== 'Automation' && tabName !== 'Chat' && tabName !== 'Decode' && tabName !== 'Sitemap' && tabName !== 'Auth' && tabName !== 'WebSocket') return;
    
    // Prevent the default context menu
    event.preventDefault();
    
    // Create a context menu element
    const contextMenu = document.createElement('div');
    contextMenu.classList.add('context-menu');
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.style.top = `${event.clientY}px`;
    
    // Create the "Open in New Window" option
    const openInNewWindowOption = document.createElement('div');
    openInNewWindowOption.classList.add('context-menu-item');
    openInNewWindowOption.textContent = 'Open in New Window';
    
    // Add mouseleave handler to close menu when cursor leaves
    contextMenu.addEventListener('mouseleave', () => {
      if (document.body.contains(contextMenu)) {
        document.body.removeChild(contextMenu);
      }
      document.removeEventListener('click', handleClickOutside);
    });
    
    // Add click handler to open in new window
    openInNewWindowOption.addEventListener('click', () => {
      // Check if the electronAPI is available (only in Electron environment)
      if (window.electronAPI) {
        window.electronAPI.openTabInNewWindow(tabName);
      } else {
        console.warn('Electron API not available - this feature only works in the desktop app');
      }
      
      // Remove the context menu
      document.body.removeChild(contextMenu);
    });
    
    // Add the option to the menu
    contextMenu.appendChild(openInNewWindowOption);
    
    // Add the menu to the body
    document.body.appendChild(contextMenu);
    
    // Handle clicking outside the context menu
    function handleClickOutside(e: MouseEvent) {
      if (!contextMenu.contains(e.target as Node)) {
        if (document.body.contains(contextMenu)) {
          document.body.removeChild(contextMenu);
        }
        document.removeEventListener('click', handleClickOutside);
      }
    }
    
    // Add event listener for clicking outside
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
  }
  
  // Handle showing a specific tab when instructed by Electron
  function setupTabMessageListener() {
    if (window.electronAPI) {
      window.electronAPI.receive('showTab', (data) => {
        if (data && data.tabName) {
          const tabName = data.tabName;
          console.log(`Received instruction to show tab: ${tabName}`);
          
          // Find and click the corresponding tab
          const tabs = document.querySelectorAll('.tab');
          tabs.forEach(tab => {
            if (tab.textContent === tabName) {
              (tab as HTMLElement).click();
            }
          });
        }
      });
    }
  }
  

  // Set up project state change listener
  function setupProjectStateChangeListener() {
    if (window.electronAPI) {
      window.electronAPI.receive('project-state-changed', (data) => {
        console.log('Project state changed:', data);
        
        if (data && data.project) {
          // Update the project state in the store
          projectState.initialize(data.project);
          
          // If we're in startup mode, close the startup dialog
          if (showStartupDialog) {
            showStartupDialog = false;
          }
        }
      });
    }
  }

  // Function to initialize scope settings from backend
  async function initializeScopeSettings() {
    if (window.electronAPI && window.electronAPI.proxy) {
      try {
        // Load scope settings from backend
        const savedScopeSettings = await window.electronAPI.proxy.getScopeSettings();
        
        // Update the scope store with the loaded settings
        scopeStore.set(savedScopeSettings);
        console.log('Loaded scope settings at app initialization:', savedScopeSettings);
      } catch (error) {
        console.error('Failed to load scope settings during initialization:', error);
      }
    }
  }

  // Function to setup hotkey listeners
  function setupHotkeyListeners() {
    // Tab navigation hotkeys (Ctrl+1 through Ctrl+9)
    for (let i = 1; i <= 9; i++) {
      hotkeyManager.registerHotkey(`tab${i}`, () => {
        if (tabs.length >= i) {
          const tabName = tabs[i - 1];
          showInterface(tabName);

          // Update active tab in the UI
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          const targetTab = Array.from(document.querySelectorAll('.tab')).find(tab =>
            tab.textContent?.trim() === tabName
          ) as HTMLElement;
          if (targetTab) {
            targetTab.classList.add('active');
          }

          // Update active sidebar item
          activeSidebarItem = tabName;
        }
      });
    }

    // Action hotkeys
    hotkeyManager.registerHotkey('toggleSidebar', () => {
      toggleSidebar();
    });

    hotkeyManager.registerHotkey('toggleTabs', () => {
      // Toggle tabs visibility through the store to ensure reactivity
      visualSettings.update(settings => ({
        ...settings,
        hideTopTabs: !settings.hideTopTabs
      }));
    });

    // Note: Other action hotkeys like newRequest, sendRequest, search would need
    // to be implemented in their respective components
  }

  // Initialize the UI after component is mounted
  onMount(() => {
    // Load saved tabs order
    loadTabsOrder();
    
    // Apply initial tab visibility based on saved settings
    const tabsBar = document.querySelector('.tabs-wrapper') as HTMLElement;
    if (tabsBar && hideTopTabs) {
      tabsBar.style.display = 'none';
    }
    
    // Check URL parameters to see if we're in startup mode
    if ($page.url.searchParams.get('startup') === 'true') {
      console.log('Startup mode detected, showing startup dialog');
      showStartupDialog = true;
    } else {
      // If not in startup mode, try to get the current project
      if (window.electronAPI) {
        window.electronAPI.project.getCurrent().then((project: any) => {
          if (project) {
            projectState.initialize(project);
            console.log('Loaded current project:', project);
            
            // If project has scope settings, use them
            if (project.scopes) {
              scopeStore.set(project.scopes);
            } else {
              // Otherwise load from backend
              initializeScopeSettings();
            }
          } else {
            // No active project, load scope settings from backend
            initializeScopeSettings();
          }
        }).catch((err: any) => {
          console.error('Error getting current project:', err);
          // Still try to initialize scope settings
          initializeScopeSettings();
        });
      }
    }
    
    // Set up listeners
    setupTabMessageListener();
    setupProjectStateChangeListener();
    setupHotkeyListeners();
    
    // Add event listeners for tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => handleTabClick(e));
    });
    
    // Add event listeners for sidebar items
    document.querySelectorAll('.sidebar-item').forEach(item => {
      // Add click handler
      item.addEventListener('click', () => {
        const tabName = item.textContent || '';
        
        // Handle Settings tab separately since it doesn't have a corresponding tab in the tabs bar
        if (tabName === 'Settings') {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          showInterface('Settings');
          return;
        }
        
        // For other tabs, find the matching tab in the top bar
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
          if (tab.textContent === tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding interface
            showInterface(tabName);
          }
        });
      });
      
      // Add context menu handler for right-click
      item.addEventListener('contextmenu', (event: Event) => {
        const tabName = item.textContent || '';
        handleContextMenu(event as MouseEvent, tabName);
      });
    });
    
    // Set up tabs overflow detection
    if (tabsContainer) {
      checkTabsOverflow();
      tabsContainer.addEventListener('scroll', checkTabsOverflow);
      window.addEventListener('resize', checkTabsOverflow);
    }
    
    // Return cleanup function
    return () => {
      if (tabsContainer) {
        tabsContainer.removeEventListener('scroll', checkTabsOverflow);
      }
      window.removeEventListener('resize', checkTabsOverflow);

      // Clean up hotkey listeners
      for (let i = 1; i <= 9; i++) {
        hotkeyManager.unregisterHotkey(`tab${i}`);
      }
      hotkeyManager.unregisterHotkey('toggleSidebar');
      hotkeyManager.unregisterHotkey('toggleTabs');
    };
  });
  
</script>

<div class="app-container">

  <!-- Left Sidebar -->
  <div class="sidebar" class:collapsed={!sidebarVisible}>
    <div class="toggle-button" on:click={toggleSidebar}>
      {#if sidebarVisible}
        <span>◀</span>
      {:else}
        <span>▶</span>
      {/if}
    </div>
    <div class="sidebar-content" class:hidden={!sidebarVisible}>
      <div class="sidebar-section">
        <div class="sidebar-item" class:active={activeSidebarItem === 'Settings'}>
          <span class="label">Settings</span>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-item" class:active={activeSidebarItem === 'Requests'}>
          <span class="label">Requests</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Repeater'}>
          <span class="label">Repeater</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Fuzzer'}>
          <span class="label">Fuzzer</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Automation'}>
          <span class="label">Automation</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Chat'}>
          <span class="label">Chat</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Decode'}>
          <span class="label">Decode</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Sitemap'}>
          <span class="label">Sitemap</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'Auth'}>
          <span class="label">Auth</span>
        </div>
        <div class="sidebar-item" class:active={activeSidebarItem === 'WebSocket'}>
          <span class="label">WebSocket</span>
        </div>
      </div>
    </div>
    
    <!-- Icons view when collapsed -->
    {#if !sidebarVisible}
      <div class="sidebar-icons">
        <div class="icon-item" class:active={activeSidebarItem === 'Settings'} 
             on:click={() => { 
               showInterface('Settings'); 
               document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Settings')}>
          <span class="icon-only" title="Settings"><i class="fi fi-rr-settings"></i></span>
        </div>
        <div class="sidebar-divider"></div>
        <div class="icon-item" class:active={activeSidebarItem === 'Requests'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Requests') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Requests');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Requests')}>
          <span class="icon-only" title="Requests"><i class="fi fi-rr-rectangle-list"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Repeater'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Repeater') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Repeater');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Repeater')}>
          <span class="icon-only" title="Repeater"><i class="fi fi-sr-arrows-retweet"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Fuzzer'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Fuzzer') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Fuzzer');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Fuzzer')}>
          <span class="icon-only" title="Fuzzer"><i class="fi fi-rr-paper-plane"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Automation'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Automation') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Automation');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Automation')}>
          <span class="icon-only" title="Automation"><i class="fi fi-rr-diagram-project"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Chat'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Chat') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Chat');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Chat')}>
          <span class="icon-only" title="Chat"><i class="fi fi-rr-messages"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Decode'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Decode') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Decode');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Decode')}>
          <span class="icon-only" title="Decode"><i class="fi fi-rc-hat-chef"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Sitemap'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Sitemap') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Sitemap');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Sitemap')}>
          <span class="icon-only" title="Sitemap"><i class="fi fi-sr-track"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'Auth'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'Auth') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('Auth');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'Auth')}>
          <span class="icon-only" title="Auth"><i class="fi fi-rr-shield-check"></i></span>
        </div>
        <div class="icon-item" class:active={activeSidebarItem === 'WebSocket'}
             on:click={() => {
               const tabs = document.querySelectorAll('.tab');
               tabs.forEach(tab => {
                 if (tab.textContent === 'WebSocket') {
                   document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                   tab.classList.add('active');
                   showInterface('WebSocket');
                 }
               });
             }}
             on:contextmenu={(e) => handleContextMenu(e, 'WebSocket')}>
          <span class="icon-only" title="WebSocket"><i class="fi fi-rr-plug-connection"></i></span>
        </div>
      </div>
    {/if}
  </div>
  
  <!-- Main Content -->
  <div class="main-content">
    <!-- Tabs Bar with Navigation -->
    <div class="tabs-wrapper">
      {#if showLeftScroll}
        <button class="tab-scroll-button left" on:click={scrollTabsLeft} aria-label="Scroll left">
          <span>◀</span>
        </button>
      {/if}
      
      <div class="tabs" bind:this={tabsContainer}>
        {#each tabs as tabName, index (tabName)}
          <div 
            class="tab" 
            class:active={activeSidebarItem === tabName}
            draggable="true"
            on:dragstart={(e) => handleDragStart(e, tabName)}
            on:dragover={(e) => handleDragOver(e, tabName)}
            on:dragenter={(e) => handleDragEnter(e, tabName)}
            on:dragleave={handleDragLeave}
            on:drop={(e) => handleDrop(e, tabName)}
            on:dragend={handleDragEnd}
            on:click={handleTabClick}
          >
            {tabName}
          </div>
        {/each}
      </div>
      
      {#if showRightScroll}
        <button class="tab-scroll-button right" on:click={scrollTabsRight} aria-label="Scroll right">
          <span>▶</span>
        </button>
      {/if}
    </div>
    
    <!-- Main Panel - Contains all interfaces -->
    <div class="main-panel">
      <div id="requests-interface" class:no-tabs={hideTopTabs}>
        <RequestsTab />
      </div>

      <div id="repeater-interface" class:no-tabs={hideTopTabs}>
        <RepeaterTab />
      </div>
      
      <div id="decode-encode-interface" class:no-tabs={hideTopTabs}>
        <DecodeEncodeTab />
      </div>

      <div id="fuzzer-interface" class:no-tabs={hideTopTabs}>
        <FuzzTab />
      </div>

      <div id="automation-interface" class:no-tabs={hideTopTabs}>
        <AutomationTab />
      </div>

      <div id="chat-interface" class:no-tabs={hideTopTabs}>
        <ChatTab />
      </div>

      <div id="sitemap-interface" class:no-tabs={hideTopTabs}>
        <SitemapTab />
      </div>

      <div id="auth-interface" class:no-tabs={hideTopTabs}>
        <AuthTab />
      </div>

      <div id="websocket-interface" class:no-tabs={hideTopTabs}>
        <WebSocketTab />
      </div>

      <!-- Settings Interface -->
      <div id="settings-interface" class:no-tabs={hideTopTabs}>
        <SettingsTab />
      </div>
    </div>
  </div>
</div>



<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: Arial, sans-serif;
  }
  
  :global(body) {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    height: 100vh;
    overflow: hidden;
    margin: 0;
    padding: 0;
  }
  
.app-container {
    display: flex;
    flex-direction: row;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    position: relative;
  }
  
  
  .sidebar {
    position: relative;
    width: 200px;
    background-color: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease;
    border-radius: 4px;
    margin: 10px 10px 0 10px;
    box-shadow: var(--shadow-md);
    height: calc(100vh - 60px);
    overflow: hidden;
    z-index: 10;
    flex-shrink: 0;
    border: 1px solid var(--border-primary);
  }
  
  .sidebar.collapsed {
    width: 40px;
  }
  
  .toggle-button {
    position: sticky;
    top: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-hover);
    color: var(--text-primary);
    border-radius: 6px;
    cursor: pointer;
    z-index: 10;
    margin: 10px 10px 10px auto;
    flex-shrink: 0;
    transition: margin 0.3s ease;
  }
  
  .sidebar.collapsed .toggle-button {
    margin: 10px auto;
  }
  
  .sidebar-content {
    padding: 0 20px 20px 20px;
    display: flex;
    flex-direction: column;
    width: 100%;
    transition: opacity 0.3s ease;
  }
  
  .sidebar-content.hidden {
    opacity: 0;
    pointer-events: none;
  }
  
  .sidebar-section {
    margin-bottom: 20px;
  }
  
  .sidebar-item {
    padding: 10px;
    cursor: pointer;
    color: var(--text-secondary);
    border-radius: 8px;
    transition: background-color 0.2s ease;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .sidebar-item .icon {
    font-size: 18px;
    flex-shrink: 0;
  }
  
  .sidebar-item .label {
    white-space: nowrap;
  }
  
  .sidebar-item:hover {
    color: var(--text-primary);
    background-color: var(--bg-tertiary);
  }
  
  /* Add styling for active sidebar item with red color */
  .sidebar-item.active {
    color: var(--accent-primary);
  }
  
  /* Sidebar icons view when collapsed */
  .sidebar-icons {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 0 10px 0;
    width: 100%;
  }
  
  .icon-item {
    padding: 8px;
    cursor: pointer;
    border-radius: 6px;
    transition: background-color 0.2s ease;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 2px 0;
  }
  
  .icon-item:hover {
    background-color: var(--bg-tertiary);
  }
  
  .icon-item.active {
    background-color: var(--bg-tertiary);
  }
  
  .icon-only {
    font-size: 18px;
    filter: grayscale(20%);
  }
  
  .icon-item.active .icon-only {
    filter: hue-rotate(340deg) saturate(2);
  }
  
  .sidebar-divider {
    width: 24px;
    height: 1px;
    background-color: var(--border-primary);
    margin: 8px 0;
  }
  
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    transition: margin-left 0.3s ease;
    height: 100%;
    margin: 10px 10px 0 0;
    min-width: 0; /* Prevent flex items from overflowing */
  }
  
  .tabs-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 10px;
  }
  
  .tabs {
    display: flex;
    background-color: var(--bg-secondary);
    padding: 5px 10px;
    border-radius: 4px;
    box-shadow: var(--shadow-md);
    border: 1px solid var(--border-primary);
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }
  
  .tabs::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  
  .tab-scroll-button {
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s ease;
    box-shadow: var(--shadow-md);
    flex-shrink: 0;
    min-width: 36px;
    height: 36px;
  }
  
  .tab-scroll-button:hover {
    background-color: var(--bg-tertiary);
  }
  
  .tab-scroll-button:active {
    background-color: var(--bg-hover);
  }
  
  .tab-scroll-button span {
    font-size: 14px;
    line-height: 1;
  }
  
  .tab {
    padding: 10px 20px;
    cursor: pointer;
    color: var(--text-muted);
    text-align: center;
    border-radius: 7px;
    transition: background-color 0.2s ease;
    margin: 0 2px;
  }
  
  .tab:hover {
    background-color: var(--bg-tertiary);
  }
  
  .tab.active {
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    border: 2px solid var(--accent-primary);
  }
  
  /* Drag and drop styles */
  .tab.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
  
  .tab.drag-over {
    border-left: 3px solid var(--accent-primary);
    padding-left: 17px;
  }
  
  .tab {
    user-select: none;
    cursor: grab;
  }
  
  .tab:active {
    cursor: grabbing;
  }
  
  .main-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    background-color: transparent;
    border-radius: 4px;
    overflow: auto;
  }
  
  #requests-interface {
    height: calc(100vh - 192px);
  }

  #requests-interface.no-tabs {
    height: calc(100vh - 122px);
  }

  #repeater-interface {
    height: calc(100vh - 192px);
    display: none;
  }

  #repeater-interface.no-tabs {
    height: calc(100vh - 122px);
  }
  
  #fuzzer-interface {
    height: calc(100vh - 108px);
    overflow: auto;
    display: none;
  }

  #fuzzer-interface.no-tabs {
    height: calc(100vh - 35px);
  }
  
  #sitemap-interface {
    height: calc(100vh - 192px);
    display: none;
  }

  #sitemap-interface.no-tabs {
    height: calc(100vh - 122px);
  }

  #auth-interface {
    height: calc(100vh - 192px);
    display: none;
  }

  #auth-interface.no-tabs {
    height: calc(100vh - 122px);
  }

  #websocket-interface {
    height: calc(100vh - 192px);
    display: none;
  }

  #websocket-interface.no-tabs {
    height: calc(100vh - 122px);
  }

  #automation-interface {
    height: calc(100vh - 192px);
    display: none;
    overflow: hidden;
  }

  #automation-interface.no-tabs {
    height: calc(100vh - 122px);
  }

  #chat-interface {
    height: calc(100vh - 120px);
    display: none;
  }

  #chat-interface.no-tabs {
    height: calc(100vh - 50px);
  }

  #settings-interface {
    display: none;
    height: calc(100vh - 38px);
    width: 100%;
    background-color: transparent;
    border-radius: 4px;
    overflow: auto;
  }

  #decode-encode-interface {
    display: none;
    height: calc(100vh - 192px);
    width: 100%;
    background-color: transparent;
    border-radius: 4px;
    overflow: auto;
  }


  #decode-encode-interface.no-tabs {
    height: calc(100vh - 122px);
    overflow: auto;
  }
  

  :global(.input-container) {
    background-color: var(--bg-tertiary);
    border-radius: 8px;
    padding: 10px;
    margin-bottom: 10px;
  }

  :global(.table-container) {
    background-color: var(--bg-tertiary);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  :global(table) {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }

  :global(th, td) {
    padding: 10px;
    border-bottom: 1px solid var(--border-primary);
  }

  :global(button) {
    border-radius: 8px;
  }

  
  /* Startup dialog styles */
  .startup-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .startup-dialog {
    background-color: var(--bg-tertiary);
    width: 100%;
    max-width: 500px;
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    padding: 25px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .dialog-header {
    text-align: center;
    margin-bottom: 10px;
  }
  
  .dialog-header h1 {
    font-size: 24px;
    margin-bottom: 5px;
    color: var(--text-primary);
  }
  
  .dialog-header p {
    font-size: 16px;
    color: var(--text-secondary);
    margin: 0;
  }
  
  .dialog-content {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  .option-button {
    display: grid;
    grid-template-columns: 50px 1fr;
    grid-template-rows: auto auto;
    grid-template-areas: 
      "icon title"
      "icon description";
    align-items: center;
    background-color: var(--bg-hover);
    border: none;
    border-radius: 8px;
    padding: 15px;
    cursor: pointer;
    transition: background-color 0.2s;
    text-align: left;
    color: var(--text-primary);
  }
  
  .option-button:hover {
    background-color: var(--bg-active);
  }
  
  .option-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .option-icon {
    grid-area: icon;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 24px;
    color: var(--accent-primary);
  }
  
  .option-button span {
    grid-area: title;
    font-size: 16px;
    font-weight: bold;
    color: var(--text-primary);
  }
  
  .option-description {
    grid-area: description;
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }
</style>
