import { state } from '../../../state.js';
import { getLogEntries } from '../../../game/log.js';
import { renderGraveyardModal } from '../graveyardView.js';
import { renderTopStatusGrid } from './logs.js';
import { renderBattlefieldSection, renderPlayerStatBar, renderTargetLines, renderAttackLines } from './battlefield.js';
import { renderGameControls } from './controls.js';
import { renderPhaseIndicator } from './phaseIndicator.js';
import { getLocalSeatIndex } from '../../../multiplayer/runtime.js';
import { renderHandArea } from './hand.js';
import { renderCardPreviewModal, renderEndGameModal } from './modals.js';
import { renderGameWide } from '../../widescreenview/index.js';

export function renderGame() {
  const { game } = state;
  if (!game) return '';

  // CRITICAL: Delegate to widescreen view if viewMode is 'wide'
  if (state.ui.viewMode === 'wide') {
    return renderGameWide();
  }

  // CRITICAL: Use local seat to determine which player is "you" vs "opponent"
  const localSeatIndex = getLocalSeatIndex();
  const player = game.players[localSeatIndex]; // Your cards/view
  const opponentIndex = localSeatIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex]; // Opponent's cards/view
  
  const battleLogEntries = getLogEntries(game, 'battle');
  const spellLogEntries = getLogEntries(game, 'spell');
  const blocking = game.blocking;
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  const awaitingDefender = Boolean(blocking && blocking.awaitingDefender);
  const shouldShowBlocking = awaitingDefender && localSeatIndex === defendingIndex;
  const showDeclareAttackerActions = Boolean(
    game.combat && game.combat.stage === 'choose' && localSeatIndex === game.currentPlayer,
  );
  const showAttackerSummary = Boolean(
    game.combat && ['choose', 'blockers'].includes(game.combat.stage) && game.combat.attackers,
  );
  const canDeclareBlockers = Boolean(localSeatIndex === defendingIndex);
  const isLocalTurn = localSeatIndex === game.currentPlayer;
  // CRITICAL: Only hide phase controls when actually in combat phase, not when combat object exists
  const showPhaseControls = isLocalTurn && game.phase !== 'combat';
  const shouldShowControlShell = showPhaseControls || shouldShowBlocking || showDeclareAttackerActions || showAttackerSummary;

  return `
    <div class="view game-view">
      ${renderTopStatusGrid({ game, battleLogEntries, spellLogEntries })}
      ${renderPlayerStatBar(opponent, game, true)}
      ${renderBattlefieldSection({ player, opponent, game })}
      ${renderPlayerStatBar(player, game, false)}
      ${renderPhaseIndicator(game)}
      ${shouldShowControlShell
        ? renderGameControls({
            game,
            shouldShowBlocking,
            canDeclareBlockers,
            showDeclareAttackerActions,
            showAttackerSummary,
            showPhaseControls,
          })
        : ''}
      ${renderTargetLines(game)}
      ${renderAttackLines(game)}
      ${renderHandArea(player, game)}
      ${renderCardPreviewModal(game)}
      ${renderGraveyardModal(game)}
      ${renderEndGameModal()}
    </div>
  `;
}
