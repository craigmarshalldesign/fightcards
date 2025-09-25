import { createCardInstance } from '../../game/cards/index.js';
import { requestRender, state } from '../state.js';
import { addLog, cardSegment, damageSegment, playerSegment, textSegment } from './log.js';
import { sortHand } from './core/index.js';

let checkForWinnerHook = () => {};

export function registerWinnerHook(callback) {
  checkForWinnerHook = callback;
}

export function instantiateToken(tokenDef, color) {
  const tokenCard = {
    id: `${tokenDef.name}-${Math.random().toString(36).slice(2, 7)}`,
    name: tokenDef.name,
    type: 'creature',
    color,
    cost: 0,
    attack: tokenDef.attack,
    toughness: tokenDef.toughness,
    abilities: tokenDef.abilities || {},
    text: tokenDef.text || 'Token creature',
  };
  const instance = createCardInstance(tokenCard);
  instance.isToken = true;
  return instance;
}

export function hasShimmer(creature) {
  if (!creature) return false;
  if (creature.abilities?.shimmer) return true;
  return Boolean(creature.buffs?.some((buff) => buff?.shimmer));
}

export function grantShimmer(creature, duration = 'turn') {
  if (!creature) return;
  if (duration === 'permanent') {
    creature.abilities = creature.abilities || {};
    creature.abilities.shimmer = true;
    return;
  }
  creature.buffs = creature.buffs || [];
  const expires = duration === 'turn' ? 'endOfTurn' : duration;
  creature.buffs.push({ attack: 0, toughness: 0, shimmer: true, duration: expires });
}

export function bounceCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  // Reset transient state when a creature leaves the battlefield
  creature.damageMarked = 0;
  creature.buffs = [];
  creature.temporaryHaste = false;
  creature.frozenTurns = 0;
  // Restore base stats/abilities to printed values if available
  if (typeof creature.originalAttack === 'number') {
    creature.baseAttack = creature.originalAttack;
  } else {
    creature.baseAttack = creature.attack ?? 0;
  }
  if (typeof creature.originalToughness === 'number') {
    creature.baseToughness = creature.originalToughness;
  } else {
    creature.baseToughness = creature.toughness ?? 0;
  }
  if (creature.originalAbilities) {
    creature.abilities = JSON.parse(JSON.stringify(creature.originalAbilities));
  }
  creature.summoningSickness = !creature.abilities?.haste;
  player.hand.push(creature);
  sortHand(player);
  addLog([cardSegment(creature), textSegment(' returns to '), playerSegment(player), textSegment("'s hand.")]);
}

export function bounceStrongestCreatures(controllerIndex, amount) {
  const player = state.game.players[controllerIndex];
  const targets = player.battlefield
    .filter((c) => c.type === 'creature')
    .sort((a, b) => getCreatureStats(b, controllerIndex, state.game).attack - getCreatureStats(a, controllerIndex, state.game).attack)
    .slice(0, amount);
  targets.forEach((creature) => bounceCreature(creature, controllerIndex));
}

export function freezeCreature(creature) {
  // Freeze should last through the rest of this turn and the opponent's next turn
  creature.frozenTurns = Math.max(2, creature.frozenTurns || 0);
  addLog([cardSegment(creature), textSegment(' is frozen.')]);
}

export function distributeSplashDamage(opponentIndex, amount) {
  const opponent = state.game.players[opponentIndex];
  const creatures = opponent.battlefield.filter((c) => c.type === 'creature');
  if (creatures.length === 0) {
    dealDamageToPlayer(opponentIndex, amount);
    return;
  }
  let remaining = amount;
  while (remaining > 0 && creatures.length > 0) {
    const target = creatures[Math.floor(Math.random() * creatures.length)];
    dealDamageToCreature(target, opponentIndex, 1);
    remaining -= 1;
  }
  if (remaining > 0) {
    dealDamageToPlayer(opponentIndex, remaining);
  }
}

export function addTemporaryBuff(creature, attack, toughness) {
  if (!creature.buffs) creature.buffs = [];
  const atk = Number.isFinite(attack) ? attack : 0;
  const tough = Number.isFinite(toughness) ? toughness : 0;
  creature.buffs.push({ attack: atk, toughness: tough, duration: 'endOfTurn', temporary: true });
}

export function applyPermanentBuff(creature, attack, toughness) {
  const atk = Number.isFinite(attack) ? attack : 0;
  const tough = Number.isFinite(toughness) ? toughness : 0;
  const currentBaseAttack = Number.isFinite(creature.baseAttack)
    ? creature.baseAttack
    : creature.attack ?? 0;
  const currentBaseToughness = Number.isFinite(creature.baseToughness)
    ? creature.baseToughness
    : creature.toughness ?? 0;
  creature.baseAttack = currentBaseAttack + atk;
  creature.baseToughness = currentBaseToughness + tough;
}

export function grantHaste(creature, duration) {
  creature.abilities = creature.abilities || {};
  creature.abilities.haste = true;
  creature.summoningSickness = false;
  if (duration === 'turn') {
    creature.temporaryHaste = true;
  }
}

export function removeFromBattlefield(player, instanceId) {
  const index = player.battlefield.findIndex((c) => c.instanceId === instanceId);
  if (index >= 0) {
    player.battlefield.splice(index, 1);
  }
}

