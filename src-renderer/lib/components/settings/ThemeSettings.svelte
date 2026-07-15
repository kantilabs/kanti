<script lang="ts">
  import { visualSettings, type Theme, type CustomTheme } from '$lib/stores/settings';
  import CustomThemeEditor from './CustomThemeEditor.svelte';
  import { createCustomTheme, addCustomTheme, updateCustomTheme, deleteCustomTheme, setCustomTheme, applyCustomTheme, resetToDefaultTheme } from '$lib/utils/theme-manager';
  
  // Local state bound to the store
  let hideTopTabs = $visualSettings.hideTopTabs;
  let selectedTheme = $visualSettings.theme;
  let customThemes = $visualSettings.customThemes;
  let customThemeId = $visualSettings.customThemeId;
  
  // UI state
  let showCustomThemeEditor = false;
  let editingTheme: CustomTheme | null = null;
  
  // Handle toggle change
  function handleHideTabsChange() {
    visualSettings.update(settings => ({
      ...settings,
      hideTopTabs: hideTopTabs
    }));
  }
  
  // Handle theme change
  function handleThemeChange(theme: Theme) {
    selectedTheme = theme;
    visualSettings.update(settings => ({
      ...settings,
      theme: theme,
      customThemeId: theme === 'custom' ? settings.customThemeId : undefined
    }));
    
    // Apply custom theme if selected
    if (theme === 'custom' && customThemeId && customThemes) {
      const theme = customThemes.find(t => t.id === customThemeId);
      if (theme) {
        applyCustomTheme(theme);
      }
    } else {
      resetToDefaultTheme();
    }
  }
  
  // Handle custom theme selection
  function handleCustomThemeChange(themeId: string) {
    if (!customThemes) return;
    const theme = customThemes.find(t => t.id === themeId);
    if (theme) {
      setCustomTheme(themeId);
      applyCustomTheme(theme);
      // Update local state to reflect the change immediately
      selectedTheme = 'custom';
      customThemeId = themeId;
    }
  }
  
  // Create new custom theme
  function createNewTheme() {
    editingTheme = null;
    showCustomThemeEditor = true;
  }
  
  // Edit existing custom theme
  function editTheme(theme: CustomTheme) {
    editingTheme = theme;
    showCustomThemeEditor = true;
  }
  
  // Save custom theme
  function saveCustomTheme(theme: CustomTheme) {
    if (editingTheme) {
      updateCustomTheme(theme.id, theme);
    } else {
      addCustomTheme(theme);
    }
    showCustomThemeEditor = false;
    editingTheme = null;

    // Force re-render by pulling the latest list from the store so the new
    // theme appears immediately.
    customThemes = $visualSettings.customThemes;
  }

  // Delete custom theme
  function deleteCustomThemeHandler(themeId: string) {
    deleteCustomTheme(themeId);
    // Force re-render so the deleted theme disappears immediately.
    customThemes = $visualSettings.customThemes;
  }
  
  // Cancel theme editing
  function cancelThemeEditing() {
    showCustomThemeEditor = false;
    editingTheme = null;
  }

  // Helper function to check if a default theme is selected
  function isDefaultThemeSelected(theme: Theme): boolean {
    return selectedTheme === theme && selectedTheme !== 'custom';
  }
</script>

