import { state, requestRender } from '../state.js';
import { addLog } from './log.js';
import {
  activateCreatureAbility,
  canPlayCard,
  handleTargetSelection,
  playCreature,
  prepareSpell,
} from './core.js';
import { toggleAttacker, selectBlocker, assignBlockerToAttacker } from './core.js';

export function handleHandCardClick(cardId) {
  const game = state.game;
  if (!game) return;
  const player = game.players[0];
  const card = player.hand.find((c) => c.instanceId === cardId);
  if (!card) return;
  if (!canPlayCard(card, 0, game)) {
    addLog('Cannot play that card right now.');
    requestRender();
    return;
  }
  if (card.type === 'creature') {
    playCreature(0, card);
    requestRender();
  } else {
    prepareSpell(0, card);
  }
}

export function handleCreatureClick(cardId, controller) {
  const game = state.game;
  if (!game) return;
  const creature = game.players[controller].battlefield.find((c) => c.instanceId === cardId);
  if (!creature) return;
  if (game.pendingAction) {
    handleTargetSelection(creature, controller);
    return;
  }
  if (game.phase === 'combat' && game.currentPlayer === 0 && controller === 0 && game.combat?.stage === 'choose') {
    toggleAttacker(creature);
    return;
  }
  if (game.blocking && game.currentPlayer === 1 && game.combat?.stage === 'blockers') {
    if (controller === 0) {
      if (game.blocking.selectedBlocker && game.blocking.selectedBlocker.instanceId === creature.instanceId) {
        game.blocking.selectedBlocker = null;
        requestRender();
        return;
      }
      selectBlocker(creature);
      return;
    }
    if (controller === 1) {
      assignBlockerToAttacker(creature);
      return;
    }
  }
}

export { activateCreatureAbility };
