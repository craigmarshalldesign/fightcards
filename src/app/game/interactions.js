import { state, requestRender } from '../state.js';
import { addLog } from './log.js';
import {
  activateCreatureAbility,
  canPlayCard,
  handlePlayerTargetSelection,
  handleTargetSelection,
  isTargetablePlayer,
  playCreature,
  prepareSpell,
} from './core/index.js';
import { toggleAttacker, selectBlocker, assignBlockerToAttacker } from './core/index.js';
import { getLocalSeatIndex } from '../multiplayer/runtime.js';

export function handleHandCardClick(cardId) {
  const game = state.game;
  if (!game) return;
  // When a spell/ability is pending, ignore hand clicks entirely
  if (game.pendingAction) {
    addLog('Resolve the current action first.');
    requestRender();
    return;
  }
  // Use local seat index instead of hardcoded 0
  const localPlayerIndex = getLocalSeatIndex();
  const player = game.players[localPlayerIndex];
  const card = player.hand.find((c) => c.instanceId === cardId);
  if (!card) return;
  if (!canPlayCard(card, localPlayerIndex, game)) {
    addLog('Cannot play that card right now.');
    requestRender();
    return;
  }
  if (card.type === 'creature') {
    playCreature(localPlayerIndex, card);
    requestRender();
  } else {
    prepareSpell(localPlayerIndex, card);
  }

  // QoL: In widescreen mode, if the hand tray is open and this play
  // creates a pending action (active spell slot), close the hand so
  // the player can see and select targets more easily. Do NOT close
  // for instant-resolving plays without a pending action.
  setTimeout(() => {
    try {
      const shouldClose =
        state.ui?.viewMode === 'wide' &&
        state.ui?.wideHandOpen === true &&
        Boolean(state.game?.pendingAction);
      if (shouldClose) {
        state.ui.wideHandOpen = false;
        requestRender();
      }
    } catch (_) {
      // no-op
    }
  }, 0);
}

export function handleCreatureClick(cardId, controller) {
  const game = state.game;
  if (!game) return;
  const creature = game.players[controller].battlefield.find((c) => c.instanceId === cardId);
  if (!creature) return;
  const localPlayerIndex = getLocalSeatIndex();
  
  if (game.pendingAction) {
    handleTargetSelection(creature, controller);
    return;
  }
  
  // Combat - use local player index for your own creatures
  if (game.phase === 'combat' && game.currentPlayer === localPlayerIndex && controller === localPlayerIndex && game.combat?.stage === 'choose') {
    toggleAttacker(creature);
    return;
  }
  
  // Blocking - defender's perspective
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  if (game.blocking && localPlayerIndex === defendingIndex && game.combat?.stage === 'blockers') {
    if (controller === localPlayerIndex) {
      // Selecting your own creature as blocker
      if (game.blocking.selectedBlocker && game.blocking.selectedBlocker.instanceId === creature.instanceId) {
        game.blocking.selectedBlocker = null;
        requestRender();
        return;
      }
      selectBlocker(creature);
      return;
    }
    if (controller !== localPlayerIndex) {
      // Assigning blocker to attacking creature
      assignBlockerToAttacker(creature);
      return;
    }
  }
}

export { activateCreatureAbility };

export function handleLifeOrbClick(playerIndex) {
  const game = state.game;
  if (!game?.pendingAction) return;
  if (!isTargetablePlayer(playerIndex, game.pendingAction)) {
    return;
  }
  handlePlayerTargetSelection(playerIndex);
}
