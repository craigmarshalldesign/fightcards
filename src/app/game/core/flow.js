import { buildDeck, COLORS } from '../../../game/cards/index.js';
import { addLog, cardSegment, playerSegment, textSegment } from '../log.js';
import { state, requestRender } from '../../state.js';
import {
  addMultiplayerLogEvent,
  isMultiplayerMatchActive,
  seedMultiplayerMatch,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
  getLocalSeatIndex,
} from '../../multiplayer/runtime.js';
import {
  assignBlockerToAttacker,
  canSelectBlocker,
  confirmAttackers,
  describePhase,
  describePhaseDetailed,
  isAttackingCreature,
  prepareBlocks,
  registerPassiveHandler,
  resolveCombat as resolveCombatPhase,
  selectBlocker,
  skipCombat as skipCombatPhase,
  startCombatStage,
  toggleAttacker,
  notifyTriggerResolved,
} from '../combat/index.js';
import { registerAIHelpers } from '../ai.js';
import {
  autoSelectTargetsForRequirement,
  buildEffectRequirements,
  computeRequirements,
  effectRequiresChoice,
  getValidTargetsForRequirement,
} from './requirements.js';
import {
  cancelPendingAction,
  confirmPendingAction,
  finalizeCurrentRequirement,
  handlePlayerTargetSelection,
  handleTargetSelection,
  isTargetableCreature,
  isTargetablePlayer,
  scheduleAIPendingConfirmation,
  scheduleAIPendingResolution,
  selectTargetForPending,
} from './pending.js';
import {
  createPlayer,
  drawCards,
  initializeCreature,
  logSummon,
  removeFromHand,
  sortHand,
  spendMana,
} from './players.js';
import { resolveEffects } from './effects.js';
import { checkForWinner, continueAIIfNeeded } from './runtime.js';
import { dealDamageToPlayer, registerWinnerHook } from '../creatures.js';
import { createInitialStats, recordTurnStart, recordCardPlay } from './stats.js';

function cardToEventPayload(card) {
  if (!card) return null;
  const { id, instanceId, name, type, color, cost } = card;
  return { id, instanceId, name, type, color, cost };
}

function skipCombatWrapper() {
  skipCombatPhase();
  continueAIIfNeeded();
}

function resolveCombatWrapper() {
  resolveCombatPhase();
  continueAIIfNeeded();
}

function engageCardHandRemoval(player, card, predicate = removeFromHand) {
  if (!player || !card) return;
  if (!isMultiplayerMatchActive()) {
    removeFromHand(player, card.instanceId);
  } else if (predicate) {
    predicate(player, card);
  }
}

export function canPlayCard(card, playerIndex, game) {
  if (!game) return false;
  const player = game.players[playerIndex];
  if (game.currentPlayer !== playerIndex) return false;
  if (!(game.phase === 'main1' || game.phase === 'main2')) return false;
  return player.availableMana >= (card.cost ?? 0);
}

