import { state, requestRender, db } from '../state.js';
import { buildDeck, CARD_LIBRARY } from '../../game/cards/index.js';
import { createPlayer, drawCards } from '../game/core/players.js';
import { createInitialStats } from '../game/core/stats.js';
import { cloneGameStateForNetwork } from '../game/core/runtime.js';
import {
  startGame,
  beginTurn,
  playCreature,
  prepareSpell,
  confirmPendingAction,
} from '../game/core/flow.js';
import { addLog, cardSegment, playerSegment, textSegment } from '../game/log.js';
import { dealDamageToPlayer } from '../game/creatures.js';
import { createCardInstance } from '../../game/cards/index.js';
import { resolveEffects } from '../game/core/effects.js';
import { cleanupPending } from '../game/core/pending.js';

const EVENT_TYPES = {
  MATCH_STARTED: 'match-started',
  TURN_STARTED: 'turn-started',
  PHASE_CHANGED: 'phase-changed',
  CARD_PLAYED: 'card-played',
  TOKEN_CREATED: 'token-created',
  CARD_LEFT_BATTLEFIELD: 'card_left_battlefield',
  CREATURE_DESTROYED: 'creature-destroyed',
  PENDING_CREATED: 'pending-created',
  PENDING_UPDATED: 'pending-updated',
  PENDING_RESOLVED: 'pending-resolved',
  EFFECT_RESOLVED: 'effect-resolved',
  ATTACKER_TOGGLED: 'attacker-toggled',
  ATTACKERS_CONFIRMED: 'attackers-confirmed',
  BLOCKING_STARTED: 'blocking-started',
  BLOCKER_SELECTED: 'blocker-selected',
  BLOCKER_ASSIGNED: 'blocker-assigned',
  COMBAT_STARTED: 'combat-started',
  COMBAT_RESOLVED: 'combat-resolved',
  LIFE_CHANGED: 'life-changed',
  DRAW_CARD: 'draw-card',
  LOG: 'log',
};

export const MULTIPLAYER_EVENT_TYPES = EVENT_TYPES;

export function isMultiplayerMatchActive() {
  return Boolean(state.multiplayer.match);
}

export function seedMultiplayerMatch(game) {
  const match = state.multiplayer.match;
  if (!match) return;

  const hostSeat = createSeatPlayer(match, 'host');
  const guestSeat = createSeatPlayer(match, 'guest');

  game.players = [hostSeat, guestSeat];
  game.currentPlayer = match.activePlayer ?? 0;
  game.phase = match.phase ?? 'main1';
  game.turn = match.turn ?? 1;
  game.log = match.log ?? [];
  game.pendingAction = match.pendingAction ?? null;
  game.combat = null;
  game.blocking = null;
  game.preventCombatDamageFor = null;
  game.preventDamageToAttackersFor = null;
  game.winner = match.winner ?? null;
  game.dice = match.dice ?? null;
  game.stats = match.stats ?? createInitialStats();

  if (!match.state) {
    drawCards(hostSeat, 5);
    drawCards(guestSeat, 5);
  } else {
    Object.assign(game, match.state);
  }
}

function createSeatPlayer(match, seat) {
  const seatDeckColor = seat === 'host' ? match.hostColor : match.guestColor;
  const seatUserId = seat === 'host' ? match.hostUserId : match.guestUserId;
  const seatName = seat === 'host' ? match.hostDisplayName : match.guestDisplayName;
  const deck = seatDeckColor ? buildDeck(seatDeckColor) : buildDeck('red');
  const player = createPlayer(seatName || 'Player', seatDeckColor || 'red', false, deck);
  player.id = seatUserId || player.id;
  return player;
}

export function addMultiplayerLogEvent(message, category) {
  if (!isMultiplayerMatchActive()) return;
  enqueueMatchEvent(EVENT_TYPES.LOG, { message, category });
}

export function updateMultiplayerMatch(partial) {
  if (!state.multiplayer.match) return;
  Object.assign(state.multiplayer.match, partial);
  requestRender();
}

