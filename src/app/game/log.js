import { state } from '../state.js';

const MAX_LOG_ENTRIES = 200;
const DEFAULT_CATEGORY = 'battle';

function normalizeCategory(category) {
  return category ?? DEFAULT_CATEGORY;
}

export function textSegment(text) {
  return { type: 'text', text };
}

export function playerSegment(player) {
  if (!player) {
    return textSegment('Unknown player');
  }
  return {
    type: 'player',
    id: player.id,
    name: player.name,
    color: player.color ?? 'neutral',
  };
}

function snapshotCard(card) {
  if (!card) return null;
  return {
    id: card.id ?? null,
    name: card.name ?? 'Unknown Card',
    type: card.type ?? 'card',
    color: card.color ?? 'neutral',
    cost: card.cost ?? null,
    text: card.text ?? '',
    baseAttack: card.baseAttack ?? card.attack ?? null,
    baseToughness: card.baseToughness ?? card.toughness ?? null,
    passive: card.passive ?? null,
  };
}

export function cardSegment(card, extra = {}) {
  if (!card) {
    return {
      type: 'card',
      name: 'Unknown Card',
      color: 'neutral',
      cardType: 'card',
      instanceId: null,
      snapshot: null,
      ...extra,
    };
  }
  return {
    type: 'card',
    name: card.name,
    color: card.color ?? 'neutral',
    cardType: card.type ?? 'card',
    instanceId: card.instanceId ?? null,
    snapshot: snapshotCard(card),
    ...extra,
  };
}

export function damageSegment(amount) {
  return { type: 'damage', amount };
}

export function healSegment(amount) {
  return { type: 'heal', amount };
}

export function keywordSegment(text) {
  return { type: 'keyword', text };
}

export function valueSegment(value, variant = 'default') {
  return { type: 'value', value, variant };
}

export function addLog(message, gameOverride, options = {}) {
  const target = gameOverride || state.game;
  if (!target) return;
  let entry;
  if (Array.isArray(message)) {
    entry = { segments: message };
  } else if (message && typeof message === 'object' && Array.isArray(message.segments)) {
    entry = { ...message };
  } else {
    entry = { segments: [textSegment(String(message))] };
  }
  const normalizedOptions = typeof options === 'string' ? { category: options } : options;
  entry.timestamp = Date.now();
  entry.category = normalizeCategory(entry.category ?? normalizedOptions.category);
  target.log.push(entry);
  if (target.log.length > MAX_LOG_ENTRIES) {
    target.log.splice(0, target.log.length - MAX_LOG_ENTRIES);
  }
}

export function getLogEntries(game, category = DEFAULT_CATEGORY) {
  return game.log
    .filter((entry) => normalizeCategory(entry.category) === normalizeCategory(category))
    .slice()
    .reverse();
}

export function getRecentLogEntries(game, category = DEFAULT_CATEGORY, count = 5) {
  return getLogEntries(game, category).slice(0, count);
}

export function getFullLog(game, category = DEFAULT_CATEGORY, recentCount = 5) {
  const entries = getLogEntries(game, category).slice().reverse();
  const skip = Math.min(recentCount, entries.length);
  return entries.slice(0, entries.length - skip).reverse();
}
