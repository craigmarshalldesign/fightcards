import { state } from '../../state.js';
import { getLogEntries } from '../../game/log.js';
import { getLocalSeatIndex } from '../../multiplayer/runtime.js';
import { renderWideBattlefield } from './wide-battlefield.js';
import { renderWideLifeGlobes } from './wide-lifeglobes.js';
import { renderWidePlayerBars } from './wide-playerbars.js';
import { renderWidePhaseBox } from './wide-phasebox.js';
import { renderWideHand } from './wide-hand.js';
import { renderWideActiveSpellSlot } from './wide-activespellslot.js';
import { renderTargetLines, renderAttackLines } from '../views/game/battlefield.js';
import { renderWideCombatBar } from './wide-combatbar.js';
import { renderWideLogs } from './wide-logs.js';
import { renderCardPreviewModal, renderEndGameModal } from '../views/game/modals.js';
import { renderGraveyardModal } from '../views/graveyardView.js';
import { renderWideSettingsMenu } from './wide-settings-menu.js';
import { renderWideCardPreview } from './wide-cardpreview.js';

/**
 * Main widescreen view renderer for active games.
 * This is a parallel implementation to renderGame() that composes widescreen-specific layouts
 * while reusing existing game logic and event handlers.
 */
export function renderGameWide() {
  const { game } = state;
  if (!game) return '';

  // CRITICAL: Use local seat to determine which player is "you" vs "opponent"
  const localSeatIndex = getLocalSeatIndex();
  const player = game.players[localSeatIndex];
  const opponentIndex = localSeatIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];

  const battleLogEntries = getLogEntries(game, 'battle');
  const spellLogEntries = getLogEntries(game, 'spell');

  const isHandOpen = state.ui.wideHandOpen || false;

  return `
    <div class="wide-mobile-wrapper">
      <div class="view game-view wide-game-view">
        ${renderWideBattlefield({ player, opponent, game })}

        <!-- Widescreen overlays -->
        <div class="wide-overlays">
          ${renderWideLifeGlobes({ player, opponent, game, localSeatIndex, opponentIndex })}
          ${renderWidePlayerBars({ player, opponent, game, localSeatIndex, opponentIndex })}
          ${renderWidePhaseBox(game)}
          ${renderWideActiveSpellSlot(game)}
          ${renderWideCombatBar(game)}
          ${renderWideLogs({ battleLogEntries, spellLogEntries })}
        </div>

        ${renderWideHand(player, game, isHandOpen)}
        ${renderWideSettingsMenu()}
        ${renderWideCardPreview()}
        ${renderTargetLines(game)}
        ${renderAttackLines(game)}
        ${renderCardPreviewModal(game)}
        ${renderGraveyardModal(game)}
        ${renderEndGameModal()}
      </div>
    </div>
  `;
}

