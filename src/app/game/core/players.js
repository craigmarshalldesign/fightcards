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
    life: 20,
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
    
    // First sort by mana cost
    if (costA !== costB) {
      return costA - costB;
    }
    
    // Within same mana cost, group by type (creatures first, then spells)
    const typeA = a.type === 'creature' ? 0 : 1;
    const typeB = b.type === 'creature' ? 0 : 1;
    if (typeA !== typeB) {
      return typeA - typeB;
    }
    
    // Within same cost and type, group identical cards together by name
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
