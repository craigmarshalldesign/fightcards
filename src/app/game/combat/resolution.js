import { state, requestRender } from '../../state.js';
import { addLog, cardSegment, damageSegment, playerSegment, textSegment } from '../log.js';
import {
  checkForDeadCreatures,
  dealDamageToCreature,
  dealDamageToPlayer,
  getCreatureStats,
} from '../creatures.js';
import { getDefendingPlayerIndex } from './helpers.js';

export function skipCombat() {
  const game = state.game;
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  addLog('Combat skipped.');
  requestRender();
}

export function resolveCombat() {
  const game = state.game;
  if (!game.combat) {
    game.phase = 'main2';
    requestRender();
    return;
  }
  const defendingIndex = getDefendingPlayerIndex(game);
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
    dealDamageToCreature(
      attacker.creature,
      attacker.controller,
      preventBlockerDamage ? 0 : blockerStats.attack,
    );
  });
  checkForDeadCreatures();
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  requestRender();
}