export async function enqueueMatchEvent(type, payload) {
  if (!state.multiplayer.match) return;
  const match = state.multiplayer.match;
  const nextSequence = match.nextSequence ?? 1;
  try {
    const eventId = await db.getLocalId('matchEvents');
    const now = Date.now();
    const ops = [
      db.tx.matchEvents[eventId].update({
        id: eventId,
        matchId: match.id,
        sequence: nextSequence,
        type,
        payload,
        createdAt: now,
      }),
      db.tx.matches[match.id].update({
        nextSequence: nextSequence + 1,
        updatedAt: now,
      }),
    ];

    await db.transact(ops);
  } catch (error) {
    console.error('Failed to enqueue match event', type, error);
  }
}

export function subscribeToMatch(matchId) {
  if (!matchId) return;
  if (typeof state.multiplayer.matchSubscription === 'function') {
    state.multiplayer.matchSubscription();
  }

  const query = {
    matches: {
      $: {
        where: { id: matchId },
        limit: 1,
      },
    },
    matchEvents: {
      $: {
        where: { matchId },
        orderBy: [{ field: 'sequence', direction: 'asc' }],
      },
    },
  };

  const unsubscribe = db.subscribeQuery(query, (snapshot) => {
    if (snapshot.error) {
      state.multiplayer.match = null;
      state.multiplayer.matchSubscription = null;
      requestRender();
      return;
    }

    const match = snapshot.data?.matches?.[0] ?? null;
    state.multiplayer.match = match;
    if (match) {
      ensureLocalSeat(match);
      ensureCardCache();
      state.multiplayer.matchEvents = snapshot.data?.matchEvents ?? [];
      state.multiplayer.currentMatchId = match.id;
      ensureGameInitialized();
      applyPendingEvents();
    }
    requestRender();
  });

  state.multiplayer.matchSubscription = unsubscribe;
}

export function clearMatch() {
  if (typeof state.multiplayer.matchSubscription === 'function') {
    state.multiplayer.matchSubscription();
  }
  state.multiplayer.matchSubscription = null;
  state.multiplayer.match = null;
  state.multiplayer.matchEvents = [];
  state.multiplayer.localSeat = null;
  state.multiplayer.currentMatchId = null;
  state.multiplayer.lastSequenceApplied = 0;
}

export function getLocalSeat() {
  return state.multiplayer.localSeat;
}

export function getLocalSeatIndex() {
  const seat = state.multiplayer.localSeat;
  if (!seat) return 0;
  return seat === 'host' ? 0 : 1;
}

export function getRemoteSeatFromLocal(localIndex) {
  const localSeat = state.multiplayer.localSeat;
  if (!localSeat) return localIndex;
  const localSeatIndex = localSeat === 'host' ? 0 : 1;
  if (localIndex === 0) return localSeatIndex;
  return localSeatIndex === 0 ? 1 : 0;
}

export function ensureLocalSeat(match) {
  const userId = state.auth.user?.id;
  if (!userId || !match) return;
  if (match.hostUserId === userId) {
    setLocalSeat('host');
  } else if (match.guestUserId === userId) {
    setLocalSeat('guest');
  }
}

export function setLocalSeat(seat) {
  state.multiplayer.localSeat = seat || null;
}

function ensureCardCache() {
  if (state.multiplayer.cardCache) return;
  const cache = {};
  Object.values(CARD_LIBRARY).forEach((cards) => {
    cards.forEach((card) => {
      cache[card.id] = card;
    });
  });
  state.multiplayer.cardCache = cache;
}

function applyPendingEvents() {
  if (!state.multiplayer.matchEvents?.length) return;
  const { matchEvents } = state.multiplayer;
  let nextSequence = state.multiplayer.lastSequenceApplied + 1;
  const pending = matchEvents.filter((event) => event.sequence >= nextSequence);
  if (!pending.length) return;

  ensureGameInitialized();
  const game = state.game;
  state.multiplayer.replayingEvents = true;
  pending
    .sort((a, b) => a.sequence - b.sequence)
    .forEach((event) => {
      if (event.sequence !== nextSequence) {
        return;
      }
      applyMatchEvent(game, event);
      state.multiplayer.lastSequenceApplied = event.sequence;
      nextSequence += 1;
    });
  state.multiplayer.replayingEvents = false;
  requestRender();
}

