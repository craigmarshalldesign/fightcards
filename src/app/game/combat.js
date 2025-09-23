import { state } from '../state.js';
import { addLog } from './log.js';
import {
  checkForDeadCreatures,
  dealDamageToCreature,
  dealDamageToPlayer,
  destroyCreature,
  getCreatureStats,
} from './creatures.js';
import { requestRender } from '../state.js';

let passiveHandler = () => {};

export function registerPassiveHandler(handler) {
  passiveHandler = handler;
}

export function triggerAttackPassive(creature, controllerIndex) {
  passiveHandler(creature, controllerIndex, 'onAttack');
}

export function startCombatStage() {
  const game = state.game;
  game.combat = { attackers: [], stage: 'declare' };
  game.blocking = { attackers: [], assignments: {}, selectedBlocker: null };
  addLog('Combat begins.');
}

export function toggleCombatSelection() {
  const game = state.game;
  if (!game.combat) {
    startCombatStage();
  }
  game.combat.stage = 'choose';
  requestRender();
}

export function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (creature.summoningSickness) {
    addLog(`${creature.name} cannot attack this turn.`);
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
  addLog(`Attacking with ${game.combat.attackers.length} creature(s).`);
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
  };
  const defending = game.currentPlayer === 0 ? 1 : 0;
  if (game.players[defending].isAI) {
    aiAssignBlocks();
    resolveCombat();
  } else {
    requestRender();
  }
}

export function aiAssignBlocks() {
  const game = state.game;
  const defenders = game.players[1].battlefield.filter((c) => c.type === 'creature');
  game.blocking.attackers.forEach((attacker) => {
    const blocker = defenders.shift();
    if (blocker) {
      game.blocking.assignments[attacker.creature.instanceId] = blocker;
    }
  });
}

export function selectBlocker(creature) {
  const game = state.game;
  if (!game.blocking) return;
  if (creature.summoningSickness) {
    addLog(`${creature.name} is summoning sick and cannot block.`);
    requestRender();
    return;
  }
  game.blocking.selectedBlocker = creature;
  addLog(`${creature.name} ready to block.`);
  requestRender();
}

export function assignBlockerToAttacker(attackerCreature) {
  const game = state.game;
  if (!game.blocking) return;
  const blocker = game.blocking.selectedBlocker;
  if (!blocker) {
    addLog('Select a blocker first.');
    requestRender();
    return;
  }
  game.blocking.assignments[attackerCreature.instanceId] = blocker;
  game.blocking.selectedBlocker = null;
  addLog(`${blocker.name} blocks ${attackerCreature.name}.`);
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
        dealDamageToPlayer(defendingIndex, attackerStats.attack);
      }
      return;
    }
    const blockerStats = getCreatureStats(blocker, defendingIndex, game);
    if (attackerStats.attack >= blockerStats.toughness) {
      destroyCreature(blocker, defendingIndex);
    } else {
      blocker.damageMarked = (blocker.damageMarked || 0) + attackerStats.attack;
    }
    if (blockerStats.attack >= attackerStats.toughness) {
      destroyCreature(attacker.creature, attacker.controller);
    } else {
      attacker.creature.damageMarked = (attacker.creature.damageMarked || 0) + blockerStats.attack;
    }
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
