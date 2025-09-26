import { getLocalSeatIndex } from '../../../multiplayer/runtime.js';
import { escapeHtml } from './shared.js';

const PHASE_ORDER = ['main1', 'combat', 'main2'];

function getPhaseLabel(phase) {
  switch (phase) {
    case 'main1':
      return 'Main Phase';
    case 'combat':
      return 'Combat';
    case 'main2':
      return 'Second Main';
    default:
      return escapeHtml(phase || 'Unknown');
  }
}

export function renderPhaseIndicator(game) {
  if (!game) return '';
  const activeSeat = game.currentPlayer ?? 0;
  const localSeat = getLocalSeatIndex();
  const isLocalActive = activeSeat === localSeat;
  const activePlayer = game.players?.[activeSeat];
  const playerName = activePlayer?.name ? escapeHtml(activePlayer.name) : activeSeat === 0 ? 'Player 1' : 'Player 2';
  const turnLabel = `${playerName}'s Turn`;

  const stages = PHASE_ORDER.map((phaseKey) => {
    const isActivePhase = phaseKey === game.phase;
    const classes = ['phase-pill'];
    if (isActivePhase) {
      classes.push('active');
      if (isLocalActive) classes.push('local-turn');
    }
    return `
      <li class="phase-item">
        <span class="${classes.join(' ')}">
          <span class="phase-dot"></span>
          ${getPhaseLabel(phaseKey)}
        </span>
      </li>
    `;
  }).join('');

  return `
    <section class="phase-indicator" aria-label="Turn and Phase">
      <div class="phase-header">
        <span class="phase-turn">${turnLabel}</span>
        <span class="phase-active-seat">${isLocalActive ? 'Your turn' : 'Opponent'}</span>
      </div>
      <ul class="phase-track">${stages}</ul>
    </section>
  `;
}

