import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Provider type — MUST match the main-process LLM relay
// (src-main/llm/providers.ts). Local runtimes (Ollama / LM Studio) are not
// separate providers here: they are exposed as one-click PRESETS that set
// provider='custom' + the right OpenAI-compatible baseUrl.
export type Provider = 'openai' | 'deepseek' | 'gemini' | 'anthropic' | 'custom';

export const PROVIDERS: Provider[] = ['openai', 'deepseek', 'gemini', 'anthropic', 'custom'];

// Human-readable labels for the provider picker
export const providerLabels: Record<Provider, string> = {
  openai: 'OpenAI',
  deepseek: 'Deepseek',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  custom: 'Custom (OpenAI-compatible)'
};

// One-click presets for local runtimes. Each selects provider='custom' and
// points baseUrl at the runtime's OpenAI-compatible endpoint.
export interface CustomPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  hint: string;
}

export const customPresets: CustomPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    hint: 'Local Ollama server (default port 11434)'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    hint: 'LM Studio local server (default port 1234)'
  }
];

// Model configuration for each provider
export interface ModelConfig {
  models: string[];
  defaultModel: string;
}

// Provider model configurations
export interface ProviderModelConfigs {
  openai: ModelConfig;
  deepseek: ModelConfig;
  gemini: ModelConfig;
  anthropic: ModelConfig;
  custom: ModelConfig;
}

// API Keys interface (per-provider). For 'custom' the key is optional — most
// local runtimes ignore it.
export interface ApiKeyStore {
  openai: string;
  deepseek: string;
  gemini: string;
  anthropic: string;
  custom: string;
}

// Per-provider base URL overrides. Only 'custom' is normally used (it is
// required for local/self-hosted endpoints); the others fall back to the
// provider's official endpoint inside the relay when left blank.
export interface BaseUrlStore {
  openai: string;
  deepseek: string;
  gemini: string;
  anthropic: string;
  custom: string;
}

// Theme type
export type Theme = 'light' | 'dark' | 'system' | 'custom';

// Custom Theme interface
export interface CustomTheme {
  id: string;
  name: string;
  colors: {
    // Background colors
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgHover: string;
    bgActive: string;

    // Text colors
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    textMuted: string;

    // Border colors
    borderPrimary: string;
    borderSecondary: string;
    borderHover: string;

    // Accent colors
    accentPrimary: string;
    accentHover: string;
    accentLight: string;

    // Shadow colors
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;

    // Scrollbar colors
    scrollbarTrack: string;
    scrollbarThumb: string;
    scrollbarThumbHover: string;

    // Input colors
    inputBg: string;
    inputBorder: string;
    inputFocus: string;

    // Titlebar colors
    titlebarBg: string;
    titlebarText: string;
  };
  createdAt: number;
  updatedAt: number;
}

// Visual Settings interface
export interface VisualSettings {
  hideTopTabs: boolean;
  theme: Theme;
  customThemeId?: string;
  customThemes: CustomTheme[];
}

