import { state, requestRender } from '../state.js';
import { addLog, cardSegment, damageSegment, playerSegment, textSegment } from './log.js';
import { checkForDeadCreatures, dealDamageToCreature, dealDamageToPlayer, getCreatureStats, hasShimmer } from './creatures.js';

let passiveHandler = () => {};

export function registerPassiveHandler(handler) {
  passiveHandler = handler;
}

export function triggerAttackPassive(creature, controllerIndex) {
  passiveHandler(creature, controllerIndex, 'onAttack');
}

export function startCombatStage() {
  const game = state.game;
  game.combat = { attackers: [], stage: 'choose' };
  game.blocking = null;
  addLog('Combat begins.');
}

export function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (game.combat.stage !== 'choose') {
    addLog('Attackers have already been declared.');
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
    triggerAttackPassive(creature, 0);
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
  const defenders = game.players[defending].battlefield.filter((c) => c.type === 'creature' && !c.summoningSickness);
  if (defenders.length === 0) {
    addLog([playerSegment(game.players[defending]), textSegment(' has no blockers.')]);
    resolveCombat();
    return;
  }
  if (game.players[defending].isAI) {
    aiAssignBlocks();
    resolveCombat();
  } else {
    game.blocking.awaitingDefender = true;
    requestRender();
  }
}

export function aiAssignBlocks() {
  const game = state.game;
  const defenders = game.players[1].battlefield.filter((c) => c.type === 'creature' && !c.summoningSickness);
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
  if (creature.summoningSickness) {
    addLog([cardSegment(creature), textSegment(' is summoning sick and cannot block.')]);
    requestRender();
    return;
  }
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
    if (blockerStats.attack > 0) {
      addLog([
        cardSegment(blocker),
        textSegment(' deals '),
        damageSegment(blockerStats.attack),
        textSegment(' damage to '),
        cardSegment(attacker.creature),
        textSegment('.'),
      ]);
    }
    dealDamageToCreature(attacker.creature, attacker.controller, blockerStats.attack);
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
  if (game.currentPlayer === 0 && controllerIndex === 0) {
    return !creature.summoningSickness;
  }
  if (game.currentPlayer === 1 && controllerIndex === 0) {
    return !creature.summoningSickness;
  }
  if (game.currentPlayer === 1 && controllerIndex === 1) {
    return true;
  }
  return false;
}

export function isAttackingCreature(creature, controllerIndex, game) {
  if (!game.combat) return false;
  return game.combat.attackers.some((atk) => atk.creature.instanceId === creature.instanceId);
}