export function dealDamageToCreature(creature, controllerIndex, amount) {
  if (amount <= 0) return;
  const stats = getCreatureStats(creature, controllerIndex, state.game);
  const newDamage = (creature.damageMarked || 0) + amount;
  creature.damageMarked = newDamage;
  const remaining = Math.max(stats.toughness - newDamage, 0);
  if (remaining > 0) {
    addLog([
      cardSegment(creature),
      textSegment(' takes '),
      damageSegment(amount),
      textSegment(` damage (${remaining} toughness remaining).`),
    ]);
  } else {
    addLog([cardSegment(creature), textSegment(' takes '), damageSegment(amount), textSegment(' damage.')]);
    markCreatureForDeath(creature, controllerIndex);
  }
}

export function destroyCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  // Reset transient and modified state when a creature dies
  creature.damageMarked = 0;
  creature.buffs = [];
  creature.temporaryHaste = false;
  creature.frozenTurns = 0;
  if (typeof creature.originalAttack === 'number') {
    creature.baseAttack = creature.originalAttack;
  } else {
    creature.baseAttack = creature.attack ?? 0;
  }
  if (typeof creature.originalToughness === 'number') {
    creature.baseToughness = creature.originalToughness;
  } else {
    creature.baseToughness = creature.toughness ?? 0;
  }
  if (creature.originalAbilities) {
    creature.abilities = JSON.parse(JSON.stringify(creature.originalAbilities));
  }
  delete creature._dying;
  delete creature._destroyScheduled;
  player.graveyard.push(creature);
  addLog([cardSegment(creature), textSegment(' dies.')]);
}

export function dealDamageToPlayer(index, amount) {
  const player = state.game.players[index];
  player.life -= amount;
  addLog([
    playerSegment(player),
    textSegment(' takes '),
    damageSegment(amount),
    textSegment(` damage (life ${player.life}).`),
  ]);
  checkForWinnerHook();
}

export function getCreatureStats(creature, controllerIndex, game) {
  let attack = creature.baseAttack ?? creature.attack ?? 0;
  let toughness = creature.baseToughness ?? creature.toughness ?? 0;
  if (creature.buffs) {
    creature.buffs.forEach((buff) => {
      attack += buff.attack || 0;
      toughness += buff.toughness || 0;
    });
  }
  const controller = game.players[controllerIndex];
  controller.battlefield.forEach((card) => {
    if (card.passive?.type === 'static' && card.passive.effect.type === 'globalBuff') {
      const { scope, attack: atk = 0, toughness: tough = 0 } = card.passive.effect;
      if (scope === 'friendly' || (scope === 'other-friendly' && card.instanceId !== creature.instanceId)) {
        attack += atk;
        toughness += tough;
      }
    }
  });
  return { attack: Math.max(0, attack), toughness: Math.max(1, toughness) };
}

export function getCounterTotals(creature, controllerIndex, game) {
  const totals = {
    permanent: { attack: 0, toughness: 0 },
    temporary: { attack: 0, toughness: 0 },
  };
  if (!creature || creature.type !== 'creature') {
    return totals;
  }

  const originalAttack = Number.isFinite(creature.originalAttack) ? creature.originalAttack : creature.attack ?? 0;
  const originalToughness = Number.isFinite(creature.originalToughness)
    ? creature.originalToughness
    : creature.toughness ?? 0;
  const baseAttack = Number.isFinite(creature.baseAttack) ? creature.baseAttack : creature.attack ?? 0;
  const baseToughness = Number.isFinite(creature.baseToughness) ? creature.baseToughness : creature.toughness ?? 0;

  totals.permanent.attack += baseAttack - originalAttack;
  totals.permanent.toughness += baseToughness - originalToughness;

  if (creature.buffs && creature.buffs.length) {
    creature.buffs.forEach((buff) => {
      if (!buff) return;
      const atk = Number.isFinite(buff.attack) ? buff.attack : 0;
      const tough = Number.isFinite(buff.toughness) ? buff.toughness : 0;
      if (!atk && !tough) return;
      if (buff.duration === 'permanent') {
        totals.permanent.attack += atk;
        totals.permanent.toughness += tough;
      } else {
        totals.temporary.attack += atk;
        totals.temporary.toughness += tough;
      }
    });
  }

  if (Number.isInteger(controllerIndex) && game) {
    const stats = getCreatureStats(creature, controllerIndex, game);
    const auraAttack = stats.attack - (baseAttack + totals.temporary.attack);
    const auraToughness = stats.toughness - (baseToughness + totals.temporary.toughness);
    if (auraAttack || auraToughness) {
      totals.temporary.attack += auraAttack;
      totals.temporary.toughness += auraToughness;
    }
  }

  return totals;
}

export function checkForDeadCreatures() {
  state.game.players.forEach((player, idx) => {
    const dying = player.battlefield.filter(
      (c) => c.type === 'creature' && c.damageMarked >= getCreatureStats(c, idx, state.game).toughness,
    );
    if (dying.length === 0) return;
    dying.forEach((creature) => markCreatureForDeath(creature, idx));
  });
}

function markCreatureForDeath(creature, controllerIndex) {
  if (creature._destroyScheduled) {
    return;
  }
  creature._dying = true;
  creature._destroyScheduled = true;
  requestRender();
  setTimeout(() => {
    const game = state.game;
    const player = game?.players?.[controllerIndex];
    const stillOnBattlefield = player?.battlefield?.some((c) => c.instanceId === creature.instanceId);
    if (!stillOnBattlefield) {
      return;
    }
    destroyCreature(creature, controllerIndex);
    requestRender();
  }, 350);
}
