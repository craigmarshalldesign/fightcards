import { state } from '../../state.js';

/**
 * Renders a settings menu dropdown in the top right corner
 * Contains options for switching to classic view and ending the game
 */
export function renderWideSettingsMenu() {
  const isOpen = state.ui.wideSettingsMenuOpen || false;
  
  return `
    <div class="wide-settings-container">
      <button 
        class="wide-settings-icon" 
        data-action="toggle-wide-settings"
        title="Settings"
        aria-label="Open settings menu"
      >
        ⚙️
      </button>
      ${isOpen ? renderSettingsDropdown() : ''}
    </div>
  `;
}

function renderSettingsDropdown() {
  const isFullscreen = state.ui.isFullscreen || false;
  
  return `
    <div class="wide-settings-dropdown">
      ${renderFullscreenOption(isFullscreen)}
      <button 
        class="wide-settings-option" 
        data-action="toggle-viewmode"
        title="Switch to classic view"
      >
        📱 Classic View
      </button>
      <button 
        class="wide-settings-option danger" 
        data-action="show-end-game-modal"
        title="End the current game"
      >
        🚪 End Game
      </button>
    </div>
  `;
}

function renderFullscreenOption(isFullscreen) {
  if (isFullscreen) {
    return `
      <button 
        class="wide-settings-option" 
        data-action="exit-fullscreen"
        title="Exit fullscreen mode"
      >
        🗗 Collapse
      </button>
    `;
  } else {
    return `
      <button 
        class="wide-settings-option" 
        data-action="enter-fullscreen"
        title="Enter fullscreen mode"
      >
        ⛶ Expand
      </button>
    `;
  }
}

