import { state } from '../../state.js';

function createPlayerStats() {
  return {
    cardsPlayed: 0,
    spellsCast: 0,
    creaturesSummoned: 0,
    creaturesDestroyed: 0,
    creaturesLost: 0,
    damageDealt: 0,
    turnsTaken: 0,
  };
}

export function createInitialStats() {
  return {
    totalTurns: 0,
    players: [createPlayerStats(), createPlayerStats()],
  };
}

function getStats() {
  return state.game?.stats;
}

export function recordTurnStart(playerIndex) {
  const stats = getStats();
  if (!stats || typeof playerIndex !== 'number') return;
  stats.totalTurns += 1;
  const playerStats = stats.players[playerIndex];
  if (playerStats) {
    playerStats.turnsTaken += 1;
  }
}

export function recordCardPlay(playerIndex, cardType) {
  const stats = getStats();
  if (!stats || typeof playerIndex !== 'number') return;
  const playerStats = stats.players[playerIndex];
  if (!playerStats) return;
  playerStats.cardsPlayed += 1;
  if (cardType === 'spell') {
    playerStats.spellsCast += 1;
  } else if (cardType === 'creature') {
    playerStats.creaturesSummoned += 1;
  }
}

export function recordCreatureLoss(controllerIndex) {
  const stats = getStats();
  if (!stats || typeof controllerIndex !== 'number') return;
  const ownerStats = stats.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponentStats = stats.players[opponentIndex];
  if (ownerStats) {
    ownerStats.creaturesLost += 1;
  }
  if (opponentStats) {
    opponentStats.creaturesDestroyed += 1;
  }
}

export function recordDamageToPlayer(targetIndex, amount) {
  if (!amount || amount <= 0) return;
  const stats = getStats();
  if (!stats || typeof targetIndex !== 'number') return;
  const dealerIndex = targetIndex === 0 ? 1 : 0;
  const dealerStats = stats.players[dealerIndex];
  if (dealerStats) {
    dealerStats.damageDealt += amount;
  }
}
