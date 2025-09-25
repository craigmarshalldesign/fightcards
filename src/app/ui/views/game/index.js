import { state } from '../../../state.js';
import { getLogEntries } from '../../../game/log.js';
import { renderGraveyardModal } from '../graveyardView.js';
import { renderTopStatusGrid } from './logs.js';
import { renderBattlefieldSection, renderPlayerStatBar, renderTargetLines, renderAttackLines } from './battlefield.js';
import { renderGameControls } from './controls.js';
import { renderHandArea } from './hand.js';
import { renderCardPreviewModal } from './modals.js';

export function renderGame() {
  const { game } = state;
  if (!game) return '';

  const player = game.players[0];
  const opponent = game.players[1];
  const battleLogEntries = getLogEntries(game, 'battle');
  const spellLogEntries = getLogEntries(game, 'spell');
  const blocking = game.blocking;
  const shouldShowBlocking = Boolean(blocking && game.currentPlayer === 1 && blocking.awaitingDefender);
  const shouldShowAttackers = Boolean(game.combat && game.combat.stage === 'choose' && game.currentPlayer === 0);

  return `
    <div class="view game-view">
      ${renderTopStatusGrid({ game, battleLogEntries, spellLogEntries })}
      ${renderPlayerStatBar(opponent, game, true)}
      ${renderBattlefieldSection({ player, opponent, game })}
      ${renderPlayerStatBar(player, game, false)}
      ${renderGameControls({ game, shouldShowBlocking, shouldShowAttackers })}
      ${renderTargetLines(game)}
      ${renderAttackLines(game)}
      ${renderHandArea(player, game)}
      ${renderCardPreviewModal(game)}
      ${renderGraveyardModal(game)}
    </div>
  `;
}
