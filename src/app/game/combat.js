import { state, requestRender } from '../state.js';
import { addLog, cardSegment, damageSegment, playerSegment, textSegment } from './log.js';
import { checkForDeadCreatures, dealDamageToCreature, dealDamageToPlayer, getCreatureStats, hasShimmer } from './creatures.js';

let passiveHandler = () => {};

export function registerPassiveHandler(handler) {
  passiveHandler = handler;
}

export function triggerAttackPassive(creature, controllerIndex, options = {}) {
  passiveHandler(creature, controllerIndex, 'onAttack', options);
}

export function startCombatStage() {
  const game = state.game;
  const currentPlayerIndex = game.currentPlayer ?? 0;
  const currentPlayer = game.players[currentPlayerIndex];
  
  // Only auto-select attackers for the human player on their turn.
  // When it's the AI's turn, initialize an empty attackers list so no
  // attack indicators render until the AI explicitly declares.
  const eligibleAttackers = currentPlayer.battlefield.filter(
    (creature) =>
      creature.type === 'creature' &&
      !creature.summoningSickness &&
      !(creature.frozenTurns > 0),
  );
  
  game.combat = {
    attackers:
      currentPlayerIndex === 0
        ? eligibleAttackers.map((creature) => ({ creature, controller: 0 }))
        : [],
    stage: 'choose',
    triggerQueue: [],
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
}

export function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (game.combat.stage !== 'choose') {
    addLog('Attackers have already been declared.');
    requestRender();
    return;
  }
  if (creature.frozenTurns > 0) {
    addLog([cardSegment(creature), textSegment(' is frozen and cannot attack this turn.')]);
    requestRender();
    return;
  }
  if (creature.summoningSickness) {
    addLog([cardSegment(creature), textSegment(' cannot attack this turn.')]);
    requestRender();
    return;
  }
  const existing = game.combat.attackers.find((atk) => atk.creature.instanceId === creature.instanceId);
  if (existing) {
    game.combat.attackers = game.combat.attackers.filter((atk) => atk.creature.instanceId !== creature.instanceId);
  } else {
    game.combat.attackers.push({ creature, controller: 0 });
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
  beginAttackTriggerStage();
}

function beginAttackTriggerStage() {
  const game = state.game;
  if (!game?.combat) return;

  const triggers = (game.combat.attackers || [])
    .filter((attacker) => attacker.creature?.passive?.type === 'onAttack')
    .map((attacker) => ({
      controller: attacker.controller,
      creatureId: attacker.creature.instanceId,
    }));

  if (!triggers.length) {
    game.combat.stage = 'blockers';
    game.combat.triggerQueue = [];
    prepareBlocks();
    return;
  }

  game.combat.stage = 'triggers';
  game.combat.triggerQueue = triggers;
  requestRender();
  resolveNextAttackTrigger();
}

function resolveNextAttackTrigger() {
  const game = state.game;
  if (!game?.combat) return;

  const queue = game.combat.triggerQueue || [];
  if (!queue.length) {
    finishAttackTriggers();
    return;
  }

  const current = queue[0];
  const attackerEntry = game.combat.attackers.find(
    (attacker) => attacker.controller === current.controller && attacker.creature.instanceId === current.creatureId,
  );

  if (!attackerEntry || attackerEntry.creature.passive?.type !== 'onAttack') {
    queue.shift();
    resolveNextAttackTrigger();
    return;
  }

  const creature = attackerEntry.creature;

  triggerAttackPassive(creature, current.controller, {
    context: 'combat-trigger',
    afterResolve: () => {
      const latestGame = state.game;
      if (!latestGame?.combat) return;
      if (latestGame.combat.triggerQueue?.length) {
        latestGame.combat.triggerQueue.shift();
      }
      resolveNextAttackTrigger();
    },
  });

  const pending = state.game?.pendingAction;
  if (pending && pending.type === 'trigger' && pending.card?.instanceId === creature.instanceId) {
    pending.context = pending.context || 'combat-trigger';
  }
}

function finishAttackTriggers() {
  const game = state.game;
  if (!game?.combat) return;
  game.combat.triggerQueue = [];
  game.combat.stage = 'blockers';
  prepareBlocks();
}

export function skipCombat() {
  const game = state.game;
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  addLog('Combat skipped.');
  requestRender();
}

export function prepareBlocks() {
  const game = state.game;
  game.blocking = {
    attackers: [...game.combat.attackers],
    assignments: {},
    selectedBlocker: null,
    awaitingDefender: false,
  };
  const defending = game.currentPlayer === 0 ? 1 : 0;
  const defenders = game.players[defending].battlefield.filter((c) => c.type === 'creature');
  if (defenders.length === 0) {
    addLog([playerSegment(game.players[defending]), textSegment(' has no blockers.')]);
    resolveCombat();
    return;
  }
  if (game.players[defending].isAI) {
    // Let the player see who blocks before damage resolves
    aiAssignBlocks();
    requestRender();
    const AI_UI_DELAY_MS = 1000;
    setTimeout(() => {
      resolveCombat();
    }, AI_UI_DELAY_MS);
  } else {
    game.blocking.awaitingDefender = true;
    requestRender();
  }
}

export function aiAssignBlocks() {
  const game = state.game;
  const defenders = game.players[1]
    .battlefield
    .filter((c) => c.type === 'creature' && !(c.frozenTurns > 0));
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
  if (creature.frozenTurns > 0) {
    addLog([cardSegment(creature), textSegment(' is frozen and cannot block.')]);
    requestRender();
    return;
  }
  // Creatures can block even with summoning sickness
  game.blocking.selectedBlocker = creature;
  addLog([cardSegment(creature), textSegment(' is ready to block.')]);
  requestRender();
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
  if (blocker.frozenTurns > 0) {
    addLog([cardSegment(blocker), textSegment(' is frozen and cannot block.')]);
    requestRender();
    return;
  }
  const attackerEntry = game.blocking.attackers.find((attacker) => attacker.creature.instanceId === attackerCreature.instanceId);
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
}

export function resolveCombat() {
  const game = state.game;
  if (!game.combat) {
    game.phase = 'main2';
    requestRender();
    return;
  }
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  game.combat.attackers.forEach((attacker) => {
    const attackerStats = getCreatureStats(attacker.creature, attacker.controller, game);
    const blocker = game.blocking.assignments[attacker.creature.instanceId];
    if (!blocker) {
      if (game.preventCombatDamageFor !== defendingIndex) {
        if (attackerStats.attack > 0) {
          addLog([
            cardSegment(attacker.creature),
            textSegment(' hits '),
            playerSegment(game.players[defendingIndex]),
            textSegment(' for '),
            damageSegment(attackerStats.attack),
            textSegment(' damage.'),
          ]);
        }
        dealDamageToPlayer(defendingIndex, attackerStats.attack);
      }
      return;
    }
    const blockerStats = getCreatureStats(blocker, defendingIndex, game);
    if (attackerStats.attack > 0) {
      addLog([
        cardSegment(attacker.creature),
        textSegment(' deals '),
        damageSegment(attackerStats.attack),
        textSegment(' damage to '),
        cardSegment(blocker),
        textSegment('.'),
      ]);
    }
    dealDamageToCreature(blocker, defendingIndex, attackerStats.attack);
    // If protection is active for the attacker controller, prevent blocker damage to attackers
    const preventBlockerDamage = game.preventDamageToAttackersFor === attacker.controller;
    if (!preventBlockerDamage && blockerStats.attack > 0) {
      addLog([
        cardSegment(blocker),
        textSegment(' deals '),
        damageSegment(blockerStats.attack),
        textSegment(' damage to '),
        cardSegment(attacker.creature),
        textSegment('.'),
      ]);
    }
    dealDamageToCreature(attacker.creature, attacker.controller, preventBlockerDamage ? 0 : blockerStats.attack);
  });
  checkForDeadCreatures();
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  requestRender();
}

export function describePhase(game) {
  const map = {
    main1: 'Main Phase',
    combat: 'Combat',
    main2: 'Second Main',
  };
  return map[game.phase] || 'Phase';
}

export function describePhaseDetailed(game) {
  return `${describePhase(game)} — ${game.currentPlayer === 0 ? 'Your turn' : 'AI turn'}`;
}

export function canSelectBlocker(creature, controllerIndex, game) {
  if (!game.blocking) return false;
  // Frozen creatures cannot block
  if (creature.frozenTurns > 0) return false;
  // Creatures can block regardless of summoning sickness
  if (game.currentPlayer === 0 && controllerIndex === 0) {
    return true;
  }
  if (game.currentPlayer === 1 && controllerIndex === 0) {
    return true;
  }
  if (game.currentPlayer === 1 && controllerIndex === 1) {
    return true;
  }
  return false;
}

export function isAttackingCreature(creature, controllerIndex, game) {
  if (!game.combat) return false;
  // Only consider attackers that belong to the current player to avoid
  // styling opponents' creatures as attackers during your turn and vice versa.
  return game.combat.attackers.some(
    (atk) => atk.creature.instanceId === creature.instanceId && atk.controller === game.currentPlayer,
  );
}
