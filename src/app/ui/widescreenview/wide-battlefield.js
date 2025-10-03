import { renderBattlefieldSkin } from '../views/battlefield/index.js';
import { getLocalSeatIndex } from '../../multiplayer/runtime.js';
import { renderWideCreature } from './wide-cards.js';

/**
 * Renders the full-viewport widescreen battlefield with colored skins for each player zone.
 * @param {Object} player - local player data
 * @param {Object} opponent - opponent player data
 * @param {Object} game - game state
 */
export function renderWideBattlefield({ player, opponent, game }) {
  const localSeatIndex = getLocalSeatIndex();
  const bottomPlayer = game.players[localSeatIndex];
  const topPlayer = game.players[localSeatIndex === 0 ? 1 : 0];

  // Render colored skins for each zone
  const topSkin = renderBattlefieldSkin(topPlayer.color, { isOpponent: true });
  const bottomSkin = renderBattlefieldSkin(bottomPlayer.color, { isOpponent: false });

  return `
    <div class="wide-battlefield">
      <div class="wide-battlefield-top">
        ${topSkin}
        <div class="wide-creature-zone" data-player="${game.players.indexOf(topPlayer)}">
          ${renderWideCreatureZone(topPlayer, game)}
        </div>
      </div>
      <div class="wide-battlefield-bottom">
        ${bottomSkin}
        <div class="wide-creature-zone" data-player="${game.players.indexOf(bottomPlayer)}">
          ${renderWideCreatureZone(bottomPlayer, game)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders creatures in widescreen layout with responsive sizing
 */
function renderWideCreatureZone(player, game) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const playerIndex = game.players.indexOf(player);
  
  if (!creatures.length) {
    return '<p class="wide-placeholder">No creatures</p>';
  }

  const creatureCards = creatures.map(creature => 
    renderWideCreature(creature, playerIndex, game)
  ).join('');

  return `<div class="wide-creature-grid">${creatureCards}</div>`;
}
