import { createCardInstance } from '../../game/cards/index.js';
import { state } from '../state.js';
import { addLog } from './log.js';

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

export function bounceCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  creature.summoningSickness = !creature.abilities?.haste;
  player.hand.push(creature);
  addLog(`${creature.name} returns to ${player.name}'s hand.`);
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
  creature.frozenTurns = Math.max(1, creature.frozenTurns || 0);
  creature.summoningSickness = true;
  addLog(`${creature.name} is frozen.`);
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
  creature.buffs.push({ attack, toughness, duration: 'endOfTurn' });
}

export function applyPermanentBuff(creature, attack, toughness) {
  creature.baseAttack += attack;
  creature.baseToughness += toughness;
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
    addLog(`${creature.name} takes ${amount} damage (${remaining} toughness remaining).`);
  } else {
    addLog(`${creature.name} takes ${amount} damage.`);
  }
  if (creature.damageMarked >= stats.toughness) {
    destroyCreature(creature, controllerIndex);
  }
}

export function destroyCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  creature.damageMarked = 0;
  player.graveyard.push(creature);
  addLog(`${creature.name} is defeated.`);
}

export function dealDamageToPlayer(index, amount) {
  const player = state.game.players[index];
  player.life -= amount;
  addLog(`${player.name} takes ${amount} damage (life ${player.life}).`);
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

export function checkForDeadCreatures() {
  state.game.players.forEach((player, idx) => {
    player.battlefield
      .filter((c) => c.type === 'creature' && c.damageMarked >= getCreatureStats(c, idx, state.game).toughness)
      .forEach((creature) => destroyCreature(creature, idx));
  });
}