// Default model configurations for each provider
export const defaultModelConfigs: ProviderModelConfigs = {
  openai: {
    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o'
  },
  deepseek: {
    models: ['deepseek-chat', 'deepseek-coder'],
    defaultModel: 'deepseek-chat'
  },
  gemini: {
    models: ['gemini-pro', 'gemini-pro-vision'],
    defaultModel: 'gemini-pro'
  },
  anthropic: {
    models: ['claude-3-sonnet-20240229', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    defaultModel: 'claude-3-sonnet-20240229'
  },
  custom: {
    models: ['llama3.1', 'codellama', 'mistral', 'gemma2', 'phi3', 'qwen2.5', 'local-model'],
    defaultModel: 'llama3.1'
  }
};

// Default values
const defaultApiKeys: ApiKeyStore = {
  openai: '',
  deepseek: '',
  gemini: '',
  anthropic: '',
  custom: ''
};

const defaultBaseUrls: BaseUrlStore = {
  openai: '',
  deepseek: '',
  gemini: '',
  anthropic: '',
  custom: 'http://localhost:11434/v1'
};

// Map any legacy/unknown persisted provider onto the current supported set.
// Old builds shipped 'axonbox', 'ollama' and 'lmstudio'; the latter two now
// collapse into 'custom' (with an appropriate baseUrl) and axonbox falls back
// to custom as well.
function normalizeProvider(raw: string | null): Provider {
  if (raw && (PROVIDERS as string[]).includes(raw)) {
    return raw as Provider;
  }
  return 'custom';
}

// Create stores with default values
export const apiKeys = writable<ApiKeyStore>(defaultApiKeys);
export const baseUrls = writable<BaseUrlStore>(defaultBaseUrls);
export const currentProvider = writable<Provider>('openai');
export const modelConfigs = writable<ProviderModelConfigs>(defaultModelConfigs);
export const currentModel = writable<string>(defaultModelConfigs.openai.defaultModel);
export const visualSettings = writable<VisualSettings>({
  hideTopTabs: false,
  theme: 'system',
  customThemes: []
});

// Load from localStorage if in browser
if (browser) {
  try {
    const savedApiKeys: ApiKeyStore = {
      openai: localStorage.getItem('openai_api_key') || '',
      deepseek: localStorage.getItem('deepseek_api_key') || '',
      gemini: localStorage.getItem('gemini_api_key') || '',
      anthropic: localStorage.getItem('anthropic_api_key') || '',
      custom: localStorage.getItem('custom_api_key') || ''
    };

    apiKeys.set(savedApiKeys);

    const savedBaseUrls: BaseUrlStore = {
      openai: localStorage.getItem('openai_base_url') || '',
      deepseek: localStorage.getItem('deepseek_base_url') || '',
      gemini: localStorage.getItem('gemini_base_url') || '',
      anthropic: localStorage.getItem('anthropic_base_url') || '',
      // Migrate the old Ollama URL (bare host) if a custom URL isn't set yet.
      custom:
        localStorage.getItem('custom_base_url') ||
        (localStorage.getItem('ollama_api_key')
          ? `${localStorage.getItem('ollama_api_key')}/v1`.replace(/\/v1\/v1$/, '/v1')
          : '') ||
        defaultBaseUrls.custom
    };

    baseUrls.set(savedBaseUrls);

    // Load visual settings
    const savedVisualSettings = localStorage.getItem('visual_settings');
    if (savedVisualSettings) {
      try {
        const parsedSettings = JSON.parse(savedVisualSettings);
        // Normalize the shape so customThemes is always an array
        visualSettings.set({
          hideTopTabs: parsedSettings.hideTopTabs || false,
          theme: parsedSettings.theme || 'system',
          customThemeId: parsedSettings.customThemeId,
          customThemes: Array.isArray(parsedSettings.customThemes) ? parsedSettings.customThemes : []
        });
      } catch (e) {
        console.error('Failed to parse visual settings:', e);
      }
    }

    const rawProvider = localStorage.getItem('current_provider');
    const savedProvider = normalizeProvider(rawProvider);
    currentProvider.set(savedProvider);

    // If we migrated a legacy local provider, point custom at its endpoint.
    if (rawProvider === 'lmstudio') {
      baseUrls.update(urls => ({ ...urls, custom: 'http://localhost:1234/v1' }));
    } else if (rawProvider === 'ollama') {
      baseUrls.update(urls => ({ ...urls, custom: 'http://localhost:11434/v1' }));
    }

    // Load the saved model for this provider if available
    const savedModel = localStorage.getItem(`${savedProvider}_current_model`);
    if (savedModel) {
      currentModel.set(savedModel);
    } else {
      currentModel.set(defaultModelConfigs[savedProvider].defaultModel);
    }

    // Load saved model configurations if available
    const savedModelConfigs = localStorage.getItem('model_configs');
    if (savedModelConfigs) {
      try {
        const parsedConfigs = JSON.parse(savedModelConfigs) as Partial<ProviderModelConfigs>;
        // Merge over defaults so newly-added providers (e.g. 'custom') always
        // have a config even if the persisted blob predates them.
        modelConfigs.set({ ...defaultModelConfigs, ...parsedConfigs });
      } catch (e) {
        console.error('Failed to parse saved model configurations:', e);
      }
    }
  } catch (error) {
    console.error('Failed to load settings from localStorage:', error);
  }
}

// Subscribe to changes and save to localStorage
if (browser) {
  apiKeys.subscribe($apiKeys => {
    Object.entries($apiKeys).forEach(([provider, key]) => {
      localStorage.setItem(`${provider}_api_key`, key);
    });
  });

  baseUrls.subscribe($baseUrls => {
    Object.entries($baseUrls).forEach(([provider, url]) => {
      localStorage.setItem(`${provider}_base_url`, url);
    });
  });

  currentProvider.subscribe($provider => {
    localStorage.setItem('current_provider', $provider);

    // When provider changes, set the current model to the saved or default
    // model for that provider.
    const savedModel = localStorage.getItem(`${$provider}_current_model`);
    if (savedModel) {
      currentModel.set(savedModel);
    } else {
      currentModel.set(defaultModelConfigs[$provider].defaultModel);
    }
  });

  currentModel.subscribe($model => {
    // Get current provider to save the model selection for this provider
    const $provider = normalizeProvider(localStorage.getItem('current_provider'));
    if ($provider) {
      localStorage.setItem(`${$provider}_current_model`, $model);
    }
  });

  modelConfigs.subscribe($configs => {
    localStorage.setItem('model_configs', JSON.stringify($configs));
  });

  visualSettings.subscribe($settings => {
    localStorage.setItem('visual_settings', JSON.stringify($settings));
  });
}
