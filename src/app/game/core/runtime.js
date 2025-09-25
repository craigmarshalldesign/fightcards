import { state, requestRender } from '../../state.js';
import { runAI } from '../ai.js';

export function continueAIIfNeeded() {
  if (state.game?.currentPlayer === 1) {
    runAI();
  }
}

export function checkForWinner() {
  const game = state.game;
  if (!game || game.winner != null) return;
  if (game.players[0].life <= 0) {
    game.winner = 1;
    state.screen = 'game-over';
  } else if (game.players[1].life <= 0) {
    game.winner = 0;
    state.screen = 'game-over';
  }
  if (game.winner != null) {
    requestRender();
  }
}
