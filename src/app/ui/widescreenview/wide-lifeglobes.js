/**
 * Renders floating life orbs for widescreen view.
 * CRITICAL: Must use same IDs and data attributes as classic view for targeting/attack lines.
 * - id="opponent-life-orb" and id="player-life-orb"
 * - data-player-target for click events
 */
import { isTargetablePlayer } from '../../game/core/index.js';

export function renderWideLifeGlobes({ player, opponent, game, localSeatIndex, opponentIndex }) {
  const maxLife = 30;
  
  // Opponent life orb (top center)
  const opponentLifePercentage = Math.max(0, Math.min(100, (opponent.life / maxLife) * 100));
  let opponentLifeColor = 'healthy';
  if (opponentLifePercentage <= 25) {
    opponentLifeColor = 'critical';
  } else if (opponentLifePercentage <= 50) {
    opponentLifeColor = 'warning';
  }

  // Player life orb (bottom center)
  const playerLifePercentage = Math.max(0, Math.min(100, (player.life / maxLife) * 100));
  let playerLifeColor = 'healthy';
  if (playerLifePercentage <= 25) {
    playerLifeColor = 'critical';
  } else if (playerLifePercentage <= 50) {
    playerLifeColor = 'warning';
  }

  // Check if life orbs are targetable (mirror classic logic)
  const pending = game.pendingAction;
  const isOpponentLifeTargetable = pending ? isTargetablePlayer(opponentIndex, pending) : false;
  const isPlayerLifeTargetable = pending ? isTargetablePlayer(localSeatIndex, pending) : false;

  const isOpponentLifeChosen = pending ? isPlayerTargeted(opponentIndex, pending) : false;
  const isPlayerLifeChosen = pending ? isPlayerTargeted(localSeatIndex, pending) : false;

  const opponentOrbClasses = ['wide-life-orb', `life-${opponentLifeColor}`];
  if (isOpponentLifeTargetable) opponentOrbClasses.push('targetable');
  if (isOpponentLifeChosen) opponentOrbClasses.push('targeted');

  const playerOrbClasses = ['wide-life-orb', `life-${playerLifeColor}`];
  if (isPlayerLifeTargetable) playerOrbClasses.push('targetable');
  if (isPlayerLifeChosen) playerOrbClasses.push('targeted');

  return `
    <div class="wide-life-globes-container">
      <!-- Opponent Life Orb (Top) -->
      <div class="wide-life-globe-wrapper opponent-globe">
        <div class="${opponentOrbClasses.join(' ')}" id="opponent-life-orb" data-player-target="${opponentIndex}">
          <div class="life-orb-fill" style="height: ${opponentLifePercentage}%"></div>
          <div class="life-value">${opponent.life}</div>
        </div>
      </div>

      <!-- Player Life Orb (Bottom) -->
      <div class="wide-life-globe-wrapper player-globe">
        <div class="${playerOrbClasses.join(' ')}" id="player-life-orb" data-player-target="${localSeatIndex}">
          <div class="life-orb-fill" style="height: ${playerLifePercentage}%"></div>
          <div class="life-value">${player.life}</div>
        </div>
      </div>
    </div>
  `;
}

function isPlayerTargeted(playerIndex, pending) {
  if (!pending) return false;
  return Boolean(
    pending.selectedTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
      pending.previewTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
      Object.values(pending.chosenTargets || {}).some((list) =>
        (list || []).some((target) => target.type === 'player' && target.controller === playerIndex),
      ),
  );
}

