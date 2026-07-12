import { get } from 'svelte/store';
import { hotkeyConfigs, hotkeysEnabled } from '$lib/stores/hotkeys';

export interface HotkeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string;
}

export class HotkeyManager {
  private listeners: Map<string, (() => void)[]> = new Map();
  private isListening = false;

  constructor() {
    this.setupGlobalListener();
  }

  private setupGlobalListener(): void {
    if (this.isListening) return;

    document.addEventListener('keydown', (event) => {
      if (!get(hotkeysEnabled)) return;

      // Don't trigger hotkeys when user is typing in input fields
      const target = event.target as HTMLElement;
      if (this.isInputElement(target)) return;

      const hotkeyString = this.eventToHotkeyString(event);
      this.triggerHotkey(hotkeyString, event);
    });

    this.isListening = true;
  }

  private isInputElement(element: HTMLElement): boolean {
    const inputTypes = ['input', 'textarea', 'select'];
    const contentEditable = element.getAttribute('contenteditable') === 'true';
    
    return inputTypes.includes(element.tagName.toLowerCase()) || contentEditable;
  }

  private eventToHotkeyString(event: KeyboardEvent): string {
    const parts: string[] = [];

    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Handle special keys
    const key = this.normalizeKey(event.key, event.code);
    if (key && !parts.includes(key)) {
      parts.push(key);
    }

    return parts.join('+');
  }

  public normalizeKey(key: string, code: string): string {
    // Handle number keys
    if (key.match(/^[1-9]$/)) return key;

    // Handle function keys
    if (key.match(/^F[1-9]$|^F1[0-2]$/)) return key;

    // Handle letter keys - convert to uppercase for consistency
    if (key.match(/^[a-z]$/)) return key.toUpperCase();

    // Handle special keys
    const specialKeys: { [key: string]: string } = {
      'Enter': 'Enter',
      'Escape': 'Escape',
      'Tab': 'Tab',
      'Space': 'Space',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Insert': 'Insert',
      ' ': 'Space'
    };

    return specialKeys[key] || key;
  }

  private triggerHotkey(hotkeyString: string, event?: KeyboardEvent): void {
    const configs = get(hotkeyConfigs);
    const matchingConfig = configs.find(config => 
      config.enabled && config.currentKey === hotkeyString
    );

    if (matchingConfig) {
      const listeners = this.listeners.get(matchingConfig.id) || [];
      listeners.forEach(listener => listener());
      
      // Prevent default behavior for hotkeys
      event?.preventDefault();
    }
  }

  public registerHotkey(hotkeyId: string, callback: () => void): void {
    if (!this.listeners.has(hotkeyId)) {
      this.listeners.set(hotkeyId, []);
    }
    this.listeners.get(hotkeyId)!.push(callback);
  }

  public unregisterHotkey(hotkeyId: string, callback?: () => void): void {
    if (!callback) {
      this.listeners.delete(hotkeyId);
    } else {
      const listeners = this.listeners.get(hotkeyId);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
        if (listeners.length === 0) {
          this.listeners.delete(hotkeyId);
        }
      }
    }
  }

  public parseHotkeyString(hotkeyString: string): { modifiers: string[], key: string } {
    const parts = hotkeyString.split('+');
    const modifiers = parts.slice(0, -1);
    const key = parts[parts.length - 1];
    return { modifiers, key };
  }

  public isValidHotkey(hotkeyString: string): boolean {
    if (!hotkeyString) return false;
    
    const parts = hotkeyString.split('+');
    if (parts.length === 0) return false;

    // Must have at least one modifier and one key
    if (parts.length < 2) return false;

    const validModifiers = ['Ctrl', 'Alt', 'Shift'];
    const lastPart = parts[parts.length - 1];

    // Check if all parts except the last are valid modifiers
    for (let i = 0; i < parts.length - 1; i++) {
      if (!validModifiers.includes(parts[i])) {
        return false;
      }
    }

    // Check if the last part is a valid key
    const validKeys = [
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown', 'Insert'
    ];

    return validKeys.includes(lastPart);
  }

  public formatHotkeyForDisplay(hotkeyString: string): string {
    const { modifiers, key } = this.parseHotkeyString(hotkeyString);
    
    const modifierSymbols = modifiers.map(mod => {
      switch (mod) {
        case 'Ctrl': return '⌘';
        case 'Alt': return '⌥';
        case 'Shift': return '⇧';
        default: return mod;
      }
    });

    const keySymbols: { [key: string]: string } = {
      'Enter': '⏎',
      'Space': '␣',
      'ArrowUp': '↑',
      'ArrowDown': '↓',
      'ArrowLeft': '←',
      'ArrowRight': '→',
      'Backspace': '⌫',
      'Delete': '⌦',
      'Tab': '⇥'
    };

    const displayKey = keySymbols[key] || key;
    
    return [...modifierSymbols, displayKey].join('');
  }

  public destroy(): void {
    this.listeners.clear();
    // Note: We don't remove the global listener as it's shared
  }
}

// Create a singleton instance
export const hotkeyManager = new HotkeyManager();
