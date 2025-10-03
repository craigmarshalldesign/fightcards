import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

/**
 * Renders the unified phase control box for widescreen view
 * Combines turn indicator, phase pills, and action buttons into one component
 */
export function renderWidePhaseBox(game) {
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;
  const phaseLocked = game.phaseLocked;
  
  // Turn status header
  const turnHeader = isLocalTurn
    ? '<div class="wide-phasebox-header your-turn">Your Turn</div>'
    : '<div class="wide-phasebox-header opponent-turn">Opponent\'s Turn</div>';
  
  // Phase indicator pills
  const phaseIndicator = `
    <div class="wide-phasebox-phases">
      ${renderPhaseItem('main1', 'Main 1', game)}
      ${renderPhaseItem('combat', 'Combat', game)}
      ${renderPhaseItem('main2', 'Main 2', game)}
    </div>
  `;
  
  // Action buttons section
  const actionButtons = renderActionButtons(game, isLocalTurn, phaseLocked);
  
  return `
    <div class="wide-phasebox-container ${isLocalTurn ? 'local-turn' : ''}">
      ${turnHeader}
      ${phaseIndicator}
      ${actionButtons}
    </div>
  `;
}

function renderPhaseItem(phaseKey, phaseLabel, game) {
  const isActive = game.phase === phaseKey;
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;
  
  return `
    <div class="wide-phasebox-pill ${isActive ? 'active' : ''} ${isActive && isLocalTurn ? 'local-turn' : ''}">
      <span class="phase-dot"></span>
      <span class="phase-name">${phaseLabel}</span>
    </div>
  `;
}

function renderActionButtons(game, isLocalTurn, phaseLocked) {
  const localSeatIndex = getLocalSeatIndex();
  
  // Only show phase controls during main phases AND when it's the local player's turn
  const showPhaseControls = isLocalTurn && (game.phase === 'main1' || game.phase === 'main2');
  
  // Show blocking controls when blocking is active and awaiting defender
  const blocking = game.blocking;
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  const awaitingDefender = Boolean(blocking && blocking.awaitingDefender);
  const shouldShowBlocking = awaitingDefender && localSeatIndex === defendingIndex;
  const canDeclareBlockers = Boolean(localSeatIndex === defendingIndex);
  
  // Show attacker controls only during choose stage AND when it's the local player's turn
  const showDeclareAttackerActions = isLocalTurn && game.phase === 'combat' && game.combat && game.combat.stage === 'choose';
  
  // Determine the main button label
  let mainButtonLabel = 'Next Phase';
  switch (game.phase) {
    case 'main1':
      mainButtonLabel = 'Go to Combat';
      break;
    case 'combat':
      mainButtonLabel = 'End Combat';
      break;
    case 'main2':
      mainButtonLabel = 'End Turn';
      break;
  }
  
  const phaseButtonDisabled = !isLocalTurn || phaseLocked;
  
  // Combat controls - secondary button on left, primary on right
  // Only show when it's local player's turn AND in declare-attackers step
  const attackerControls = showDeclareAttackerActions
    ? `
      <div class="wide-phasebox-button-row">
        <button 
          class="wide-phasebox-button secondary" 
          data-action="skip-combat" 
        >
          Skip Combat
        </button>
        <button 
          class="wide-phasebox-button primary" 
          data-action="declare-attackers"
        >
          Declare Attackers
        </button>
      </div>
    `
    : '';
  
  // Show blocker button when blocking is active and player is defending
  const declareBlockersDisabled = !canDeclareBlockers || phaseLocked;
  const blockerControls = shouldShowBlocking
    ? `
      <button 
        class="wide-phasebox-button primary full-width ${declareBlockersDisabled ? 'disabled' : ''}" 
        data-action="declare-blockers" 
        ${declareBlockersDisabled ? 'disabled' : ''}
      >
        Declare Blockers
      </button>
    `
    : '';
  
  // Phase button - only show during main phases when it's the local player's turn
  const phaseButton = showPhaseControls
    ? `
      <button 
        class="wide-phasebox-button primary full-width ${phaseButtonDisabled ? 'disabled' : ''}" 
        data-action="end-phase" 
        ${phaseButtonDisabled ? 'disabled' : ''}
      >
        ${mainButtonLabel}
      </button>
    `
    : '';
  
  // Only render the action section if there are buttons to show
  if (!attackerControls && !blockerControls && !phaseButton) {
    return '';
  }
  
  return `
    <div class="wide-phasebox-actions">
      ${attackerControls}
      ${blockerControls}
      ${phaseButton}
    </div>
  `;
}

