import { state, requestRender, db } from '../state.js';
import { buildDeck, CARD_LIBRARY } from '../../game/cards/index.js';
import { createPlayer, drawCards, initializeCreature, spendMana, removeFromHand, sortHand } from '../game/core/players.js';
import { createInitialStats, recordTurnStart, recordCardPlay, recordCreatureLoss } from '../game/core/stats.js';
import { cloneGameStateForNetwork, checkForWinner } from '../game/core/runtime.js';
import {
  startGame,
  beginTurn,
  playCreature,
  prepareSpell,
  confirmPendingAction,
  prepareBlocks,
  handlePassive,
} from '../game/core/flow.js';
import { addLog, cardSegment, playerSegment, textSegment, damageSegment } from '../game/log.js';
import { dealDamageToPlayer, dealDamageToCreature, checkForDeadCreatures, getCreatureStats } from '../game/creatures.js';
import { createCardInstance } from '../../game/cards/index.js';
import { resolveEffects } from '../game/core/effects.js';
import { cleanupPending } from '../game/core/pending.js';
import { generateId } from '../utils/id.js';
import {
  MULTIPLAYER_RULE_PARAMS,
  applyMultiplayerRuleParams,
} from './rules.js';
import { startTriggerStage } from '../game/combat/triggers.js';

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
  PENDING_CANCELLED: 'pending-cancelled',
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
  GAME_ENDED: 'game-ended',
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

/**
 * Enqueues a match event to the database for multiplayer synchronization.
 * 
 * HOW MULTIPLAYER WORKS:
 * - Each player action creates an "event" stored in the database
 * - Events have a sequence number to maintain order
 * - Both players subscribe to the match and replay events to stay in sync
 * - Only the active player can create new events (except for targeting/blocking)
 * 
 * IMPORTANT: Do not call this while replaying events (state.multiplayer.replayingEvents === true)
 * This prevents infinite loops where replaying an event creates a new event, which gets replayed, etc.
 */
export async function enqueueMatchEvent(type, payload) {
  if (!state.multiplayer.match) {
    console.log('enqueueMatchEvent: no match, returning', type);
    return;
  }
  // CRITICAL: Do not create new events while replaying existing events
  if (state.multiplayer.replayingEvents) {
    console.log('enqueueMatchEvent: replayingEvents is true, blocking event', type);
    return;
  }
  console.log('enqueueMatchEvent: creating event', type, payload);
  const match = state.multiplayer.match;
  const nextSequence = match.nextSequence ?? 1;
  
  // CRITICAL: Immediately increment nextSequence in local state to prevent race conditions
  // This ensures rapid successive calls use different sequence numbers
  match.nextSequence = nextSequence + 1;
  
  try {
    const eventId = generateId();
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

    await db.transact(ops.map((chunk) => applyMultiplayerRuleParams(chunk)).filter(Boolean));
  } catch (error) {
    console.error('Failed to enqueue match event', type, error);
    // Rollback the optimistic increment on failure
    match.nextSequence = nextSequence;
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
        limit: 1000,
      },
    },
  };

  const unsubscribe = db.subscribeQuery(
    query,
    (snapshot) => {
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
      const orderedEvents = [...(snapshot.data?.matchEvents ?? [])].sort((a, b) => {
        const aSeq = typeof a.sequence === 'number' ? a.sequence : 0;
        const bSeq = typeof b.sequence === 'number' ? b.sequence : 0;
        return aSeq - bSeq;
      });
      state.multiplayer.matchEvents = orderedEvents;
      state.multiplayer.currentMatchId = match.id;
      ensureGameInitialized();
      applyPendingEvents();
    }
    requestRender();
    },
    { ruleParams: MULTIPLAYER_RULE_PARAMS },
  );

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

