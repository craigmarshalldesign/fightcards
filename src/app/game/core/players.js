import { addLog, cardSegment, playerSegment, textSegment } from '../log.js';

export function createPlayer(name, color, isAI, deck) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color,
    isAI,
    deck: [...deck],
    hand: [],
    battlefield: [],
    graveyard: [],
    life: 15,
    maxMana: 0,
    availableMana: 0,
  };
}

export function initializeCreature(card) {
  card.baseAttack = card.baseAttack ?? card.attack ?? 0;
  card.baseToughness = card.baseToughness ?? card.toughness ?? 0;
  card.summoningSickness = !card.abilities?.haste;
  card.damageMarked = 0;
  card.buffs = [];
}

export function drawCards(player, amount) {
  for (let i = 0; i < amount; i += 1) {
    if (!player.deck.length) {
      addLog([playerSegment(player), textSegment(' cannot draw more cards.')]);
      break;
    }
    const card = player.deck.pop();
    player.hand.push(card);
  }
  sortHand(player);
}

export function spendMana(player, amount) {
  player.availableMana = Math.max(0, player.availableMana - amount);
}

export function removeFromHand(player, instanceId) {
  const index = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (index >= 0) {
    player.hand.splice(index, 1);
  }
}

export function sortHand(player) {
  player.hand.sort((a, b) => {
    const costA = a.cost ?? 0;
    const costB = b.cost ?? 0;
    if (costA !== costB) {
      return costA - costB;
    }
    return (a.name || '').localeCompare(b.name || '');
  });
}

export function logSummon(player, card, category = 'spell') {
  addLog([
    playerSegment(player),
    textSegment(' summons '),
    cardSegment(card),
    textSegment('.'),
  ], undefined, category);
}
