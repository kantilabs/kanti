import { visualSettings, type CustomTheme } from '$lib/stores/settings';

// Default theme templates (light + dark) used as bases for custom themes
export const defaultThemes: Record<string, Partial<CustomTheme>> = {
  light: {
    name: 'Light',
    colors: {
      bgPrimary: '#ffffff',
      bgSecondary: '#f5f5f5',
      bgTertiary: '#e8e8e8',
      bgHover: '#e0e0e0',
      bgActive: '#d5d5d5',
      textPrimary: '#1a1a1a',
      textSecondary: '#4a4a4a',
      textTertiary: '#6a6a6a',
      textMuted: '#9a9a9a',
      borderPrimary: '#d0d0d0',
      borderSecondary: '#e0e0e0',
      borderHover: '#b0b0b0',
      accentPrimary: '#ff5252',
      accentHover: '#ff3838',
      accentLight: '#ff8080',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      shadowMd: '0 4px 6px rgba(0, 0, 0, 0.1)',
      shadowLg: '0 10px 15px rgba(0, 0, 0, 0.1)',
      scrollbarTrack: '#f0f0f0',
      scrollbarThumb: '#c0c0c0',
      scrollbarThumbHover: '#a0a0a0',
      inputBg: '#ffffff',
      inputBorder: '#d0d0d0',
      inputFocus: '#ff5252',
      titlebarBg: '#f0f0f0',
      titlebarText: '#1a1a1a'
    }
  },
  dark: {
    name: 'Dark',
    colors: {
      bgPrimary: '#1e1e1e',
      bgSecondary: '#252525',
      bgTertiary: '#2a2a2a',
      bgHover: '#333333',
      bgActive: '#3a3a3a',
      textPrimary: '#ffffff',
      textSecondary: '#e0e0e0',
      textTertiary: '#b0b0b0',
      textMuted: '#6a6a6a',
      borderPrimary: '#444444',
      borderSecondary: '#333333',
      borderHover: '#555555',
      accentPrimary: '#ff5252',
      accentHover: '#ff3838',
      accentLight: '#ff8080',
      shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
      shadowMd: '0 4px 6px rgba(0, 0, 0, 0.4)',
      shadowLg: '0 10px 15px rgba(0, 0, 0, 0.5)',
      scrollbarTrack: '#1e1e1e',
      scrollbarThumb: '#444444',
      scrollbarThumbHover: '#555555',
      inputBg: '#2a2a2a',
      inputBorder: '#444444',
      inputFocus: '#ff5252',
      titlebarBg: '#212121',
      titlebarText: '#ffffff'
    }
  }
};

// Backward-compat: the default (light) color set, kept as a standalone export
// for consumers that reference `defaultThemeColors` directly.
export const defaultThemeColors = defaultThemes.light.colors!;

// Generate a unique ID for custom themes
export function generateThemeId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Backward-compat alias
export const generateId = generateThemeId;

