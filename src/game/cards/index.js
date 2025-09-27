import { redCards } from './red-cards/index.js';
import { blueCards } from './blue-cards/index.js';
import { greenCards } from './green-cards/index.js';

export const COLORS = {
  red: {
    name: 'Fire',
    theme: 'Aggressive damage and burn spells',
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.22)',
  },
  blue: {
    name: 'Water',
    theme: 'Control, bounce, and sturdy creatures',
    accent: '#60a5fa',
    accentSoft: 'rgba(96, 165, 250, 0.22)',
  },
  green: {
    name: 'Grass',
    theme: 'Growing your creatures and gaining life',
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.22)',
  },
};

export const CARD_LIBRARY = {
  red: redCards,
  blue: blueCards,
  green: greenCards,
};

let nextInstanceId = 1;

function deepCopyCard(card) {
  return JSON.parse(JSON.stringify(card));
}

export function createCardInstance(card) {
  const copy = deepCopyCard(card);
  return {
    ...copy,
    instanceId: `${card.id}_${nextInstanceId++}`,
    summoningSickness: card.type === 'creature' && !card.abilities?.haste,
    damageMarked: 0,
    activatedThisTurn: false,
    buffs: [],
    baseAttack: copy.attack ?? 0,
    baseToughness: copy.toughness ?? 0,
    originalAttack: copy.attack ?? 0,
    originalToughness: copy.toughness ?? 0,
    originalAbilities: copy.abilities ? JSON.parse(JSON.stringify(copy.abilities)) : {},
  };
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function repeatCards(cards) {
  const duplicated = [];
  cards.forEach((card) => {
    duplicated.push(createCardInstance(card));
    duplicated.push(createCardInstance(card));
  });
  return duplicated;
}

export function buildDeck(color) {
  const baseCards = CARD_LIBRARY[color];
  if (!baseCards) {
    throw new Error(`Unknown deck color: ${color}`);
  }
  const fullDeck = repeatCards(baseCards);
  shuffle(fullDeck);
  return fullDeck;
}

export function cardSummary(card) {
  if (card.type === 'creature') {
    return `${card.attack}/${card.toughness} creature`;
  }
  return 'Spell';
}
