import { state, requestRender } from '../../state.js';
import { addLog, cardSegment, textSegment } from '../log.js';
import { buildInitialAttackers, isEligibleAttacker } from './helpers.js';
import { skipCombat } from './resolution.js';
import { startTriggerStage } from './triggers.js';
import {
  isMultiplayerMatchActive,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
} from '../../multiplayer/runtime.js';

export function startCombatStage() {
  const game = state.game;
  const currentPlayerIndex = game.currentPlayer ?? 0;
  const currentPlayer = game.players[currentPlayerIndex];

  const eligibleAttackers = currentPlayer.battlefield.filter(isEligibleAttacker);

  game.combat = {
    attackers:
      currentPlayerIndex === 0 ? buildInitialAttackers(eligibleAttackers, 0) : [],
    stage: 'choose',
    pendingTriggers: [],
    activeTrigger: null,
    resolvingTrigger: false,
    triggerOptions: null,
  };
  game.blocking = null;

  addLog('Combat begins.');

  if (currentPlayerIndex === 0) {
    if (eligibleAttackers.length > 0) {
      addLog(`${eligibleAttackers.length} creature(s) ready to attack.`);
    } else {
      addLog('No creatures available to attack.');
    }
  }

  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.COMBAT_STARTED, {
      controller: currentPlayerIndex,
    });
  }
}

export function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (game.combat.stage !== 'choose') {
    addLog('Attackers have already been declared.');
    requestRender();
    return;
  }
  if (!game.combat.attackers) {
    game.combat.attackers = [];
  }
  if (!isEligibleAttacker(creature)) {
    const reason = creature.frozenTurns > 0 ? ' is frozen and cannot attack this turn.' : ' cannot attack this turn.';
    addLog([cardSegment(creature), textSegment(reason)]);
    requestRender();
    return;
  }
  const existing = game.combat.attackers.find((atk) => atk.creature.instanceId === creature.instanceId);
  if (existing) {
    game.combat.attackers = game.combat.attackers.filter((atk) => atk.creature.instanceId !== creature.instanceId);
  } else {
    game.combat.attackers.push({ creature, controller: 0 });
  }
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.ATTACKER_TOGGLED, {
      creature: { id: creature.id, instanceId: creature.instanceId },
      selected: !existing,
    });
  }
  requestRender();
}

export function confirmAttackers() {
  const game = state.game;
  if (!game.combat || game.combat.attackers.length === 0) {
    addLog('No attackers declared.');
    skipCombat();
    return;
  }
  if (game.combat.stage !== 'choose') {
    addLog('Attackers already declared.');
    requestRender();
    return;
  }
  addLog(`Attacking with ${game.combat.attackers.length} creature(s).`);
  startTriggerStage();
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.ATTACKERS_CONFIRMED, {
      attackers: game.combat.attackers.map((attacker) => ({
        creature: { id: attacker.creature.id, instanceId: attacker.creature.instanceId },
        controller: attacker.controller,
      })),
    });
  }
}