// Create a new custom theme. `name` defaults so no-arg callers keep working;
// `baseTheme` optionally seeds colors from one of the default themes.
export function createCustomTheme(name: string = 'New Theme', baseTheme?: string): CustomTheme {
  const baseColors = (baseTheme ? defaultThemes[baseTheme]?.colors : undefined) ?? defaultThemes.light.colors;

  return {
    id: generateThemeId(),
    name,
    colors: { ...baseColors! },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Add a custom theme to the store
export function addCustomTheme(theme: CustomTheme): void {
  visualSettings.update(settings => ({
    ...settings,
    customThemes: [...settings.customThemes, theme]
  }));
}

// Update an existing custom theme
export function updateCustomTheme(themeId: string, updates: Partial<CustomTheme>): void {
  visualSettings.update(settings => ({
    ...settings,
    customThemes: settings.customThemes.map(theme =>
      theme.id === themeId
        ? { ...theme, ...updates, updatedAt: Date.now() }
        : theme
    )
  }));
}

// Delete a custom theme
export function deleteCustomTheme(themeId: string): void {
  visualSettings.update(settings => {
    const updatedCustomThemes = settings.customThemes.filter(theme => theme.id !== themeId);

    // If the deleted theme was currently selected, fall back to system theme
    const shouldResetTheme = settings.customThemeId === themeId;

    return {
      ...settings,
      customThemes: updatedCustomThemes,
      ...(shouldResetTheme && {
        theme: 'system' as const,
        customThemeId: undefined
      })
    };
  });
}

// Set a custom theme as active
export function setCustomTheme(themeId: string): void {
  visualSettings.update(settings => ({
    ...settings,
    theme: 'custom',
    customThemeId: themeId
  }));
}

// Get a custom theme by ID
export function getCustomTheme(themeId: string): CustomTheme | undefined {
  let foundTheme: CustomTheme | undefined;

  // Synchronously read the current store value
  const unsubscribe = visualSettings.subscribe(settings => {
    foundTheme = settings.customThemes.find(theme => theme.id === themeId);
  });
  unsubscribe();

  return foundTheme;
}

// Backward-compat alias
export const getThemeById = getCustomTheme;

// Apply custom theme CSS variables to the document (inline overrides)
export function applyCustomTheme(theme: CustomTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  if (theme) {
    Object.entries(theme.colors).forEach(([key, value]) => {
      const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      root.style.setProperty(cssVarName, value);
    });
  }
}

// Reset to default theme by removing all inline custom-theme variables
export function resetToDefaultTheme(): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  Object.keys(defaultThemes.light.colors!).forEach(key => {
    const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.removeProperty(cssVarName);
  });
}

// Export theme as JSON
export function exportTheme(theme: CustomTheme): string {
  return JSON.stringify(theme, null, 2);
}

// Import theme from JSON with strict validation
export function importTheme(jsonString: string): CustomTheme | null {
  try {
    const themeData = JSON.parse(jsonString);

    // Strict validation: must match the CustomTheme interface exactly
    if (
      typeof themeData === 'object' &&
      themeData !== null &&
      typeof themeData.id === 'string' &&
      typeof themeData.name === 'string' &&
      typeof themeData.colors === 'object' &&
      themeData.colors !== null &&
      typeof themeData.createdAt === 'number' &&
      typeof themeData.updatedAt === 'number' &&

      // Validate all required color properties exist and are strings
      typeof themeData.colors.bgPrimary === 'string' &&
      typeof themeData.colors.bgSecondary === 'string' &&
      typeof themeData.colors.bgTertiary === 'string' &&
      typeof themeData.colors.bgHover === 'string' &&
      typeof themeData.colors.bgActive === 'string' &&
      typeof themeData.colors.textPrimary === 'string' &&
      typeof themeData.colors.textSecondary === 'string' &&
      typeof themeData.colors.textTertiary === 'string' &&
      typeof themeData.colors.textMuted === 'string' &&
      typeof themeData.colors.borderPrimary === 'string' &&
      typeof themeData.colors.borderSecondary === 'string' &&
      typeof themeData.colors.borderHover === 'string' &&
      typeof themeData.colors.accentPrimary === 'string' &&
      typeof themeData.colors.accentHover === 'string' &&
      typeof themeData.colors.accentLight === 'string' &&
      typeof themeData.colors.shadowSm === 'string' &&
      typeof themeData.colors.shadowMd === 'string' &&
      typeof themeData.colors.shadowLg === 'string' &&
      typeof themeData.colors.scrollbarTrack === 'string' &&
      typeof themeData.colors.scrollbarThumb === 'string' &&
      typeof themeData.colors.scrollbarThumbHover === 'string' &&
      typeof themeData.colors.inputBg === 'string' &&
      typeof themeData.colors.inputBorder === 'string' &&
      typeof themeData.colors.inputFocus === 'string' &&
      typeof themeData.colors.titlebarBg === 'string' &&
      typeof themeData.colors.titlebarText === 'string'
    ) {
      return {
        ...themeData,
        id: generateThemeId(), // Generate new ID to avoid conflicts
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
  } catch (error) {
    console.error('Failed to import theme:', error);
  }

  return null;
}

// Duplicate an existing custom theme
export function duplicateTheme(themeId: string): void {
  const originalTheme = getCustomTheme(themeId);
  if (!originalTheme) return;

  const duplicatedTheme: CustomTheme = {
    ...originalTheme,
    id: generateThemeId(),
    name: `${originalTheme.name} (Copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  addCustomTheme(duplicatedTheme);
}