export function playCreature(playerIndex, card) {
  const game = state.game;
  const player = game.players[playerIndex];
  
  // CRITICAL: In multiplayer, hand removal happens during event replay ONLY
  // In single-player, remove from hand immediately
  engageCardHandRemoval(player, card);
  
  // Spend mana locally for immediate UI feedback (both modes)
  spendMana(player, card.cost ?? 0);
  
  initializeCreature(card);

  const onEnterEffect = card.passive?.type === 'onEnter' ? card.passive.effect : null;
  const requiresSelection = Boolean(onEnterEffect && effectRequiresChoice(onEnterEffect));

  if (requiresSelection) {
    const rawRequirements = onEnterEffect ? buildEffectRequirements([onEnterEffect]) : [];
    const requirements = rawRequirements.map((req) => {
      const validTargets = getValidTargetsForRequirement(req, playerIndex, card);
      if (validTargets.length === 0) {
        return { ...req, allowLess: true, noValidTargets: true };
      }
      return req;
    });

    const pending = {
      type: 'summon',
      controller: playerIndex,
      card,
      effects: onEnterEffect ? [onEnterEffect] : [],
      requirements,
      requirementIndex: 0,
      selectedTargets: [],
      chosenTargets: {},
      cancellable: true,
      awaitingConfirmation: false,
      isAI: Boolean(player.isAI),
    };
    game.pendingAction = pending;
    addLog(
      [playerSegment(player), textSegment(' prepares to summon '), cardSegment(card), textSegment('.')],
      undefined,
      'spell',
    );
    if (isMultiplayerMatchActive()) {
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_CREATED, {
        controller: playerIndex,
        kind: 'summon',
        card: cardToEventPayload(card),
        requirements,
        effects: onEnterEffect ? [onEnterEffect] : [],
      });
    }
    requestRender();
    if (player.isAI) {
      scheduleAIPendingResolution(pending);
    }
    return;
  }

  // In multiplayer, don't add to battlefield here - let the event handle it to avoid duplicates
  // In single player, add it immediately
  if (!isMultiplayerMatchActive()) {
    player.battlefield.push(card);
    logSummon(player, card);
    recordCardPlay(playerIndex, 'creature');
    handlePassive(card, playerIndex, 'onEnter');
  } else {
    // In multiplayer, just create the event - it will be applied via event replay
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.CARD_PLAYED, {
      controller: playerIndex,
      card: cardToEventPayload(card),
      zone: 'battlefield',
    });
  }
}

export function prepareSpell(playerIndex, card, options = {}) {
  const game = state.game;
  const player = game.players[playerIndex];
  const baseRequirements = computeRequirements(card);
  const requirements = baseRequirements.map((req) => {
    const validTargets = getValidTargetsForRequirement(req, playerIndex, card);
    if (validTargets.length === 0) {
      return { ...req, allowLess: true, noValidTargets: true };
    }
    return req;
  });
  
  engageCardHandRemoval(player, card);
  
  const pending = {
    type: 'spell',
    controller: playerIndex,
    card,
    effects: card.effects || [],
    requirements,
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: true,
    awaitingConfirmation: false,
    isAI: Boolean(player.isAI),
    removedFromHand: true,
  };
  if (options.aiChosenTargets) {
    pending.aiChosenTargets = options.aiChosenTargets;
  }
  
  // Set local pending action
  game.pendingAction = pending;
  
  // Create the event for multiplayer sync
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_CREATED, {
      controller: playerIndex,
      kind: 'spell',
      card: cardToEventPayload(card),
      requirements,
      effects: pending.effects,
      awaitingConfirmation: requirements.length === 0,
    });
  } else {
    // Only log locally in single-player; multiplayer logs during event replay
    addLog([playerSegment(player), textSegment(' prepares '), cardSegment(card), textSegment('.')], undefined, 'spell');
  }
  
  if (requirements.length === 0) {
    pending.awaitingConfirmation = true;
    requestRender();
    if (pending.isAI) {
      scheduleAIPendingConfirmation(pending);
    }
    return;
  }
  requestRender();
  if (pending.isAI) {
    scheduleAIPendingResolution(pending);
  }
}

