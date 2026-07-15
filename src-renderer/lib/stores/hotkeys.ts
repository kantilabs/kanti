import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Hotkey configuration interface
export interface HotkeyConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  category: 'navigation' | 'actions' | 'tools';
  enabled: boolean;
}

// Hotkey store interface
export interface HotkeyStore {
  tabNavigation: {
    tab1: string;
    tab2: string;
    tab3: string;
    tab4: string;
    tab5: string;
    tab6: string;
    tab7: string;
    tab8: string;
    tab9: string;
  };
  actions: {
    newRequest: string;
    sendRequest: string;
    toggleSidebar: string;
    toggleTabs: string;
    search: string;
  };
  enabled: boolean;
}

// Default hotkey configurations
export const defaultHotkeyConfigs: HotkeyConfig[] = [
  // Tab Navigation
  {
    id: 'tab1',
    name: 'Switch to Tab 1',
    description: 'Navigate to the first tab',
    defaultKey: 'Ctrl+1',
    currentKey: 'Ctrl+1',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab2',
    name: 'Switch to Tab 2',
    description: 'Navigate to the second tab',
    defaultKey: 'Ctrl+2',
    currentKey: 'Ctrl+2',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab3',
    name: 'Switch to Tab 3',
    description: 'Navigate to the third tab',
    defaultKey: 'Ctrl+3',
    currentKey: 'Ctrl+3',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab4',
    name: 'Switch to Tab 4',
    description: 'Navigate to the fourth tab',
    defaultKey: 'Ctrl+4',
    currentKey: 'Ctrl+4',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab5',
    name: 'Switch to Tab 5',
    description: 'Navigate to the fifth tab',
    defaultKey: 'Ctrl+5',
    currentKey: 'Ctrl+5',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab6',
    name: 'Switch to Tab 6',
    description: 'Navigate to the sixth tab',
    defaultKey: 'Ctrl+6',
    currentKey: 'Ctrl+6',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab7',
    name: 'Switch to Tab 7',
    description: 'Navigate to the seventh tab',
    defaultKey: 'Ctrl+7',
    currentKey: 'Ctrl+7',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab8',
    name: 'Switch to Tab 8',
    description: 'Navigate to the eighth tab',
    defaultKey: 'Ctrl+8',
    currentKey: 'Ctrl+8',
    category: 'navigation',
    enabled: true
  },
  {
    id: 'tab9',
    name: 'Switch to Tab 9',
    description: 'Navigate to the ninth tab',
    defaultKey: 'Ctrl+9',
    currentKey: 'Ctrl+9',
    category: 'navigation',
    enabled: true
  },
  // Actions
  {
    id: 'newRequest',
    name: 'New Request',
    description: 'Create a new request',
    defaultKey: 'Ctrl+N',
    currentKey: 'Ctrl+N',
    category: 'actions',
    enabled: true
  },
  {
    id: 'sendRequest',
    name: 'Send Request',
    description: 'Send the current request',
    defaultKey: 'Ctrl+Enter',
    currentKey: 'Ctrl+Enter',
    category: 'actions',
    enabled: true
  },
  {
    id: 'toggleSidebar',
    name: 'Toggle Sidebar',
    description: 'Show/hide the sidebar',
    defaultKey: 'Ctrl+B',
    currentKey: 'Ctrl+B',
    category: 'actions',
    enabled: true
  },
  {
    id: 'toggleTabs',
    name: 'Toggle Tabs',
    description: 'Show/hide the top tabs',
    defaultKey: 'Ctrl+T',
    currentKey: 'Ctrl+T',
    category: 'actions',
    enabled: true
  },
  {
    id: 'search',
    name: 'Search',
    description: 'Focus the search input',
    defaultKey: 'Ctrl+F',
    currentKey: 'Ctrl+F',
    category: 'actions',
    enabled: true
  }
];

// Create the hotkey store
export const hotkeyConfigs = writable<HotkeyConfig[]>(defaultHotkeyConfigs);
export const hotkeysEnabled = writable<boolean>(true);

// Load from localStorage if in browser
if (browser) {
  try {
    const savedHotkeyConfigs = localStorage.getItem('hotkey_configs');
    if (savedHotkeyConfigs) {
      try {
        const parsedConfigs = JSON.parse(savedHotkeyConfigs) as HotkeyConfig[];
        hotkeyConfigs.set(parsedConfigs);
      } catch (e) {
        console.error('Failed to parse saved hotkey configurations:', e);
      }
    }

    const savedHotkeysEnabled = localStorage.getItem('hotkeys_enabled');
    if (savedHotkeysEnabled) {
      hotkeysEnabled.set(savedHotkeysEnabled === 'true');
    }
  } catch (error) {
    console.error('Failed to load hotkey settings from localStorage:', error);
  }
}

// Subscribe to changes and save to localStorage
if (browser) {
  hotkeyConfigs.subscribe($configs => {
    localStorage.setItem('hotkey_configs', JSON.stringify($configs));
  });

  hotkeysEnabled.subscribe($enabled => {
    localStorage.setItem('hotkeys_enabled', $enabled.toString());
  });
}

// Utility functions
export function getHotkeyById(id: string): HotkeyConfig | undefined {
  let config: HotkeyConfig | undefined;
  hotkeyConfigs.subscribe($configs => {
    config = $configs.find(c => c.id === id);
  })();
  return config;
}

export function updateHotkey(id: string, updates: Partial<HotkeyConfig>): void {
  hotkeyConfigs.update($configs => {
    return $configs.map(config => 
      config.id === id ? { ...config, ...updates } : config
    );
  });
}

export function resetHotkey(id: string): void {
  const config = getHotkeyById(id);
  if (config) {
    updateHotkey(id, { currentKey: config.defaultKey });
  }
}

export function resetAllHotkeys(): void {
  hotkeyConfigs.update($configs => {
    return $configs.map(config => ({
      ...config,
      currentKey: config.defaultKey
    }));
  });
}

export function getHotkeyDisplay(key: string): string {
  // Replace modifier keys with platform-specific symbols
  return key
    .replace(/Ctrl/g, '⌘')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/Enter/g, '⏎');
}
