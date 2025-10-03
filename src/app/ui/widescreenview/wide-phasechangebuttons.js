import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

/**
 * Renders floating phase control panel for widescreen view
 * Positioned in bottom-right corner with persistent background
 * Handles phase changes, combat declarations, and blocking
 */
export function renderWidePhaseChangeButtons(game) {
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;
  const phaseLocked = Boolean(game.pendingAction);
  
  // Check for combat phase controls
  const blocking = game.blocking;
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  const awaitingDefender = Boolean(blocking && blocking.awaitingDefender);
  const shouldShowBlocking = awaitingDefender && localSeatIndex === defendingIndex;
  const showDeclareAttackerActions = Boolean(
    game.combat && game.combat.stage === 'choose' && localSeatIndex === game.currentPlayer,
  );
  
  const showPhaseControls = isLocalTurn && game.phase !== 'combat';
  const shouldShowAnyControls = showPhaseControls || shouldShowBlocking || showDeclareAttackerActions;
  
  // Determine main phase button label
  let mainButtonLabel = 'Next Phase';
  switch (game.phase) {
    case 'main1':
      mainButtonLabel = 'Go to Combat';
      break;
    case 'main2':
      mainButtonLabel = 'End Turn';
      break;
    default:
      break;
  }
  
  const phaseButtonDisabled = !isLocalTurn || phaseLocked;
  
  // Combat controls - secondary button on left, primary on right
  const attackerControls = showDeclareAttackerActions
    ? `
      <div class="wide-button-row">
        <button 
          class="wide-combat-button secondary" 
          data-action="skip-combat" 
          ${!isLocalTurn ? 'disabled' : ''}
        >
          Skip Combat
        </button>
        <button 
          class="wide-combat-button primary" 
          data-action="declare-attackers" 
          ${!isLocalTurn ? 'disabled' : ''}
        >
          Declare Attackers
        </button>
      </div>
    `
    : '';
  
  const blockerControls = shouldShowBlocking
    ? `
      <button 
        class="wide-combat-button primary full-width" 
        data-action="declare-blockers" 
        ${!isLocalTurn || phaseLocked ? 'disabled' : ''}
      >
        Declare Blockers
      </button>
    `
    : '';
  
  // Phase button (only show during main phases) - always in same position
  const phaseButton = showPhaseControls
    ? `
      <button 
        class="wide-phase-button full-width ${phaseButtonDisabled ? 'disabled' : ''}" 
        data-action="end-phase" 
        ${phaseButtonDisabled ? 'disabled' : ''}
      >
        ${mainButtonLabel}
      </button>
    `
    : '';
  
  return `
    <div class="wide-phase-control-panel">
      ${attackerControls}
      ${blockerControls}
      ${phaseButton}
    </div>
  `;
}