export function handlePassive(card, controllerIndex, trigger) {
  if (!card.passive || card.passive.type !== trigger) return;
  const effect = card.passive.effect;
  if (!effect) return;
  const description = card.passive.description;
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const player = state.game.players[controllerIndex];
  const isOptional = effect.optional === true;

  const pending = {
    type: 'trigger',
    controller: controllerIndex,
    card,
    effects: [effect],
    requirements: [],
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: isOptional ? true : false,
    optional: isOptional,
    awaitingConfirmation: false,
    isAI: Boolean(player.isAI),
  };

  if (effect.type === 'damage' && effect.target === 'any') {
    if (description) {
      addLog([cardSegment(card), textSegment(' triggers: '), textSegment(description)], undefined, 'spell');
    }
    const requirements = buildEffectRequirements([effect]);
    if (requirements.length) {
      pending.requirements = requirements;
      const requirement = requirements[0];
      const requiredCount = requirement.count ?? 1;
      const autoTargets = autoSelectTargetsForRequirement(requirement, controllerIndex, card);
      if (autoTargets.length) {
        pending.chosenTargets[requirement.effectIndex] = autoTargets.slice(0, requiredCount);
        state.game.pendingAction = pending;
        confirmPendingAction(pending);
        return;
      }
    }
    // CRITICAL: dealDamageToPlayer now handles multiplayer correctly (event-only mode)
    dealDamageToPlayer(opponentIndex, effect.amount);
    requestRender();
    checkForWinner();
    continueAIIfNeeded();
    return;
  }

  if (description) {
    addLog([cardSegment(card), textSegment(' triggers: '), textSegment(description)], undefined, 'spell');
  }

  const requiresChoice = effectRequiresChoice(effect);
  if (requiresChoice) {
    const requirements = buildEffectRequirements([effect]);
    if (requirements.length) {
      pending.requirements = requirements;
      const isHuman = !player.isAI;
      let needsSelection = false;
      let hasAvailableTargets = false;

      requirements.forEach((requirement) => {
        const validTargets = getValidTargetsForRequirement(requirement, controllerIndex, card);
        if (validTargets.length > 0) {
          hasAvailableTargets = true;
        }
        if (validTargets.length === 0) {
          pending.chosenTargets[requirement.effectIndex] = [];
          return;
        }
        const requiredCount = requirement.count ?? 1;
        const autoTargets = autoSelectTargetsForRequirement(requirement, controllerIndex, card);
        const uniqueChoices = validTargets.length > requiredCount;
        const playerCanChoose =
          requirement.target !== 'any' && isHuman && uniqueChoices && requiredCount > 0;

        if (isHuman && (requirement.allowLess || playerCanChoose)) {
          needsSelection = true;
          return;
        }

        pending.chosenTargets[requirement.effectIndex] = autoTargets.slice(0, requiredCount);
      });

      if (!hasAvailableTargets && isOptional) {
        addLog([cardSegment(card), textSegment(' ability skipped.')]);
        requestRender();
        checkForWinner();
        continueAIIfNeeded();
        notifyTriggerResolved();
        return;
      }

      if (needsSelection) {
        state.game.pendingAction = pending;
        requestRender();
        if (player.isAI) {
          scheduleAIPendingResolution(pending);
        }
        return;
      }
    }
  }

  state.game.pendingAction = pending;
  confirmPendingAction(pending);
}

export function activateCreatureAbility(creatureId) {
  const game = state.game;
  const localPlayerIndex = getLocalSeatIndex();
  const creature = game.players[localPlayerIndex].battlefield.find((c) => c.instanceId === creatureId);
  if (game.pendingAction) return;
  if (!creature || !creature.activated || creature.activatedThisTurn) return;
  if (creature.frozenTurns > 0) {
    addLog([cardSegment(creature), textSegment(' is frozen and cannot use its ability right now.')]);
    requestRender();
    return;
  }
  if (game.players[localPlayerIndex].availableMana < creature.activated.cost) return;
  const effect = creature.activated.effect;
  const requirements = buildEffectRequirements([effect]);
  const pending = {
    type: 'ability',
    controller: localPlayerIndex,
    card: creature,
    effects: [effect],
    requirements,
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: true,
    awaitingConfirmation: false,
    isAI: false,
  };

  if (!requirements.length) {
    // CRITICAL: For abilities with no targeting requirements (like gainMana)
    // In multiplayer, emit event so both players see it
    // In single-player, execute immediately
    if (isMultiplayerMatchActive()) {
      // Multiplayer: emit PENDING_RESOLVED event (skip PENDING_CREATED since no targeting needed)
      const player = game.players[localPlayerIndex];
      spendMana(player, creature.activated.cost ?? 0);
      creature.activatedThisTurn = true;
      
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_RESOLVED, {
        controller: localPlayerIndex,
        kind: 'ability',
        card: cardToEventPayload(creature),
        chosenTargets: {},
        effects: [effect],
      });
      requestRender();
      return;
    }
    
    // Single-player: execute immediately
    const player = game.players[localPlayerIndex];
    spendMana(player, creature.activated.cost ?? 0);
    creature.activatedThisTurn = true;
    addLog([
      playerSegment(player),
      textSegment(' activates '),
      cardSegment(creature),
      textSegment(`'s ${creature.activated.name || 'ability'}.`),
    ]);
    resolveEffects([effect], {
      controller: localPlayerIndex,
      card: creature,
      requirements: [],
      requirementIndex: 0,
      selectedTargets: [],
      chosenTargets: { 0: [] },
    });
    requestRender();
    continueAIIfNeeded();
    return;
  }

  pending.requirements.forEach((req) => {
    const valid = getValidTargetsForRequirement(req, localPlayerIndex, creature);
    const requiredCount = req.count ?? 1;
    if (valid.length === 0) {
      pending.chosenTargets[req.effectIndex] = [];
      return;
    }
    if (req.allowLess) {
      return;
    }
    const auto = autoSelectTargetsForRequirement(req, localPlayerIndex, creature);
    if (auto.length && auto.length <= requiredCount) {
      pending.chosenTargets[req.effectIndex] = auto.slice(0, requiredCount);
    }
  });

  state.game.pendingAction = pending;
  
  // CRITICAL: Emit event in multiplayer so opponent can see the pending action and targeting arrows
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_CREATED, {
      controller: localPlayerIndex,
      kind: 'ability',
      card: cardToEventPayload(creature),
      requirements,
      effects: [effect],
    });
  }
  
  requestRender();
}