<div class="theme-settings">
  <h3>Visual Options</h3>
  
  <!-- Theme Selection -->
  <div class="form-group">
    <label>
      <span class="label-text">Theme</span>
      <p class="description">Choose your preferred color theme</p>
    </label>
    
    <div class="theme-options">
      <button 
        class="theme-option"
        class:selected={isDefaultThemeSelected('light')}
        on:click={() => handleThemeChange('light')}
      >
        <div class="theme-preview light-preview">
          <div class="preview-header"></div>
          <div class="preview-content"></div>
        </div>
        <span class="theme-name">Light</span>
      </button>
      
      <button 
        class="theme-option"
        class:selected={isDefaultThemeSelected('dark')}
        on:click={() => handleThemeChange('dark')}
      >
        <div class="theme-preview dark-preview">
          <div class="preview-header"></div>
          <div class="preview-content"></div>
        </div>
        <span class="theme-name">Dark</span>
      </button>
      
      <button 
        class="theme-option"
        class:selected={isDefaultThemeSelected('system')}
        on:click={() => handleThemeChange('system')}
      >
        <div class="theme-preview system-preview">
          <div class="preview-header"></div>
          <div class="preview-content"></div>
        </div>
        <span class="theme-name">System</span>
      </button>
    </div>
  </div>
  
  <!-- Custom Themes -->
  <div class="form-group">
    <label>
      <span class="label-text">Custom Themes</span>
      <p class="description">Create and manage your own custom color themes</p>
    </label>
    
    <!-- Custom Theme Selection -->
    {#if customThemes && customThemes.length > 0}
      <div class="custom-themes-section">
        <div class="custom-themes-header">
          <span class="section-label">Available Custom Themes</span>
          <button class="create-theme-btn" on:click={createNewTheme}>
            + Create New Theme
          </button>
        </div>
        
        <div class="custom-themes-list">
          {#each customThemes as theme}
            <div class="custom-theme-item" class:active={selectedTheme === 'custom' && customThemeId === theme.id}>
              <div class="theme-info">
                <div class="theme-name">
                  {theme.name}
                  {#if selectedTheme === 'custom' && customThemeId === theme.id}
                    <span class="active-indicator">● Active</span>
                  {/if}
                </div>
                <div class="theme-date">
                  Updated: {new Date(theme.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <div class="theme-actions">
                <button 
                  class="theme-action-btn select-btn"
                  class:selected={selectedTheme === 'custom' && customThemeId === theme.id}
                  on:click={() => handleCustomThemeChange(theme.id)}
                >
                  {selectedTheme === 'custom' && customThemeId === theme.id ? 'Selected' : 'Select'}
                </button>
                <button 
                  class="theme-action-btn edit-btn"
                  on:click={() => editTheme(theme)}
                >
                  Edit
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="no-custom-themes">
        <p>No custom themes created yet.</p>
        <button class="create-theme-btn primary" on:click={createNewTheme}>
          Create Your First Custom Theme
        </button>
      </div>
    {/if}
  </div>
  
  <!-- Custom Theme Editor -->
  {#if showCustomThemeEditor}
    <div class="custom-theme-editor-container">
      <CustomThemeEditor
        theme={editingTheme}
        onSave={saveCustomTheme}
        onCancel={cancelThemeEditing}
        onDelete={deleteCustomThemeHandler}
      />
    </div>
  {/if}
  
  <!-- Navigation Options -->
  <div class="form-group">
    <label>
      <span class="label-text">Navigation</span>
      <p class="description">Configure how navigation elements are displayed</p>
    </label>
    
    <div class="option-row">
      <div class="option-info">
        <span class="option-label">Hide Top Tabs</span>
        <p class="option-description">Hide the tab bar at the top of the page (use sidebar for navigation)</p>
      </div>
      <label class="toggle-switch">
        <input 
          type="checkbox" 
          bind:checked={hideTopTabs}
          on:change={handleHideTabsChange}
        />
        <span class="slider"></span>
      </label>
    </div>
  </div>
</div>

<style>
  .theme-settings {
    color: var(--text-primary);
  }
  
  .theme-settings h3 {
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-primary);
    color: var(--text-primary);
    font-size: 18px;
  }
  
  .form-group {
    margin-bottom: 25px;
    background-color: var(--bg-tertiary);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid var(--border-primary);
  }
  
  .label-text {
    display: block;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 5px;
    font-size: 16px;
  }
  
  .description {
    color: var(--text-secondary);
    font-size: 14px;
    margin: 5px 0 15px 0;
  }
  
  /* Theme Options */
  .theme-options {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 15px;
  }
  
  .theme-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 15px;
    background-color: var(--bg-secondary);
    border: 2px solid var(--border-primary);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .theme-option:hover {
    background-color: var(--bg-hover);
    border-color: var(--border-hover);
    transform: translateY(-2px);
  }
  
  .theme-option.selected {
    border-color: var(--accent-primary);
    background-color: var(--bg-hover);
  }
  
  .theme-preview {
    width: 100%;
    height: 80px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }
  
  .preview-header {
    height: 25%;
    width: 100%;
  }
  
  .preview-content {
    height: 75%;
    width: 100%;
  }
  
  .light-preview {
    background-color: #ffffff;
  }
  
  .light-preview .preview-header {
    background-color: #f0f0f0;
  }
  
  .light-preview .preview-content {
    background-color: #ffffff;
  }
  
  .dark-preview {
    background-color: #1e1e1e;
  }
  
  .dark-preview .preview-header {
    background-color: #212121;
  }
  
  .dark-preview .preview-content {
    background-color: #1e1e1e;
  }
  
  .system-preview {
    background: linear-gradient(to right, #ffffff 50%, #1e1e1e 50%);
  }
  
  .system-preview .preview-header {
    background: linear-gradient(to right, #f0f0f0 50%, #212121 50%);
  }
  
  .system-preview .preview-content {
    background: linear-gradient(to right, #ffffff 50%, #1e1e1e 50%);
  }
  
  .theme-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }
  
  /* Navigation Options */
  .option-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px;
    background-color: var(--bg-secondary);
    border-radius: 6px;
    margin-bottom: 10px;
  }
  
  .option-row:last-child {
    margin-bottom: 0;
  }
  
  .option-info {
    flex: 1;
  }
  
  .option-label {
    display: block;
    color: var(--text-primary);
    font-weight: 500;
    margin-bottom: 4px;
  }
  
  .option-description {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0;
  }
  
  /* Toggle Switch Styles */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 26px;
    flex-shrink: 0;
  }
  
  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-primary);
    transition: 0.3s;
    border-radius: 26px;
  }
  
  .slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }
  
  input:checked + .slider {
    background-color: var(--accent-primary);
  }
  
  input:checked + .slider:before {
    transform: translateX(24px);
  }
  
  .slider:hover {
    opacity: 0.9;
  }
  
  input:checked + .slider:hover {
    background-color: var(--accent-hover);
  }

  /* Custom Themes Styles */
  .custom-themes-section {
    margin-top: 15px;
  }

  .custom-themes-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  .section-label {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 14px;
  }

  .create-theme-btn {
    padding: 6px 12px;
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .create-theme-btn:hover {
    background-color: var(--bg-hover);
  }

  .create-theme-btn.primary {
    background-color: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  .create-theme-btn.primary:hover {
    background-color: var(--accent-hover);
  }

  .custom-themes-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .custom-theme-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    transition: all 0.2s ease;
  }

  .custom-theme-item:hover {
    background-color: var(--bg-hover);
    border-color: var(--border-hover);
  }
  
  .custom-theme-item.active {
    border-color: var(--accent-primary);
    background-color: var(--bg-hover);
    box-shadow: 0 0 0 1px var(--accent-primary);
  }
  
  .active-indicator {
    color: var(--accent-primary);
    font-size: 11px;
    font-weight: 600;
    margin-left: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .theme-info {
    flex: 1;
  }

  .theme-name {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .theme-date {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .theme-actions {
    display: flex;
    gap: 8px;
  }

  .theme-action-btn {
    padding: 4px 8px;
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .theme-action-btn:hover {
    background-color: var(--bg-hover);
  }

  .theme-action-btn.selected {
    background-color: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  .select-btn {
    background-color: var(--bg-tertiary);
  }

  .edit-btn {
    background-color: var(--bg-tertiary);
  }

  .no-custom-themes {
    text-align: center;
    padding: 20px;
    background-color: var(--bg-secondary);
    border-radius: 6px;
    border: 1px dashed var(--border-primary);
  }

  .no-custom-themes p {
    margin: 0 0 15px 0;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .custom-theme-editor-container {
    margin-top: 20px;
  }
</style>
