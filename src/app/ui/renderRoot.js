import { state } from '../state.js';
import { renderLoading, renderLogin, renderMenu, renderModeSelect, renderColorSelect, renderGameOver } from './views/basicViews.js';
import { renderGame } from './views/game/index.js';
import { attachEventHandlers } from './events.js';
import { enhanceView } from './effects/index.js';

export function renderApp(root) {
  const { screen } = state;
  let content = '';
  if (screen === 'loading') {
    content = renderLoading();
  } else if (screen === 'login') {
    content = renderLogin();
  } else if (screen === 'menu') {
    content = renderMenu();
  } else if (screen === 'mode-select') {
    content = renderModeSelect();
  } else if (screen === 'color-select') {
    content = renderColorSelect();
  } else if (screen === 'game') {
    content = renderGame();
  } else if (screen === 'game-over') {
    content = renderGameOver();
  }
  root.innerHTML = content;
  attachEventHandlers(root);
  enhanceView(root, screen);
}