export function beginTurn(playerIndex) {
  const game = state.game;
  const player = game.players[playerIndex];

  recordTurnStart(playerIndex);

  // In multiplayer, only create the event, don't apply effects locally
  // The event replay will apply the effects for both players
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.TURN_STARTED, {
      turn: game.turn,
      activePlayer: playerIndex,
      phase: 'main1',
    });
    return; // Don't apply effects locally - let the event do it
  }
  
  // Single player: apply effects directly (including frozen turns decrement)
  game.players.forEach((p) => {
    p.battlefield.forEach((creature) => {
      if (creature.frozenTurns) {
        creature.frozenTurns = Math.max(0, creature.frozenTurns - 1);
      }
    });
  });
  
  player.maxMana += 1;
  player.availableMana = player.maxMana;
  drawCards(player, 1);
  player.battlefield.forEach((creature) => {
    creature.summoningSickness = false;
    creature.activatedThisTurn = false;
    if (creature.temporaryHaste) {
      creature.temporaryHaste = false;
    }
  });
  addLog([playerSegment(player), textSegment(` starts their turn with ${player.availableMana} mana.`)]);
  game.phase = 'main1';
  game.preventCombatDamageFor = null;
  game.preventDamageToAttackersFor = null;
}

export function advancePhase() {
  const game = state.game;
  if (!game) return;
  if (game.pendingAction) {
    addLog('Resolve the pending action first.');
    requestRender();
    return;
  }
  if (game.phase === 'main1') {
    game.phase = 'combat';
    startCombatStage();
    if (isMultiplayerMatchActive()) {
      // Update match state immediately for UI responsiveness
      if (state.multiplayer.match) {
        state.multiplayer.match.phase = game.phase;
      }
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PHASE_CHANGED, {
        turn: game.turn,
        activePlayer: game.currentPlayer,
        phase: game.phase,
      });
    }
    requestRender();
  } else if (game.phase === 'combat') {
    skipCombatWrapper();
    return;
  } else if (game.phase === 'main2') {
    endTurn();
    return;
  } else {
    // Going to main2 phase
    game.phase = 'main2';
    if (isMultiplayerMatchActive()) {
      // Update match state immediately for UI responsiveness
      if (state.multiplayer.match) {
        state.multiplayer.match.phase = game.phase;
      }
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PHASE_CHANGED, {
        turn: game.turn,
        activePlayer: game.currentPlayer,
        phase: game.phase,
      });
    }
    requestRender();
  }
  continueAIIfNeeded();
}