function ensureGameInitialized() {
  if (state.game && state.screen === 'game') return;
  if (state.multiplayer.match) {
    initializeMultiplayerGame();
    return;
  }
  const defaultColor = state.multiplayer.localSeat === 'guest' ? 'blue' : 'red';
  startGame(defaultColor);
}

function initializeMultiplayerGame() {
  const match = state.multiplayer.match;
  if (!match) return;

  const game = {
    players: [],
    currentPlayer: match.activePlayer ?? 0,
    phase: match.phase ?? 'main1',
    turn: match.turn ?? 1,
    log: match.log ? [...match.log] : [],
    pendingAction: match.pendingAction ? JSON.parse(JSON.stringify(match.pendingAction)) : null,
    combat: null,
    blocking: null,
    preventCombatDamageFor: null,
    preventDamageToAttackersFor: null,
    winner: match.winner ?? null,
    dice: match.dice ?? null,
    stats: match.stats ? JSON.parse(JSON.stringify(match.stats)) : createInitialStats(),
  };

  seedMultiplayerMatch(game);
  state.game = game;
  state.screen = 'game';
  state.ui.battleLogExpanded = false;
  state.ui.spellLogExpanded = false;
  state.ui.previewCard = null;
  requestRender();
}

function getControllerPlayer(game, controller) {
  if (!game?.players?.[controller]) return null;
  return game.players[controller];
}

function cloneCardForEvent(payload) {
  if (!payload?.card) return null;
  const template = state.multiplayer.cardCache?.[payload.card.id];
  if (!template) return null;
  const instance = createCardInstance(template);
  instance.instanceId = payload.card.instanceId;
  return instance;
}

function applyMatchEvent(game, event) {
  const { type, payload } = event;
  switch (type) {
    case EVENT_TYPES.MATCH_STARTED:
      game.turn = payload.turn;
      game.currentPlayer = payload.activePlayer;
      game.phase = payload.phase;
      game.dice = payload.dice;
      drawCards(game.players[0], 5);
      drawCards(game.players[1], 5);
      beginTurn(game.currentPlayer);
      break;
    case EVENT_TYPES.TURN_STARTED:
      game.turn = payload.turn;
      game.currentPlayer = payload.activePlayer;
      beginTurn(game.currentPlayer);
      break;
    case EVENT_TYPES.PHASE_CHANGED:
      game.phase = payload.phase;
      break;
    case EVENT_TYPES.CARD_PLAYED:
      handleCardPlayed(game, payload);
      break;
    case EVENT_TYPES.TOKEN_CREATED:
      addLog([playerSegment(game.players[payload.controller]), textSegment(' creates token '), cardSegment(payload.card), textSegment('.')]);
      break;
    case EVENT_TYPES.CARD_LEFT_BATTLEFIELD:
    case EVENT_TYPES.CREATURE_DESTROYED:
      addLog(createCardEventLog(type, payload));
      break;
    case EVENT_TYPES.PENDING_CREATED:
      rebuildPendingFromEvent(game, payload);
      break;
    case EVENT_TYPES.PENDING_UPDATED:
      updatePendingFromEvent(game, payload);
      break;
    case EVENT_TYPES.PENDING_RESOLVED:
      finalizePendingFromEvent(game, payload);
      break;
    case EVENT_TYPES.COMBAT_STARTED:
      game.combat = { attackers: [], stage: 'choose' };
      break;
    case EVENT_TYPES.ATTACKER_TOGGLED:
      toggleAttackerFromEvent(game, payload);
      break;
    case EVENT_TYPES.ATTACKERS_CONFIRMED:
      game.combat = game.combat || { attackers: [], stage: 'choose' };
      game.combat.attackers = payload.attackers || [];
      game.combat.stage = 'blockers';
      break;
    case EVENT_TYPES.PHASE_CHANGED:
      if (payload.phase === 'main2') {
        game.combat = null;
        game.blocking = null;
      }
      break;
    case EVENT_TYPES.BLOCKING_STARTED:
      game.blocking = { attackers: [...(game.combat?.attackers || [])], assignments: {}, selectedBlocker: null, awaitingDefender: true };
      break;
    case EVENT_TYPES.BLOCKER_ASSIGNED:
      if (game.blocking) {
        game.blocking.assignments = game.blocking.assignments || {};
        game.blocking.assignments[payload.attacker.instanceId] = payload.blocker;
      }
      break;
    case EVENT_TYPES.COMBAT_RESOLVED:
      addLog([textSegment('Combat resolves.')]);
      game.combat = null;
      game.blocking = null;
      break;
    case EVENT_TYPES.LIFE_CHANGED:
      game.players[payload.controller].life = payload.life;
      break;
    case EVENT_TYPES.DRAW_CARD:
      addLog([playerSegment(game.players[payload.controller]), textSegment(' draws a card.')]);
      break;
    case EVENT_TYPES.LOG:
      addLog(payload.message, undefined, payload.category);
      break;
    default:
      break;
  }
}

