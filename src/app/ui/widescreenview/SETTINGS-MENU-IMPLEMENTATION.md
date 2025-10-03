# Widescreen Settings Menu Implementation

## Overview
Implemented a settings dropdown menu for the widescreen view, replacing the old "Classic" button that was covering elements in the top-left corner. The widescreen view now automatically enters fullscreen mode when activated.

## Features

### Settings Icon
- **Location**: Top-right corner, to the right of the spell log panel
- **Design**: Circular button with a gear emoji (⚙️)
- **Styling**: 
  - 48px diameter circle
  - Semi-transparent dark background
  - Hover effects with scale animation
  - Positioned above logs (z-index: 1001)

### Dropdown Menu
- **Toggle behavior**: Click the gear icon to open/close
- **Close on outside click**: Automatically closes when clicking anywhere else
- **Menu options**:
  1. **⛶ Expand / 🗗 Collapse** - Toggle fullscreen mode (dynamically shows based on current state)
  2. **📱 Classic View** - Switches back to classic game view (also exits fullscreen)
  3. **🚪 End Game** - Opens the end game confirmation modal

### Fullscreen Integration
- **Auto-enter**: Switching to widescreen view automatically enters fullscreen mode
- **Auto-exit**: Switching back to classic view automatically exits fullscreen
- **Manual control**: Users can manually toggle fullscreen via the settings menu
- **ESC key support**: Pressing ESC exits fullscreen and updates the UI state accordingly
- **Cross-browser**: Supports Chrome, Firefox, Safari, and IE11 fullscreen APIs

### Styling Details
- Dropdown appears below the settings icon with a slide-down animation
- Semi-transparent dark theme matching the game UI
- Hover states for menu options
- "End Game" option has danger styling (red tint)

## Files Modified

### New Files
- `src/app/ui/widescreenview/wide-settings-menu.js` - Settings menu component

### Modified Files
1. `src/app/ui/widescreenview/index.js`
   - Imported `renderWideSettingsMenu`
   - Replaced old `renderWideViewModeToggle()` with `renderWideSettingsMenu()`

2. `src/app/ui/widescreenview/styles.css`
   - Removed old `.view-mode-toggle` styles
   - Added new styles for:
     - `.wide-settings-container`
     - `.wide-settings-icon`
     - `.wide-settings-dropdown`
     - `.wide-settings-option`

3. `src/app/ui/events.js`
   - Added fullscreen utility functions (`enterFullscreen`, `exitFullscreen`)
   - Added fullscreen change listener to track ESC key presses
   - Added event handler for `toggle-wide-settings` action
   - Added event handlers for `enter-fullscreen` and `exit-fullscreen` actions
   - Updated `toggle-viewmode` handler to auto-enter/exit fullscreen
   - Added click-outside handler to close dropdown
   - Updated existing handlers to close settings menu when appropriate

4. `src/app/state.js`
   - Added `wideSettingsMenuOpen: false` to UI state
   - Added `isFullscreen: false` to track fullscreen state

5. `src/app/ui/widescreenview/styles.css`
   - Updated `.wide-logs-row` positioning to make room for settings icon
   - Settings icon positioned at `right: 0.5rem` (far right edge)

## Usage
1. Switch to widescreen view (automatically enters fullscreen)
2. Click the gear icon in the top-right corner
3. Options available:
   - **Collapse**: Exit fullscreen while staying in widescreen view
   - **Expand**: Enter fullscreen mode
   - **Classic View**: Return to classic layout (exits fullscreen)
   - **End Game**: End the current game (shows confirmation modal)
4. Press ESC at any time to exit fullscreen (state updates automatically)

## Technical Notes
- Uses `data-action` attributes for event handling consistency
- Maintains existing game logic - only changes the UI presentation
- Fullscreen API with cross-browser support (Chrome, Firefox, Safari, IE11)
- Fullscreen state syncs with browser events (ESC key, F11, etc.)
- Dropdown position calculated to appear to the right of spell log
- State management integrated with existing UI state system
- Async/await pattern for fullscreen API calls

