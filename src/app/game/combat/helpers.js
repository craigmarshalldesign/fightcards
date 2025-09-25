export function getDefendingPlayerIndex(game) {
  return game.currentPlayer === 0 ? 1 : 0;
}

export function isEligibleAttacker(creature) {
  return (
    creature.type === 'creature' &&
    !creature.summoningSickness &&
    !(creature.frozenTurns > 0)
  );
}

export function buildInitialAttackers(eligibleCreatures, controllerIndex) {
  return eligibleCreatures.map((creature) => ({ creature, controller: controllerIndex }));
}

export function isBlockerEligible(creature) {
  return creature.type === 'creature' && !(creature.frozenTurns > 0);
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
  if (creature.frozenTurns > 0) return false;
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
  return game.combat.attackers.some(
    (atk) => atk.creature.instanceId === creature.instanceId && atk.controller === game.currentPlayer,
  );
}