function handleCardPlayed(game, payload) {
  const player = getControllerPlayer(game, payload.controller);
  if (!player) return;
  addLog([playerSegment(player), textSegment(' resolves '), cardSegment(payload.card), textSegment('.')]);
}

function toggleAttackerFromEvent(game, payload) {
  if (!game.combat) {
    game.combat = { attackers: [], stage: 'choose' };
  }
  const exists = game.combat.attackers.some((entry) => entry.creature.instanceId === payload.creature.instanceId);
  if (payload.selected && !exists) {
    game.combat.attackers.push({ creature: payload.creature, controller: game.currentPlayer });
  } else if (!payload.selected && exists) {
    game.combat.attackers = game.combat.attackers.filter((entry) => entry.creature.instanceId !== payload.creature.instanceId);
  }
}

function rebuildPendingFromEvent(game, payload) {
  game.pendingAction = {
    type: payload.kind,
    controller: payload.controller,
    card: payload.card,
    effects: payload.effects || [],
    requirements: payload.requirements || [],
    requirementIndex: payload.requirementIndex ?? 0,
    chosenTargets: payload.chosenTargets || {},
    awaitingConfirmation: payload.awaitingConfirmation ?? false,
  };
}

function updatePendingFromEvent(game, payload) {
  if (!game.pendingAction) {
    rebuildPendingFromEvent(game, payload);
    return;
  }
  game.pendingAction.requirementIndex = payload.requirementIndex ?? game.pendingAction.requirementIndex;
  if (payload.chosenTargets) {
    game.pendingAction.chosenTargets = payload.chosenTargets;
  }
  if (payload.awaitingConfirmation !== undefined) {
    game.pendingAction.awaitingConfirmation = payload.awaitingConfirmation;
  }
}

function finalizePendingFromEvent(game, payload) {
  if (!game.pendingAction) {
    rebuildPendingFromEvent(game, payload);
  }
  game.pendingAction.chosenTargets = payload.chosenTargets;
  resolveEffects(payload.effects || [], game.pendingAction);
  cleanupPending(game.pendingAction);
  game.pendingAction = null;
}

function createCardEventLog(type, payload) {
  const { card, controller } = payload;
  const player = state.game.players[controller];
  switch (type) {
    case EVENT_TYPES.CARD_PLAYED:
      return [playerSegment(player), textSegment(' resolves '), cardSegment(card), textSegment('.')];
    case EVENT_TYPES.TOKEN_CREATED:
      return [playerSegment(player), textSegment(' creates token '), cardSegment(card), textSegment('.')];
    case EVENT_TYPES.CARD_LEFT_BATTLEFIELD:
      return [cardSegment(card), textSegment(' leaves the battlefield.')];
    case EVENT_TYPES.CREATURE_DESTROYED:
      return [cardSegment(card), textSegment(' is destroyed.')];
    default:
      return [textSegment('Unhandled event')];
  }
}

