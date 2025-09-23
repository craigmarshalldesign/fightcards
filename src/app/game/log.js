import { state } from '../state.js';

const MAX_LOG_ENTRIES = 200;

export function addLog(message, gameOverride) {
  const target = gameOverride || state.game;
  if (!target) return;
  target.log.push(message);
  if (target.log.length > MAX_LOG_ENTRIES) {
    target.log.splice(0, target.log.length - MAX_LOG_ENTRIES);
  }
}

export function getRecentLogEntries(game, count = 3) {
  return game.log.slice(-count).reverse();
}

export function getFullLog(game) {
  return [...game.log].reverse();
}
