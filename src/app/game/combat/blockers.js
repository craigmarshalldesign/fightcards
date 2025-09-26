import { state, requestRender } from '../../state.js';
import { addLog, cardSegment, playerSegment, textSegment } from '../log.js';
import { hasShimmer } from '../creatures.js';
import { resolveCombat } from './resolution.js';
import { getDefendingPlayerIndex, isBlockerEligible } from './helpers.js';
import {
  isMultiplayerMatchActive,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
} from '../../multiplayer/runtime.js';

export function prepareBlocks() {
  const game = state.game;
  game.blocking = {
    attackers: [...game.combat.attackers],
    assignments: {},
    selectedBlocker: null,
    awaitingDefender: false,
  };
  const defending = getDefendingPlayerIndex(game);
  const defenders = game.players[defending].battlefield.filter((creature) => creature.type === 'creature');
  if (defenders.length === 0) {
    addLog([playerSegment(game.players[defending]), textSegment(' has no blockers.')]);
    resolveCombat();
    return;
  }
  if (game.players[defending].isAI) {
    aiAssignBlocks();
    requestRender();
    const AI_UI_DELAY_MS = 3000;
    setTimeout(() => {
      resolveCombat();
    }, AI_UI_DELAY_MS);
  } else {
    game.blocking.awaitingDefender = true;
    requestRender();
    if (isMultiplayerMatchActive()) {
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.BLOCKING_STARTED, {
        defender: defending,
      });
    }
  }
}

export function aiAssignBlocks() {
  const game = state.game;
  const defenders = game.players[1].battlefield.filter(isBlockerEligible);
  game.blocking.attackers.forEach((attacker) => {
    if (hasShimmer(attacker.creature)) {
      return;
    }
    const blocker = defenders.shift();
    if (blocker) {
      game.blocking.assignments[attacker.creature.instanceId] = blocker;
    }
  });
}

export function selectBlocker(creature) {
  const game = state.game;
  if (!game.blocking) return;
  if (!game.combat || game.combat.stage !== 'blockers') return;
  if (!isBlockerEligible(creature)) {
    const message = creature.frozenTurns > 0 ? ' is frozen and cannot block.' : ' cannot block right now.';
    addLog([cardSegment(creature), textSegment(message)]);
    requestRender();
    return;
  }
  game.blocking.selectedBlocker = creature;
  addLog([cardSegment(creature), textSegment(' is ready to block.')]);
  requestRender();
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.BLOCKER_SELECTED, {
      blocker: { id: creature.id, instanceId: creature.instanceId },
    });
  }
}

export function assignBlockerToAttacker(attackerCreature) {
  const game = state.game;
  if (!game.blocking) return;
  if (!game.combat || game.combat.stage !== 'blockers') return;
  const blocker = game.blocking.selectedBlocker;
  if (!blocker) {
    addLog('Select a blocker first.');
    requestRender();
    return;
  }
  if (!isBlockerEligible(blocker)) {
    const message = blocker.frozenTurns > 0 ? ' is frozen and cannot block.' : ' cannot block right now.';
    addLog([cardSegment(blocker), textSegment(message)]);
    requestRender();
    return;
  }
  const attackerEntry = game.blocking.attackers.find(
    (attacker) => attacker.creature.instanceId === attackerCreature.instanceId,
  );
  if (!attackerEntry) {
    addLog('Invalid attacker.');
    requestRender();
    return;
  }
  if (hasShimmer(attackerEntry.creature)) {
    addLog([cardSegment(attackerEntry.creature), textSegment(' cannot be blocked this turn.')]);
    requestRender();
    return;
  }
  const alreadyAssigned = game.blocking.assignments[attackerCreature.instanceId];
  if (alreadyAssigned && alreadyAssigned.instanceId === blocker.instanceId) {
    delete game.blocking.assignments[attackerCreature.instanceId];
    addLog([
      cardSegment(blocker),
      textSegment(' stops blocking '),
      cardSegment(attackerCreature),
      textSegment('.'),
    ]);
    game.blocking.selectedBlocker = null;
    requestRender();
    return;
  }
  Object.keys(game.blocking.assignments).forEach((key) => {
    if (game.blocking.assignments[key].instanceId === blocker.instanceId) {
      delete game.blocking.assignments[key];
    }
  });
  game.blocking.assignments[attackerCreature.instanceId] = blocker;
  game.blocking.selectedBlocker = null;
  addLog([cardSegment(blocker), textSegment(' blocks '), cardSegment(attackerCreature), textSegment('.')]);
  requestRender();
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.BLOCKER_ASSIGNED, {
      attacker: { id: attackerCreature.id, instanceId: attackerCreature.instanceId },
      blocker: { id: blocker.id, instanceId: blocker.instanceId },
    });
  }
}