export async function deleteMatchData(matchId) {
  if (!matchId) return false;
  
  try {
    // Delete all match events first
    const eventsToDelete = state.multiplayer.matchEvents
      .filter((event) => event.matchId === matchId)
      .map((event) => db.tx.matchEvents[event.id].delete());
    
    // Then delete the match itself
    const matchDelete = db.tx.matches[matchId].delete();
    
    const ops = [...eventsToDelete, matchDelete];
    await db.transact(ops.map((chunk) => applyMultiplayerRuleParams(chunk)).filter(Boolean));
    
    console.log(`Cleaned up match ${matchId} and ${eventsToDelete.length} events`);
    return true;
  } catch (error) {
    console.error('Failed to delete match data', matchId, error);
    return false;
  }
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
  // Don't reinitialize if game is already running or if we're on the game-over screen
  if (state.game && (state.screen === 'game' || state.screen === 'game-over')) return;
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

function ensureCardRemovedFromHand(player, instanceId, controller) {
  if (!player) {
    return;
  }
  const index = player.hand.findIndex((card) => card.instanceId === instanceId);
  if (index >= 0) {
    player.hand.splice(index, 1);
    return;
  }
  const localSeat = getLocalSeatIndex();
  if (controller === localSeat) {
    // Active player already removed this card locally for immediate feedback
    return;
  }
  if (player.hand.length > 0) {
    player.hand.pop();
  }
}

function ensureCardRestoredToHand(player, card, controller) {
  if (!player || !card) {
    return;
  }
  const exists = player.hand.some((handCard) => handCard.instanceId === card.instanceId);
  if (!exists) {
    player.hand.push(card);
    sortHand(player);
  }
}

function applyMatchEvent(game, event) {
  const { type, payload } = event;
  switch (type) {
    case EVENT_TYPES.MATCH_STARTED:
      // During replay, just set the state - don't call beginTurn() as it creates new events
      game.turn = payload.turn;
      game.currentPlayer = payload.activePlayer;
      game.phase = payload.phase;
      game.dice = payload.dice;
      
      // Only draw cards if they haven't been drawn yet
      if (game.players[0].hand.length === 0) {
        drawCards(game.players[0], 5);
      }
      if (game.players[1].hand.length === 0) {
        drawCards(game.players[1], 5);
      }
      
      // Give the starting player their first mana
      const startingPlayer = game.players[payload.activePlayer];
      if (startingPlayer) {
        startingPlayer.maxMana = 1;
        startingPlayer.availableMana = 1;
        addLog([playerSegment(startingPlayer), textSegment(` starts the game with ${startingPlayer.availableMana} mana.`)]);
      }
      break;
    case EVENT_TYPES.TURN_STARTED:
      game.turn = payload.turn;
      game.currentPlayer = payload.activePlayer;
      game.phase = payload.phase || 'main1';
      
      if (state.multiplayer.match) {
        state.multiplayer.match.activePlayer = payload.activePlayer;
        state.multiplayer.match.turn = payload.turn;
        state.multiplayer.match.phase = payload.phase || 'main1';
      }
      
      // CRITICAL: Record turn start for stats tracking
      recordTurnStart(payload.activePlayer);
      
      // CRITICAL: Clean up end-of-turn effects for ALL creatures (both players)
      game.players.forEach((p) => {
        p.battlefield.forEach((creature) => {
          // Clear damage marked at end of turn
          creature.damageMarked = 0;
          
          // Remove end-of-turn buffs
          if (creature.buffs) {
            creature.buffs = creature.buffs.filter((buff) => buff.duration !== 'endOfTurn');
          }
          
          // Decrement frozen turns
          if (creature.frozenTurns) {
            creature.frozenTurns = Math.max(0, creature.frozenTurns - 1);
          }
        });
      });
      
      // Apply beginning of turn effects (mana, cards, creature resets)
      const activePlayer = game.players[payload.activePlayer];
      if (activePlayer) {
        // Increment mana (max 10)
        if (activePlayer.maxMana < 10) {
          activePlayer.maxMana++;
        }
        activePlayer.availableMana = activePlayer.maxMana;
        
        // Draw a card
        drawCards(activePlayer, 1);
        
        // Reset creature states
        activePlayer.battlefield.forEach((creature) => {
          creature.summoningSickness = false;
          creature.activatedThisTurn = false;
          if (creature.temporaryHaste) {
            creature.temporaryHaste = false;
          }
        });
        
        addLog([playerSegment(activePlayer), textSegment(` starts their turn with ${activePlayer.availableMana} mana.`)]);
      }
      
      // Reset combat/damage prevention and clear combat state
      game.combat = null;
      game.blocking = null;
      game.preventCombatDamageFor = null;
      game.preventDamageToAttackersFor = null;
      
      // CRITICAL: Request render so UI updates with new turn
      requestRender();
      break;
    case EVENT_TYPES.PHASE_CHANGED:
      game.phase = payload.phase;
      
      // CRITICAL: Keep game state in sync with payload
      if (payload.activePlayer !== undefined) {
        game.currentPlayer = payload.activePlayer;
      }
      if (payload.turn !== undefined) {
        game.turn = payload.turn;
      }
      
      // Update match state for UI checks
      if (state.multiplayer.match) {
        state.multiplayer.match.phase = payload.phase;
        if (payload.activePlayer !== undefined) {
          state.multiplayer.match.activePlayer = payload.activePlayer;
        }
        if (payload.turn !== undefined) {
          state.multiplayer.match.turn = payload.turn;
        }
      }
      
      // Clean up combat state when moving to main2
      if (payload.phase === 'main2') {
        game.combat = null;
        game.blocking = null;
      }
      
      // Add log for phase transitions
      // Note: 'combat' phase logs are handled by COMBAT_STARTED event
      if (payload.phase === 'main2') {
        addLog([textSegment('Entering second main phase.')]);
      }
      break;
    case EVENT_TYPES.CARD_PLAYED:
      handleCardPlayed(game, payload);
      break;
    case EVENT_TYPES.TOKEN_CREATED:
      // CRITICAL: Actually create the token for both players during event replay
      const tokenController = game.players[payload.controller];
      if (tokenController) {
        const fullToken = cloneCardForEvent(payload);
        if (fullToken) {
          initializeCreature(fullToken);
          tokenController.battlefield.push(fullToken);
          addLog([playerSegment(tokenController), textSegment(' creates '), cardSegment(fullToken), textSegment('.')]);
          
          // CRITICAL: Record token creation for stats tracking
          recordCardPlay(payload.controller, 'creature');
        }
      }
      break;
    case EVENT_TYPES.CARD_LEFT_BATTLEFIELD:
      addLog(createCardEventLog(type, payload));
      break;
    case EVENT_TYPES.CREATURE_DESTROYED:
      // CRITICAL: Actually destroy the creature during event replay
      // Find the creature on the battlefield to get the full card object
      const destroyPlayer = game.players[payload.controller];
      const creatureToDestroy = destroyPlayer?.battlefield.find(c => c.instanceId === payload.card.instanceId);
      
      if (creatureToDestroy) {
        // Remove from battlefield
        const index = destroyPlayer.battlefield.indexOf(creatureToDestroy);
        if (index >= 0) {
          destroyPlayer.battlefield.splice(index, 1);
        }
        
        // CRITICAL: Record creature loss for stats tracking
        recordCreatureLoss(payload.controller);
        
        // Reset creature state
        creatureToDestroy.damageMarked = 0;
        creatureToDestroy.buffs = [];
        creatureToDestroy.temporaryHaste = false;
        creatureToDestroy.frozenTurns = 0;
        if (typeof creatureToDestroy.originalAttack === 'number') {
          creatureToDestroy.baseAttack = creatureToDestroy.originalAttack;
        }
        if (typeof creatureToDestroy.originalToughness === 'number') {
          creatureToDestroy.baseToughness = creatureToDestroy.originalToughness;
        }
        delete creatureToDestroy._dying;
        delete creatureToDestroy._destroyScheduled;
        
        // Add to graveyard
        destroyPlayer.graveyard.push(creatureToDestroy);
        
        // Log with full card object so name appears
        addLog([cardSegment(creatureToDestroy), textSegment(' dies.')]);
      } else {
        // Fallback if creature not found
        addLog(createCardEventLog(type, payload));
      }
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
    case EVENT_TYPES.PENDING_CANCELLED:
      // CRITICAL: This event is for the OPPONENT only
      // The active player already handled cancellation locally
      // So if pending action is null, that's fine - it means the active player already cleared it
      
      if (game.pendingAction) {
        const pending = game.pendingAction;
        const player = game.players[payload.controller];
        const fullCard = cloneCardForEvent(payload) || pending.card || payload.card;
        
        if (fullCard && player) {
          ensureCardRestoredToHand(player, fullCard, payload.controller);
          
          // Restore mana for summons
          if (payload.kind === 'summon') {
            const cost = fullCard.cost ?? 0;
            player.availableMana = Math.min(player.maxMana, player.availableMana + cost);
          }
          
          // Log the cancellation
          if (payload.kind === 'spell') {
            addLog([cardSegment(fullCard), textSegment(' cancelled.')], undefined, 'spell');
          } else {
            addLog([cardSegment(fullCard), textSegment(' action cancelled.')]);
          }
        }
        
        // Clean up the pending action
        cleanupPending(pending);
        game.pendingAction = null;
      }
      
      // Always request render to update UI
      requestRender();
      break;
    case EVENT_TYPES.COMBAT_STARTED:
      // CRITICAL: Build initial attackers array for the attacking player
      const combatControllerIndex = payload.controller;
      const combatController = game.players[combatControllerIndex];
      const eligibleAttackers = combatController.battlefield.filter(c => 
        c.type === 'creature' && !c.summoningSickness && !(c.frozenTurns > 0)
      );
      
      game.combat = { 
        attackers: eligibleAttackers.map(creature => ({ creature, controller: combatControllerIndex })),
        stage: 'choose',
        pendingTriggers: [],
        activeTrigger: null,
        resolvingTrigger: false,
        triggerOptions: null,
      };
      
      // Add combat start logs
      addLog([textSegment('Combat begins.')]);
      
      if (eligibleAttackers.length > 0) {
        addLog([textSegment(`${eligibleAttackers.length} creature(s) ready to attack.`)]);
      } else {
        addLog([textSegment('No creatures available to attack.')]);
      }
      break;
    case EVENT_TYPES.ATTACKER_TOGGLED:
      toggleAttackerFromEvent(game, payload);
      break;
    case EVENT_TYPES.ATTACKERS_CONFIRMED:
      game.combat = game.combat || { attackers: [], stage: 'choose' };
      // CRITICAL: Reconstruct full attacker entries from battlefield creatures
      game.combat.attackers = (payload.attackers || []).map((attackerStub) => {
        const fullCreature = game.players[attackerStub.controller].battlefield.find(
          (c) => c.instanceId === attackerStub.creature.instanceId
        );
        return fullCreature ? { creature: fullCreature, controller: attackerStub.controller } : null;
      }).filter(Boolean);
      
      // Log the attack
      const attackingPlayer = game.players[game.currentPlayer];
      addLog([
        playerSegment(attackingPlayer),
        textSegment(` attacks with ${game.combat.attackers.length} creature(s).`)
      ]);
      
      // CRITICAL: Only the active player should process triggers and emit PENDING_RESOLVED events
      // The opponent will receive and apply those events through the normal event replay
      // The active player will emit BLOCKING_STARTED when all triggers are done
      const isActivePlayer = getLocalSeatIndex() === game.currentPlayer;
      if (isActivePlayer) {
        // Active player: Delay trigger processing until after event replay completes
        // This ensures enqueueMatchEvent() can create PENDING_RESOLVED events
        setTimeout(() => {
          if (state.game?.combat) {
            startTriggerStage();
          }
        }, 0);
      } else {
        // Opponent: just set combat stage to 'triggers' and wait for BLOCKING_STARTED event
        game.combat.stage = 'triggers';
        game.combat.pendingTriggers = [];
        requestRender();
      }
      break;
    case EVENT_TYPES.BLOCKING_STARTED:
      // CRITICAL: Set combat stage to blockers and call prepareBlocks
      // This is needed for the opponent who was waiting in 'triggers' stage
      if (game.combat) {
        game.combat.stage = 'blockers';
      }
      prepareBlocks();
      break;
    case EVENT_TYPES.BLOCKER_ASSIGNED:
      if (game.blocking) {
        game.blocking.assignments = game.blocking.assignments || {};
        // CRITICAL: Look up the full blocker creature from the battlefield
        const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
        const fullBlocker = game.players[defendingIndex].battlefield.find(
          (c) => c.instanceId === payload.blocker.instanceId
        );
        if (fullBlocker) {
          game.blocking.assignments[payload.attacker.instanceId] = fullBlocker;
        }
      }
      break;
    case EVENT_TYPES.COMBAT_RESOLVED:
      // CRITICAL: Apply combat damage from the log on both clients
      if (payload.log && Array.isArray(payload.log)) {
        payload.log.forEach((entry) => {
          // Look up full creature objects from the battlefield
          const attackingPlayerIndex = entry.controller;
          const defendingPlayerIndex = attackingPlayerIndex === 0 ? 1 : 0;
          
          const attackingPlayer = game.players[attackingPlayerIndex];
          const defendingPlayer = game.players[defendingPlayerIndex];
          
          const attacker = attackingPlayer.battlefield.find(
            (c) => c.instanceId === entry.attacker.instanceId
          );
          
          if (entry.type === 'direct') {
            // Unblocked attacker hits player
            // Note: dealDamageToPlayer will log the damage, so no need to log here
            dealDamageToPlayer(defendingPlayerIndex, entry.damage);
          } else if (entry.type === 'combat') {
            // Blocked combat
            const blocker = defendingPlayer.battlefield.find(
              (c) => c.instanceId === entry.blocker.instanceId
            );
            
            if (attacker && blocker) {
              if (entry.damageToBlocker > 0) {
                addLog([
                  cardSegment(attacker),
                  textSegment(' deals '),
                  damageSegment(entry.damageToBlocker),
                  textSegment(' damage to '),
                  cardSegment(blocker),
                  textSegment('.'),
                ]);
              }
              dealDamageToCreature(blocker, defendingPlayerIndex, entry.damageToBlocker);
              
              // CRITICAL: Handle Stomp (trample) damage
              if (entry.stompDamage && entry.stompDamage > 0) {
                addLog([
                  cardSegment(attacker),
                  textSegment(' tramples over for '),
                  damageSegment(entry.stompDamage),
                  textSegment(' damage!'),
                ]);
                dealDamageToPlayer(defendingPlayerIndex, entry.stompDamage);
              }
              
              if (entry.damageToAttacker > 0) {
                addLog([
                  cardSegment(blocker),
                  textSegment(' deals '),
                  damageSegment(entry.damageToAttacker),
                  textSegment(' damage to '),
                  cardSegment(attacker),
                  textSegment('.'),
                ]);
              } else if (entry.damageToAttacker === 0 && attacker.buffs?.some(b => b.hidden)) {
                // Show Hidden message if attacker took no damage due to Hidden buff
                addLog([
                  cardSegment(attacker),
                  textSegment(' is Hidden and takes no damage!'),
                ]);
              }
              dealDamageToCreature(attacker, attackingPlayerIndex, entry.damageToAttacker);
            }
          }
        });
        
        // Check for and remove dead creatures
        checkForDeadCreatures();
      }
      
      // Clean up combat state
      game.combat = null;
      game.blocking = null;
      break;
    case EVENT_TYPES.LIFE_CHANGED:
      // CRITICAL: Apply life change for both players during event replay
      const lifePlayer = game.players[payload.controller];
      if (lifePlayer) {
        lifePlayer.life = payload.life;
        const deltaText = payload.delta > 0 ? 'gains' : 'takes';
        const deltaAmount = Math.abs(payload.delta);
        if (payload.delta > 0) {
          addLog([playerSegment(lifePlayer), textSegment(` gains ${deltaAmount} life (life ${lifePlayer.life}).`)]);
        } else {
          addLog([playerSegment(lifePlayer), textSegment(' takes '), damageSegment(deltaAmount), textSegment(` damage (life ${lifePlayer.life}).`)]);
        }
      }
      // Check if the game ended due to this life change
      checkForWinner();
      break;
    case EVENT_TYPES.DRAW_CARD:
      // CRITICAL: Actually draw the cards for both players during event replay
      const drawingPlayer = game.players[payload.controller];
      if (drawingPlayer) {
        drawCards(drawingPlayer, payload.amount);
        const cardText = payload.amount === 1 ? 'card' : 'cards';
        addLog([playerSegment(drawingPlayer), textSegment(` draws ${payload.amount} ${cardText}.`)]);
      }
      break;
    case EVENT_TYPES.LOG:
      addLog(payload.message, undefined, payload.category);
      break;
    case EVENT_TYPES.GAME_ENDED:
      // Another player ended the game - return to menu
      addLog([textSegment('The game has ended.')]);
      // Use setTimeout to allow the log to render before transitioning
      setTimeout(async () => {
        await deleteMatchData(state.multiplayer.currentMatchId);
        const { resetToMenu } = await import('../state.js');
        resetToMenu();
      }, 500);
      break;
    default:
      break;
  }
}

function handleCardPlayed(game, payload) {
  const player = getControllerPlayer(game, payload.controller);
  if (!player) return;
  
  // Reconstruct the full card from the card cache
  const fullCard = cloneCardForEvent(payload);
  if (!fullCard) {
    console.error('Failed to clone card for CARD_PLAYED event', payload.card);
    return;
  }
  
  // CRITICAL: Remove from hand during event replay so both players see updated hand count
  ensureCardRemovedFromHand(player, fullCard.instanceId, payload.controller);
  
  // Add the card to the appropriate zone
  if (payload.zone === 'battlefield') {
    // Initialize creature properties
    initializeCreature(fullCard);
    player.battlefield.push(fullCard);
    addLog([playerSegment(player), textSegment(' summons '), cardSegment(fullCard), textSegment('.')]);
    
    // CRITICAL: Record creature summon for stats tracking (for creatures played directly without targeting)
    recordCardPlay(payload.controller, 'creature');
    
    // CRITICAL: Handle onEnter passives (like Primal Behemoth's globalBuff)
    handlePassive(fullCard, payload.controller, 'onEnter');
  } else if (payload.zone === 'graveyard') {
    player.graveyard.push(fullCard);
    addLog([playerSegment(player), textSegment(' resolves '), cardSegment(fullCard), textSegment('.')]);
  }
}

function toggleAttackerFromEvent(game, payload) {
  if (!game.combat) {
    game.combat = { attackers: [], stage: 'choose' };
  }
  const exists = game.combat.attackers.some((entry) => entry.creature.instanceId === payload.creature.instanceId);
  if (payload.selected && !exists) {
    // CRITICAL: Look up the full creature from the battlefield instead of using the stub
    const controller = game.currentPlayer;
    const fullCreature = game.players[controller].battlefield.find(
      (c) => c.instanceId === payload.creature.instanceId
    );
    if (fullCreature) {
      game.combat.attackers.push({ creature: fullCreature, controller });
    }
  } else if (!payload.selected && exists) {
    game.combat.attackers = game.combat.attackers.filter((entry) => entry.creature.instanceId !== payload.creature.instanceId);
  }
}

function rebuildPendingFromEvent(game, payload) {
  const player = getControllerPlayer(game, payload.controller);
  let fullCard;
  
  // CRITICAL: For abilities and triggers, look up the creature from the battlefield
  // For spells/summons, create a new instance from the card cache
  if (payload.kind === 'ability' || payload.kind === 'trigger') {
    // Find the creature on the battlefield
    fullCard = player?.battlefield.find(c => c.instanceId === payload.card.instanceId);
    if (!fullCard) {
      console.error('Failed to find creature for ability/trigger event', payload.card);
      return;
    }
  } else {
    // Reconstruct the card from the card cache (for spells and summons)
    fullCard = cloneCardForEvent(payload);
    if (!fullCard) {
      console.error('Failed to clone card for PENDING_CREATED event', payload.card);
      return;
    }
    
    // Remove from hand for spells and summons
    if (player) {
      ensureCardRemovedFromHand(player, payload.card.instanceId, payload.controller);
    }
  }
  
  game.pendingAction = {
    type: payload.kind,
    controller: payload.controller,
    card: fullCard,
    effects: payload.effects || [],
    requirements: payload.requirements || [],
    requirementIndex: payload.requirementIndex ?? 0,
    chosenTargets: payload.chosenTargets || {},
    awaitingConfirmation: payload.awaitingConfirmation ?? false,
    selectedTargets: [],
    cancellable: true,
    removedFromHand: payload.kind !== 'ability' && payload.kind !== 'trigger',
  };
  
  // Log the action for the remote player
  if (player) {
    const actionText = payload.kind === 'ability' ? ' activates ' : ' prepares ';
    const suffix = payload.kind === 'ability' ? `'s ${fullCard.activated?.name || 'ability'}` : '';
    addLog([
      playerSegment(player), 
      textSegment(actionText), 
      cardSegment(fullCard), 
      textSegment(suffix + '.'),
    ], undefined, payload.kind === 'spell' || payload.kind === 'ability' ? 'spell' : undefined);
  }
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
  // CRITICAL: Update selectedTargets so opponent can see real-time targeting arrows
  if (payload.selectedTargets !== undefined) {
    game.pendingAction.selectedTargets = payload.selectedTargets;
  }
  if (payload.awaitingConfirmation !== undefined) {
    game.pendingAction.awaitingConfirmation = payload.awaitingConfirmation;
  }
}

function finalizePendingFromEvent(game, payload) {
  if (!game.pendingAction) {
    rebuildPendingFromEvent(game, payload);
  }
  
  const pending = game.pendingAction;
  
  // CRITICAL: For triggers, if the creature has left the battlefield, we still need to resolve the effect
  // Create a minimal pending object from the payload so effects can still be applied
  if (!pending && payload.kind === 'trigger') {
    game.pendingAction = {
      type: 'trigger',
      controller: payload.controller,
      card: payload.card, // Use the card stub from payload
      effects: payload.effects || [],
      requirements: [],
      requirementIndex: 0,
      chosenTargets: payload.chosenTargets || {},
      awaitingConfirmation: false,
      selectedTargets: [],
      cancellable: false,
    };
  }
  
  const finalPending = game.pendingAction;
  
  // CRITICAL: If we still don't have a pending action, we can't proceed
  if (!finalPending) {
    console.error('Failed to create pending action for PENDING_RESOLVED event', payload);
    return;
  }
  
  // CRITICAL: Reconstruct full creature targets from battlefield instead of using stubs
  // The payload.chosenTargets contains creature stubs (just id/instanceId)
  // We need to replace them with the actual creatures from the battlefield
  const reconstructedTargets = {};
  if (payload.chosenTargets) {
    Object.keys(payload.chosenTargets).forEach((effectIndex) => {
      const targets = payload.chosenTargets[effectIndex] || [];
      reconstructedTargets[effectIndex] = targets.map((target) => {
        if (target.type === 'player') {
          return target; // Player targets don't need reconstruction
        } else if (target.creature) {
          // Look up the full creature from the battlefield
          const targetPlayer = game.players[target.controller];
          const fullCreature = targetPlayer.battlefield.find(
            (c) => c.instanceId === target.creature.instanceId
          );
          if (fullCreature) {
            return { ...target, creature: fullCreature };
          }
        }
        return target;
      });
    });
  }
  finalPending.chosenTargets = reconstructedTargets;
  
  const player = getControllerPlayer(game, payload.controller);
  
  // If it's a summon, add the creature to the battlefield
  if (payload.kind === 'summon' && payload.card) {
    if (player) {
      const fullCard = cloneCardForEvent(payload);
      if (fullCard) {
        // NOTE: Card was already removed from hand in PENDING_CREATED event
        // Do NOT remove it again here or hand count will be wrong
        initializeCreature(fullCard);
        player.battlefield.push(fullCard);
        addLog([
          playerSegment(player),
          textSegment(' summons '),
          cardSegment(fullCard),
          textSegment('.'),
        ]);
        
        // CRITICAL: Record creature summon for stats tracking
        recordCardPlay(payload.controller, 'creature');
      }
    }
  } else if (payload.kind === 'spell' && finalPending.card) {
    // Handle spell casting
    if (player) {
      // NOTE: Card was already removed from hand in PENDING_CREATED event
      // Do NOT remove it again here or hand count will be wrong
      
      // Build target segments for log
      const targetSegments = [];
      if (finalPending.chosenTargets) {
        const effectIndexes = Object.keys(finalPending.chosenTargets)
          .map((k) => Number.parseInt(k, 10))
          .sort((a, b) => a - b);
        for (const idx of effectIndexes) {
          const targets = finalPending.chosenTargets[idx] || [];
          if (!targets.length) continue;
          const parts = [textSegment(' on ')];
          targets.forEach((t, i) => {
            if (i > 0) {
              parts.push(textSegment(i === targets.length - 1 ? ' and ' : ', '));
            }
            if (t.type === 'player') {
              const tgtPlayer = game.players[t.controller];
              parts.push(playerSegment(tgtPlayer));
            } else if (t.creature) {
              parts.push(cardSegment(t.creature));
            }
          });
          targetSegments.push(...parts);
          break;
        }
      }
      
      // Log spell casting
      addLog([
        playerSegment(player),
        textSegment(' casts '),
        cardSegment(finalPending.card),
        ...targetSegments,
        textSegment('.'),
      ], undefined, 'spell');
      
      // Spend mana
      spendMana(player, finalPending.card.cost ?? 0);
      
      // Add to graveyard
      player.graveyard.push(finalPending.card);
      
      // CRITICAL: Record spell cast for stats tracking
      recordCardPlay(payload.controller, 'spell');
    }
  } else if (payload.kind === 'ability' && finalPending.card) {
    // Log ability activation for the opponent
    const targetSegments = [];
    if (finalPending.chosenTargets) {
      const effectIndexes = Object.keys(finalPending.chosenTargets)
          .map((k) => Number.parseInt(k, 10))
        .sort((a, b) => a - b);
      for (const idx of effectIndexes) {
        const targets = finalPending.chosenTargets[idx] || [];
        if (!targets.length) continue;
        const parts = [textSegment(' on ')];
        targets.forEach((t, i) => {
          if (i > 0) {
            parts.push(textSegment(i === targets.length - 1 ? ' and ' : ', '));
          }
          if (t.type === 'player') {
            const tgtPlayer = game.players[t.controller];
            parts.push(playerSegment(tgtPlayer));
          } else if (t.creature) {
            parts.push(cardSegment(t.creature));
          }
        });
        targetSegments.push(...parts);
        break;
      }
    }
    
    if (player) {
      addLog([
        playerSegment(player),
        textSegment(' activates '),
        cardSegment(finalPending.card),
        textSegment(`'s ${finalPending.card.activated?.name || 'ability'}`),
        ...targetSegments,
        textSegment('.'),
      ]);
      
      // Mark the creature as having activated (for multiplayer opponent's side)
      if (finalPending.card.activated) {
        finalPending.card.activatedThisTurn = true;
      }
      
      // Spend mana on opponent's side
      spendMana(player, finalPending.card.activated?.cost ?? 0);
    }
  } else if (payload.kind === 'trigger' && finalPending.card) {
    // Log trigger activation
    // The trigger description was already logged by the active player in handlePassive
    // For the opponent, we need to log it here during event replay
    const localSeatIndex = getLocalSeatIndex();
    const isLocalPlayerActive = localSeatIndex === game.currentPlayer;
    
    // Only log for the opponent (active player already logged it in handlePassive)
    if (!isLocalPlayerActive && finalPending.card.passive?.description) {
      addLog([
        cardSegment(finalPending.card),
        textSegment(' triggers: '),
        textSegment(finalPending.card.passive.description)
      ], undefined, 'spell');
    }
  }
  
  resolveEffects(payload.effects || [], finalPending);
  cleanupPending(finalPending);
  game.pendingAction = null;
  
  // CRITICAL: Only the active player should advance the trigger queue
  // The opponent just applies effects and waits for BLOCKING_STARTED event
  const localSeatIndex = getLocalSeatIndex();
  const isLocalPlayerActive = localSeatIndex === game.currentPlayer;
  
  if (game.combat?.stage === 'triggers' && game.combat?.resolvingTrigger && isLocalPlayerActive) {
    // Active player: advance trigger queue after a delay to allow event to be created
    setTimeout(() => {
      import('../game/combat/triggers.js').then(module => {
        module.notifyTriggerResolved();
      });
    }, 0);
  }
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

