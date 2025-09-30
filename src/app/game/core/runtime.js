import { state, requestRender } from '../../state.js';
import { runAI } from '../ai-loader.js';

export function cloneGameStateForNetwork(game) {
  return {
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      life: player.life,
      deck: player.deck.map((card) => ({ id: card.id, instanceId: card.instanceId })),
      hand: player.hand.map(cloneCardLite),
      battlefield: player.battlefield.map(cloneCardFull),
      graveyard: player.graveyard.map(cloneCardLite),
      maxMana: player.maxMana,
      availableMana: player.availableMana,
    })),
    currentPlayer: game.currentPlayer,
    phase: game.phase,
    turn: game.turn,
    pendingAction: game.pendingAction ? JSON.parse(JSON.stringify(game.pendingAction)) : null,
    combat: game.combat ? JSON.parse(JSON.stringify(game.combat)) : null,
    blocking: game.blocking ? JSON.parse(JSON.stringify(game.blocking)) : null,
    preventCombatDamageFor: game.preventCombatDamageFor,
    preventDamageToAttackersFor: game.preventDamageToAttackersFor,
    winner: game.winner,
  };
}

function cloneCardLite(card) {
  return {
    id: card.id,
    instanceId: card.instanceId,
    name: card.name,
    type: card.type,
    color: card.color,
    cost: card.cost,
  };
}

function cloneCardFull(card) {
  return {
    ...cloneCardLite(card),
    attack: card.attack,
    toughness: card.toughness,
    baseAttack: card.baseAttack,
    baseToughness: card.baseToughness,
    summoningSickness: card.summoningSickness,
    frozenTurns: card.frozenTurns,
    damageMarked: card.damageMarked,
    buffs: card.buffs ? card.buffs.map((buff) => ({ ...buff })) : [],
    abilities: card.abilities ? { ...card.abilities } : undefined,
    passive: card.passive ? { ...card.passive } : undefined,
    activated: card.activated ? { ...card.activated } : undefined,
  };
}

export function continueAIIfNeeded() {
  const game = state.game;
  if (!game) return;
  
  // Only run AI if the current player is actually an AI player
  const currentPlayer = game.players[game.currentPlayer];
  if (currentPlayer?.isAI) {
    runAI();
  }
}

export async function checkForWinner() {
  const game = state.game;
  if (!game || game.winner != null) return;
  if (game.players[0].life <= 0) {
    game.winner = 1;
    state.screen = 'game-over';
  } else if (game.players[1].life <= 0) {
    game.winner = 0;
    state.screen = 'game-over';
  }
  if (game.winner != null) {
    requestRender();
    // Don't auto-delete match data - let user view it as long as they want
    // Cleanup will happen when they leave the game-over screen or close the page
  }
}
