import { registerRenderer, setState, state, db } from './state.js';
import { renderApp } from './ui/renderRoot.js';
import { initBackground } from './background.js';
import { describeGameState } from './game/core/index.js';
import { cleanupRememberedLobbyForUser } from './ui/multiplayer/events.js';

export function setupApp(root) {
  root.innerHTML = '';
  const backgroundCanvas = document.createElement('canvas');
  backgroundCanvas.id = 'bg-canvas';
  root.appendChild(backgroundCanvas);

  const uiLayer = document.createElement('div');
  uiLayer.className = 'ui-layer';
  root.appendChild(uiLayer);

  registerRenderer(() => renderApp(uiLayer));
  initBackground(backgroundCanvas);
  renderApp(uiLayer);

  db.subscribeAuth((authState) => {
    if (authState.isLoading) {
      setState({
        auth: { loading: true, user: null, error: null },
        screen: 'loading',
      });
      return;
    }
    if (authState.error) {
      setState({
        auth: { loading: false, user: null, error: authState.error.message },
        screen: 'login',
      });
      return;
    }
    const user = authState.user ?? null;
    setState({
      auth: { loading: false, user, error: null },
      screen: user ? 'menu' : 'login',
    });
    if (user) {
      cleanupRememberedLobbyForUser(user.id);
    }
  });

  window.addEventListener('focus', () => {
    if (state.screen === 'game') {
      console.info('Current game state:', describeGameState());
    }
  });

  // Clean up match data when page is closed/refreshed
  window.addEventListener('beforeunload', async () => {
    if (state.multiplayer.currentMatchId) {
      const { deleteMatchData } = await import('./multiplayer/runtime.js');
      // Use sendBeacon for cleanup during page unload to ensure it completes
      await deleteMatchData(state.multiplayer.currentMatchId);
    }
  });
}
