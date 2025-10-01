import { state, requestRender } from '../../state.js';
import { addLog, cardSegment, damageSegment, playerSegment, textSegment } from '../log.js';
import {
  checkForDeadCreatures,
  dealDamageToCreature,
  dealDamageToPlayer,
  getCreatureStats,
  hasHidden,
  hasStomp,
} from '../creatures.js';
import { getDefendingPlayerIndex } from './helpers.js';
import {
  isMultiplayerMatchActive,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
} from '../../multiplayer/runtime.js';

export function skipCombat() {
  const game = state.game;
  if (game?.combat?.attackers?.length) {
    game.combat.attackers = [];
  }
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  
  // Log will be added by PHASE_CHANGED event in multiplayer
  if (!isMultiplayerMatchActive()) {
    addLog('Combat skipped.');
  }
  
  // Sync phase change in multiplayer
  if (isMultiplayerMatchActive()) {
    // Update match state immediately for UI responsiveness
    if (state.multiplayer.match) {
      state.multiplayer.match.phase = game.phase;
    }
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PHASE_CHANGED, {
      turn: game.turn,
      activePlayer: game.currentPlayer,
      phase: game.phase,
    });
  }
  
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
  const combatLog = [];
  
  // Build combat log for event sync
  game.combat.attackers.forEach((attacker) => {
    const attackerStats = getCreatureStats(attacker.creature, attacker.controller, game);
    const blocker = game.blocking.assignments[attacker.creature.instanceId];
    if (!blocker) {
      if (game.preventCombatDamageFor !== defendingIndex) {
        combatLog.push({
          type: 'direct',
          attacker: { id: attacker.creature.id, instanceId: attacker.creature.instanceId },
          controller: attacker.controller,
          damage: attackerStats.attack,
          targetPlayer: defendingIndex,
        });
      }
      return;
    }
    const blockerStats = getCreatureStats(blocker, defendingIndex, game);
    const blockerHP = blockerStats.toughness - (blocker.damageMarked || 0);
    const attackerHasStomp = hasStomp(attacker.creature);
    
    // Calculate Stomp (trample) damage
    let stompDamage = 0;
    if (attackerHasStomp && attackerStats.attack > blockerHP) {
      stompDamage = attackerStats.attack - blockerHP;
    }
    
    // Check if attacker has Hidden buff (prevents combat damage)
    const attackerHasHidden = hasHidden(attacker.creature);
    const preventBlockerDamage = game.preventDamageToAttackersFor === attacker.controller || attackerHasHidden;
    combatLog.push({
      type: 'combat',
      attacker: { id: attacker.creature.id, instanceId: attacker.creature.instanceId },
      blocker: { id: blocker.id, instanceId: blocker.instanceId },
      controller: attacker.controller,
      damageToBlocker: attackerStats.attack,
      damageToAttacker: preventBlockerDamage ? 0 : blockerStats.attack,
      stompDamage: stompDamage,
      targetPlayer: stompDamage > 0 ? defendingIndex : undefined,
    });
  });
  
  // CRITICAL: In multiplayer, don't apply damage locally - let event replay handle it
  // In single player, apply damage immediately
  if (!isMultiplayerMatchActive()) {
    // Apply damage for single player
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
      const blockerHP = blockerStats.toughness - (blocker.damageMarked || 0);
      const attackerHasStomp = hasStomp(attacker.creature);
      
      // Calculate Stomp (trample) damage
      let stompDamage = 0;
      if (attackerHasStomp && attackerStats.attack > blockerHP) {
        stompDamage = attackerStats.attack - blockerHP;
      }
      
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
      
      // Apply Stomp damage to defending player
      if (stompDamage > 0) {
        addLog([
          cardSegment(attacker.creature),
          textSegment(' tramples over for '),
          damageSegment(stompDamage),
          textSegment(' damage!'),
        ]);
        dealDamageToPlayer(defendingIndex, stompDamage);
      }
      
      // Check if attacker has Hidden buff (prevents combat damage)
      const attackerHasHidden = hasHidden(attacker.creature);
      const preventBlockerDamage = game.preventDamageToAttackersFor === attacker.controller || attackerHasHidden;
      if (!preventBlockerDamage && blockerStats.attack > 0) {
        addLog([
          cardSegment(blocker),
          textSegment(' deals '),
          damageSegment(blockerStats.attack),
          textSegment(' damage to '),
          cardSegment(attacker.creature),
          textSegment('.'),
        ]);
      } else if (attackerHasHidden && blockerStats.attack > 0) {
        addLog([
          cardSegment(attacker.creature),
          textSegment(' is Hidden and takes no damage!'),
        ]);
      }
      dealDamageToCreature(
        attacker.creature,
        attacker.controller,
        preventBlockerDamage ? 0 : blockerStats.attack,
      );
    });
    checkForDeadCreatures();
  } else {
    // In multiplayer, just emit the event - damage will be applied via event replay
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.COMBAT_RESOLVED, {
      log: combatLog,
    });
  }
  
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  
  // Sync phase change in multiplayer
  if (isMultiplayerMatchActive()) {
    // Update match state immediately for UI responsiveness
    if (state.multiplayer.match) {
      state.multiplayer.match.phase = game.phase;
    }
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PHASE_CHANGED, {
      turn: game.turn,
      activePlayer: game.currentPlayer,
      phase: game.phase,
    });
  }
  
  requestRender();
}