export function endTurn() {
  const game = state.game;
  
  // In multiplayer, only create event - don't apply locally
  // CRITICAL: End-of-turn cleanup moved to TURN_STARTED event handler
  if (isMultiplayerMatchActive()) {
    const nextPlayer = game.currentPlayer === 0 ? 1 : 0;
    const nextTurn = game.turn + 1;
    
    game.turn = nextTurn;
    game.currentPlayer = nextPlayer;
    game.phase = 'main1';
    
    if (state.multiplayer.match) {
      state.multiplayer.match.turn = nextTurn;
      state.multiplayer.match.activePlayer = nextPlayer;
      state.multiplayer.match.phase = 'main1';
    }
    
    beginTurn(nextPlayer);
    requestRender();
    return;
  }
  
  // Single player: Clean up end-of-turn effects, then start next turn
  game.players.forEach((player) => {
    player.battlefield.forEach((creature) => {
      creature.damageMarked = 0;
      if (creature.buffs) {
        creature.buffs = creature.buffs.filter((buff) => buff.duration !== 'endOfTurn');
      }
    });
  });
  
  game.phase = 'main1';
  game.currentPlayer = game.currentPlayer === 0 ? 1 : 0;
  game.turn += 1;
  beginTurn(game.currentPlayer);
  requestRender();
  continueAIIfNeeded();
}

function rollForInitiative() {
  let player = 0;
  let ai = 0;
  do {
    player = 1 + Math.floor(Math.random() * 6);
    ai = 1 + Math.floor(Math.random() * 6);
  } while (player === ai);
  return { player, ai, winner: player > ai ? 0 : 1 };
}

export function startGame(color) {
  const playerName = state.auth.user?.email?.split('@')[0] || 'You';
  const aiColor = pickAIOpponent(color);
  const playerDeck = buildDeck(color);
  const aiDeck = buildDeck(aiColor);
  const player = createPlayer(playerName, color, false, playerDeck);
  const ai = createPlayer('AI Opponent', aiColor, true, aiDeck);
  const game = {
    players: [player, ai],
    currentPlayer: 0,
    phase: 'main1',
    turn: 1,
    log: [],
    pendingAction: null,
    combat: null,
    blocking: null,
    preventCombatDamageFor: null,
    winner: null,
    dice: rollForInitiative(),
    stats: createInitialStats(),
  };
  if (isMultiplayerMatchActive()) {
    seedMultiplayerMatch(game);
  }
  game.currentPlayer = game.dice.winner;
  state.game = game;
  state.screen = 'game';
  state.ui.battleLogExpanded = false;
  state.ui.spellLogExpanded = false;
  state.ui.previewCard = null;
  addLog(
    `Initiative roll — You: ${game.dice.player}, AI: ${game.dice.ai}. ${
      game.currentPlayer === 0 ? 'You go first.' : 'AI goes first.'
    }`,
    game,
  );
  addLog(`AI Opponent will wield the ${COLORS[aiColor].name} deck.`, game);
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.MATCH_STARTED, {
      turn: game.turn,
      activePlayer: game.currentPlayer,
      phase: game.phase,
      dice: game.dice,
    });
  }
  drawCards(player, 5);
  drawCards(ai, 5);
  beginTurn(game.currentPlayer);
  requestRender();
  continueAIIfNeeded();
}

function pickAIOpponent(playerColor) {
  const options = Object.keys(COLORS).filter((c) => c !== playerColor);
  return options[Math.floor(Math.random() * options.length)];
}

export function describeGameState() {
  if (!state.game) return 'Loading...';
  return describePhaseDetailed(state.game);
}

registerWinnerHook(checkForWinner);
registerPassiveHandler(handlePassive);

registerAIHelpers({
  advancePhase,
  playCreature,
  prepareSpell,
  computeRequirements,
  removeFromHand,
  spendMana,
  resolveEffects,
  drawCards,
  addLog,
  canPlayCard,
});

export {
  assignBlockerToAttacker,
  canSelectBlocker,
  cancelPendingAction,
  confirmAttackers,
  confirmPendingAction,
  describePhase,
  describePhaseDetailed,
  finalizeCurrentRequirement,
  handlePlayerTargetSelection,
  handleTargetSelection,
  isAttackingCreature,
  isTargetableCreature,
  isTargetablePlayer,
  prepareBlocks,
  resolveCombatWrapper as resolveCombat,
  scheduleAIPendingConfirmation,
  scheduleAIPendingResolution,
  selectBlocker,
  selectTargetForPending,
  skipCombatWrapper as skipCombat,
  startCombatStage,
  toggleAttacker,
  cardToEventPayload,
};
