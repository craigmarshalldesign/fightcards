import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

/**
 * Renders floating phase indicator for widescreen view
 * Shows current phase with visual feedback in horizontal layout
 * Includes turn status on the left
 */
export function renderWidePhaseIndicator(game) {
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;
  
  const turnStatus = !isLocalTurn 
    ? '<div class="wide-phase-turn-status">Opponent\'s Turn</div>'
    : '';
  
  return `
    <div class="wide-phase-indicator-horizontal ${isLocalTurn ? 'local-turn' : ''}">
      ${turnStatus}
      ${renderPhaseItem('main1', 'Main 1', game)}
      ${renderPhaseItem('combat', 'Combat', game)}
      ${renderPhaseItem('main2', 'Main 2', game)}
    </div>
  `;
}

function renderPhaseItem(phaseKey, phaseLabel, game) {
  const isActive = game.phase === phaseKey;
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;
  
  return `
    <div class="wide-phase-pill ${isActive ? 'active' : ''} ${isActive && isLocalTurn ? 'local-turn' : ''}">
      <span class="phase-dot"></span>
      <span class="phase-name">${phaseLabel}</span>
    </div>
  `;
}

