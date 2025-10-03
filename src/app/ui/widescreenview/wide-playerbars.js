import { getLocalSeat } from '../../multiplayer/runtime.js';

/**
 * Renders floating player stat bars for widescreen view.
 * These bars are identical to classic view stat bars but positioned in corners.
 * Top-left: opponent stats
 * Bottom-left: player stats
 */
export function renderWidePlayerBars({ player, opponent, game, localSeatIndex, opponentIndex }) {
  const localSeat = getLocalSeat();
  const isHostLocal = localSeat === 'host' || !localSeat;
  
  // Determine which player is which for positioning
  const topPlayer = isHostLocal ? game.players[1] : game.players[0];
  const bottomPlayer = isHostLocal ? game.players[0] : game.players[1];
  const topPlayerIndex = game.players.indexOf(topPlayer);
  const bottomPlayerIndex = game.players.indexOf(bottomPlayer);
  
  const topLife = topPlayer.life ?? 20;
  const topMaxLife = topPlayer.maxLife ?? 20;
  const bottomLife = bottomPlayer.life ?? 20;
  const bottomMaxLife = bottomPlayer.maxLife ?? 20;
  
  return `
    <div class="wide-player-bars-container">
      <!-- Top-left: Opponent Stats -->
      <div class="wide-player-bar opponent-bar">
        ${renderPlayerStatContent(topPlayer, game, topPlayerIndex, true)}
      </div>
      <!-- Opponent life globe below bar -->
      <div class="floating-life-globe opponent-globe">
        ${renderCompactLifeGlobe(topLife, topMaxLife, sanitizeClass(topPlayer.color || 'neutral'))}
      </div>

      <!-- Player life globe above bar -->
      <div class="floating-life-globe player-globe">
        ${renderCompactLifeGlobe(bottomLife, bottomMaxLife, sanitizeClass(bottomPlayer.color || 'neutral'))}
      </div>
      <!-- Bottom-left: Player Stats -->
      <div class="wide-player-bar player-bar">
        ${renderPlayerStatContent(bottomPlayer, game, bottomPlayerIndex, false)}
      </div>
    </div>
  `;
}

function renderPlayerStatContent(player, game, playerIndex, isOpponent) {
  const localSeat = getLocalSeat();
  const isLocal = (localSeat === 'host' && player === game.players[0]) || 
                  (localSeat === 'guest' && player === game.players[1]) || 
                  (!localSeat && player === game.players[0]);
  
  const deckCount = player.deck.length;
  const handCount = player.hand.length;
  const graveCount = player.graveyard.length;
  const colorClass = sanitizeClass(player.color || 'neutral');

  return `
    <div class="wide-stat-content player-color-${colorClass}">
      <div class="player-identity">
        <div class="player-icon">${renderDeckIcon(player.color)}</div>
        <div class="player-info">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-type">${isLocal ? 'You' : 'Opp'}</div>
        </div>
      </div>

      <div class="card-counts-compact">
        <div class="card-count-item">
          <div class="count-icon-clean">💎</div>
          <div class="count-value">${player.availableMana}/${player.maxMana}</div>
        </div>
        <div class="card-count-item">
          <div class="count-icon-clean">🎴</div>
          <div class="count-value">${deckCount}</div>
        </div>
        <div class="card-count-item">
          <div class="count-icon-clean">🪬</div>
          <div class="count-value">${handCount}</div>
        </div>
        <div class="card-count-item" data-open-grave="${playerIndex}" tabindex="0" role="button" aria-label="Open graveyard">
          <div class="count-icon-clean">💀</div>
          <div class="count-value">${graveCount}</div>
        </div>
      </div>
    </div>
  `;
}

function renderCompactLifeGlobe(life, maxLife, colorClass) {
  const percentage = Math.max(0, Math.min(100, (life / maxLife) * 100));
  const displayLife = Math.max(0, life);
  
  // Color based on health percentage
  let fillColor = '#22c55e'; // green
  let glowColor = 'rgba(34, 197, 94, 0.5)';
  
  if (percentage <= 25) {
    fillColor = '#ef4444'; // red
    glowColor = 'rgba(239, 68, 68, 0.5)';
  } else if (percentage <= 50) {
    fillColor = '#f59e0b'; // amber
    glowColor = 'rgba(245, 158, 11, 0.5)';
  } else if (percentage <= 75) {
    fillColor = '#eab308'; // yellow
    glowColor = 'rgba(234, 179, 8, 0.5)';
  }

  return `
    <div class="compact-life-globe" style="--life-percentage: ${percentage}%; --fill-color: ${fillColor}; --glow-color: ${glowColor};">
      <div class="compact-globe-inner">
        <svg viewBox="0 0 100 100" class="compact-globe-bg">
          <circle cx="50" cy="50" r="45" fill="rgba(17, 24, 39, 0.8)" stroke="rgba(71, 85, 105, 0.6)" stroke-width="2"/>
        </svg>
        <svg viewBox="0 0 100 100" class="compact-globe-fill">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--fill-color)" stroke-width="5" 
            stroke-dasharray="282.7" 
            stroke-dashoffset="calc(282.7 - (282.7 * var(--life-percentage) / 100))"
            stroke-linecap="round"
            transform="rotate(-90 50 50)"
            style="filter: drop-shadow(0 0 4px var(--glow-color))"/>
        </svg>
        <div class="compact-globe-text">${displayLife}</div>
      </div>
    </div>
  `;
}

function renderDeckIcon(color) {
  const c = (color || 'neutral').toLowerCase();
  if (c === 'red') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="flameGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#fb923c" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <path fill="url(#flameGrad)" d="M12 2c1.5 3.5-.5 5.5-1.5 6.5-1 .9-1.5 1.9-1.5 3 0 2.5 2 4 4 4 2.2 0 4-1.8 4-4 0-2.8-2.2-4.6-3.2-6.9-.4-.9-.6-1.8-.8-2.6z"/>
        <path fill="#fde68a" opacity="0.9" d="M12 10c-.7.8-1 1.4-1 2.1 0 1.1.9 1.9 2 1.9s2-.8 2-1.9c0-1.2-1-2-1.8-3.2-.3.5-.7.8-1.2 1.1z"/>
      </svg>`;
  }
  if (c === 'blue') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="waterGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" />
            <stop offset="100%" stop-color="#1d4ed8" />
          </linearGradient>
        </defs>
        <path fill="url(#waterGrad)" d="M12 2c3.5 5 7 7.9 7 12a7 7 0 1 1-14 0c0-4.1 3.5-7 7-12z"/>
        <circle cx="10" cy="14" r="2" fill="#bfdbfe" opacity="0.7"/>
      </svg>`;
  }
  if (c === 'green') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="leafGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#86efac" />
            <stop offset="100%" stop-color="#22c55e" />
          </linearGradient>
        </defs>
        <path fill="url(#leafGrad)" d="M20 4c-7 0-12 4-14 8 0 5 4 8 8 8 6 0 8-7 6-16z"/>
        <path d="M8 14c2-2 6-4 10-4" stroke="#065f46" stroke-width="1.5" fill="none" opacity="0.6"/>
      </svg>`;
  }
  return '';
}

function sanitizeClass(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

