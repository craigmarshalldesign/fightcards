import { state, requestRender } from '../../state.js';
import {
  addLog,
  cardSegment,
  playerSegment,
  textSegment,
} from '../log.js';
import {
  autoSelectTargetsForRequirement,
  createCreatureTarget,
  createPlayerTarget,
  getValidTargetsForRequirement,
  isTargetValid,
} from './requirements.js';
import { removeFromHand, sortHand, spendMana } from './players.js';
import { resolveEffects } from './effects.js';
import { checkForWinner, continueAIIfNeeded } from './runtime.js';
import { notifyTriggerResolved } from '../combat/triggers.js';
import { recordCardPlay } from './stats.js';
import {
  isMultiplayerMatchActive,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
} from '../../multiplayer/runtime.js';
import { cardToEventPayload } from './flow.js';

const AI_PENDING_DELAY = 1000;

function registerPendingTimer(pending, timer) {
  if (!pending) return;
  if (!pending.autoTimers) {
    pending.autoTimers = [];
  }
  pending.autoTimers.push(timer);
}

function clearPendingTimers(pending) {
  if (!pending?.autoTimers) return;
  pending.autoTimers.forEach((timer) => clearTimeout(timer));
  pending.autoTimers = [];
}

export function cleanupPending(pending) {
  if (!pending) return;
  clearPendingTimers(pending);
  if (pending.previewTargets) {
    pending.previewTargets = [];
  }
}

export function scheduleAIPendingConfirmation(pending) {
  if (!pending?.isAI) return;
  const timer = setTimeout(() => {
    if (state.game.pendingAction !== pending) return;
    confirmPendingAction(pending);
  }, AI_PENDING_DELAY);
  registerPendingTimer(pending, timer);
}

export function scheduleAIPendingResolution(pending) {
  if (!pending?.isAI) return;
  const game = state.game;
  if (!game || game.pendingAction !== pending) return;
  const requirement = pending.requirements?.[pending.requirementIndex];
  if (!requirement) {
    if (pending.awaitingConfirmation) {
      scheduleAIPendingConfirmation(pending);
    }
    return;
  }

  const effectIndex = requirement.effectIndex;
  let chosenTargets = pending.aiChosenTargets?.[effectIndex];
  if (!chosenTargets || !chosenTargets.length) {
    const autoTargets = autoSelectTargetsForRequirement(requirement, pending.controller, pending.card);
    if (autoTargets.length) {
      if (!pending.aiChosenTargets) {
        pending.aiChosenTargets = {};
      }
      pending.aiChosenTargets[effectIndex] = autoTargets;
      chosenTargets = autoTargets;
    }
  }

  if (!chosenTargets || !chosenTargets.length) {
    const timer = setTimeout(() => {
      if (state.game.pendingAction !== pending) return;
      finalizeCurrentRequirement();
    }, AI_PENDING_DELAY);
    registerPendingTimer(pending, timer);
    return;
  }

  pending.previewTargets = chosenTargets.map((target) => ({ ...target }));
  requestRender();
  const timer = setTimeout(() => {
    if (state.game.pendingAction !== pending) return;
    pending.previewTargets = [];
    chosenTargets.forEach((target) => selectTargetForPending(target));
    const currentReq = pending.requirements?.[pending.requirementIndex];
    const requiredCount = currentReq?.count ?? 1;
    if (currentReq?.allowLess && (pending.selectedTargets?.length ?? 0) < requiredCount) {
      finalizeCurrentRequirement();
    }
  }, AI_PENDING_DELAY);
  registerPendingTimer(pending, timer);
}

export function handleTargetSelection(creature, controller) {
  const target = createCreatureTarget(creature, controller);
  selectTargetForPending(target);
}

export function selectTargetForPending(target) {
  const pending = state.game.pendingAction;
  if (!pending) return false;
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return false;
  if (!isTargetValid(target, requirement, pending)) {
    addLog('Invalid target.');
    requestRender();
    return false;
  }
  pending.selectedTargets.push(target);
  // Keep a live preview so both players see an arrow immediately
  pending.previewTargets = pending.selectedTargets.map((t) => ({ ...t }));
  
  // CRITICAL: In multiplayer, broadcast target selection so opponent can see the targeting arrow
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_UPDATED, {
      controller: pending.controller,
      requirementIndex: pending.requirementIndex,
      selectedTargets: pending.selectedTargets,
      chosenTargets: pending.chosenTargets,
    });
  }
  
  const isComplete = pending.selectedTargets.length >= (requirement.count ?? 1);
  if (isComplete) {
    finalizeCurrentRequirement();
  } else {
    requestRender();
  }
  return true;
}

export function handlePlayerTargetSelection(playerIndex) {
  const target = createPlayerTarget(playerIndex);
  selectTargetForPending(target);
}

export function finalizeCurrentRequirement() {
  const game = state.game;
  const pending = game.pendingAction;
  if (!pending) return;
  const requirement = pending.requirements[pending.requirementIndex];
  const requiredCount = requirement?.count ?? 1;
  if (!requirement) return;
  const noValidTargets = getValidTargetsForRequirement(requirement, pending.controller, pending.card).length === 0;
  if (!noValidTargets && !requirement.allowLess && pending.selectedTargets.length < requiredCount) {
    return;
  }
  pending.chosenTargets[requirement.effectIndex] = pending.selectedTargets.map((target) => ({ ...target }));
  pending.selectedTargets = [];
  pending.requirementIndex += 1;
  
  const isComplete = pending.requirementIndex >= pending.requirements.length;
  if (isComplete) {
    pending.awaitingConfirmation = true;
  }
  
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_UPDATED, {
      controller: pending.controller,
      requirementIndex: pending.requirementIndex,
      chosenTargets: pending.chosenTargets,
      selectedTargets: [], // Clear on both sides
      awaitingConfirmation: isComplete ? true : undefined,
    });
  }
  
  if (isComplete) {
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

export function confirmPendingAction(pendingOverride) {
  const game = state.game;
  if (!game) return;
  const pending = pendingOverride ?? game.pendingAction;
  if (!pending || game.pendingAction !== pending) return;
  if (pending.requirements?.length && !pending.awaitingConfirmation) {
    return;
  }
  pending.awaitingConfirmation = false;
  if (pending.type === 'spell') {
    executeSpell(pending);
  } else if (pending.type === 'trigger') {
    resolveTriggeredPending(pending);
  } else if (pending.type === 'summon') {
    resolvePendingSummon(pending);
  } else if (pending.type === 'ability') {
    executeAbility(pending);
  }
}

export function cancelPendingAction() {
  const game = state.game;
  if (!game.pendingAction) return;
  if (game.pendingAction.cancellable === false) {
    return;
  }
  const { pendingAction } = game;
  const wasTrigger = pendingAction.type === 'trigger';
  const wasOptionalTrigger = wasTrigger && pendingAction.optional;
  
  // Restore card to hand
  if (pendingAction.type === 'summon' && pendingAction.card) {
    const player = game.players[pendingAction.controller];
    player.hand.push(pendingAction.card);
    sortHand(player);
    const cost = pendingAction.card.cost ?? 0;
    player.availableMana = Math.min(player.maxMana, player.availableMana + cost);
  }
  if (pendingAction.type === 'spell' && pendingAction.card && pendingAction.removedFromHand) {
    const player = game.players[pendingAction.controller];
    player.hand.push(pendingAction.card);
    sortHand(player);
  }
  
  // Cleanup and clear
  cleanupPending(pendingAction);
  game.pendingAction = null;
  
  // Log the cancellation
  if (pendingAction.type === 'spell') {
    addLog([cardSegment(pendingAction.card), textSegment(' cancelled.')], undefined, 'spell');
  } else if (wasTrigger && pendingAction.card) {
    if (wasOptionalTrigger) {
      addLog([cardSegment(pendingAction.card), textSegment(' ability skipped.')]);
    } else {
      addLog([cardSegment(pendingAction.card), textSegment(' action cancelled.')]);
    }
  } else if (pendingAction.card) {
    addLog([cardSegment(pendingAction.card), textSegment(' action cancelled.')]);
  } else {
    addLog([textSegment('Action cancelled.')]);
  }
  
  // Sync to multiplayer AFTER doing it locally
  if (isMultiplayerMatchActive()) {
    const cardPayload = pendingAction.card ? {
      id: pendingAction.card.id,
      instanceId: pendingAction.card.instanceId,
      name: pendingAction.card.name,
      type: pendingAction.card.type,
      color: pendingAction.card.color,
      cost: pendingAction.card.cost,
    } : null;
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_CANCELLED, {
      controller: pendingAction.controller,
      kind: pendingAction.type,
      card: cardPayload,
    });
  }
  
  requestRender();
  if (wasTrigger) {
    checkForWinner();
    continueAIIfNeeded();
    notifyTriggerResolved();
  }
}

export function isTargetableCreature(creature, controller, pending) {
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return false;
  return isTargetValid(createCreatureTarget(creature, controller), requirement, pending);
}

export function isTargetablePlayer(playerIndex, pending) {
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return false;
  const target = createPlayerTarget(playerIndex);
  return isTargetValid(target, requirement, pending);
}

function resolveTriggeredPending(pending) {
  const game = state.game;
  
  // CRITICAL: In multiplayer, emit event instead of executing locally
  if (isMultiplayerMatchActive()) {
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_RESOLVED, {
      controller: pending.controller,
      kind: 'trigger',
      card: pending.card ? cardToEventPayload(pending.card) : null,
      chosenTargets: pending.chosenTargets,
      effects: pending.effects,
    });
  } else {
    // Single player: execute immediately
    resolveEffects(pending.effects, pending);
  }
  
  if (game.pendingAction === pending) {
    cleanupPending(pending);
    game.pendingAction = null;
  }
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
  
  // CRITICAL: In multiplayer, don't call notifyTriggerResolved here
  // It will be called when the PENDING_RESOLVED event is processed
  if (!isMultiplayerMatchActive()) {
    notifyTriggerResolved();
  }
}

function executeSpell(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  
  // CRITICAL: In multiplayer, don't execute effects locally - let the event replay handle it
  // In single player, execute immediately
  if (!isMultiplayerMatchActive()) {
    removeFromHand(player, pending.card.instanceId);
    spendMana(player, pending.card.cost ?? 0);

    const buildTargetSegments = () => {
      if (!pending?.chosenTargets) return [];
      const effectIndexes = Object.keys(pending.chosenTargets)
        .map((k) => Number.parseInt(k, 10))
        .sort((a, b) => a - b);
      for (const idx of effectIndexes) {
        const targets = pending.chosenTargets[idx] || [];
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
        return parts;
      }
      return [];
    };

    const targetSegments = buildTargetSegments();
    addLog(
      [
        playerSegment(player),
        textSegment(' casts '),
        cardSegment(pending.card),
        ...targetSegments,
        textSegment('.'),
      ],
      undefined,
      'spell',
    );
    recordCardPlay(pending.controller, 'spell');
    resolveEffects(pending.effects, pending);
    player.graveyard.push(pending.card);
  } else {
    // In multiplayer, just emit the event - it will be applied via event replay
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_RESOLVED, {
      controller: pending.controller,
      kind: 'spell',
      card: cardToEventPayload(pending.card),
      chosenTargets: pending.chosenTargets,
      effects: pending.effects,
    });
  }
  
  cleanupPending(pending);
  game.pendingAction = null;
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
}

function resolvePendingSummon(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  
  // In multiplayer, don't add to battlefield here - let the PENDING_RESOLVED event handle it
  // In single player, add it immediately
  if (!isMultiplayerMatchActive()) {
    player.battlefield.push(pending.card);
    addLog([
      playerSegment(player),
      textSegment(' summons '),
      cardSegment(pending.card),
      textSegment('.'),
    ], undefined, 'spell');
    recordCardPlay(pending.controller, 'creature');
    resolveEffects(pending.effects, pending);
  } else {
    // In multiplayer, create the event and it will be applied via event replay
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_RESOLVED, {
      controller: pending.controller,
      kind: 'summon',
      card: cardToEventPayload(pending.card),
      chosenTargets: pending.chosenTargets,
      effects: pending.effects,
    });
  }
  
  cleanupPending(pending);
  game.pendingAction = null;
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
}

function executeAbility(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  const creature = pending.card;

  if (creature.summoningSickness) {
    addLog([
      cardSegment(creature),
      textSegment(' has summoning sickness and cannot use its ability yet.'),
    ]);
    cleanupPending(pending);
    game.pendingAction = null;
    requestRender();
    continueAIIfNeeded();
    return;
  }

  if (creature.frozenTurns > 0) {
    addLog([
      cardSegment(creature),
      textSegment(' is frozen and cannot use its ability.'),
    ]);
    cleanupPending(pending);
    game.pendingAction = null;
    requestRender();
    continueAIIfNeeded();
    return;
  }

  // CRITICAL: In multiplayer, don't execute locally - let the event replay handle it
  // In single player, execute immediately
  if (!isMultiplayerMatchActive()) {
    spendMana(player, creature.activated.cost ?? 0);
    creature.activatedThisTurn = true;

    const targetSegments = [];
    if (pending?.chosenTargets) {
      const effectIndexes = Object.keys(pending.chosenTargets)
        .map((k) => Number.parseInt(k, 10))
        .sort((a, b) => a - b);
      for (const idx of effectIndexes) {
        const targets = pending.chosenTargets[idx] || [];
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

    addLog([
      playerSegment(player),
      textSegment(' activates '),
      cardSegment(creature),
      textSegment(`'s ${creature.activated.name || 'ability'}`),
      ...targetSegments,
      textSegment('.'),
    ]);

    resolveEffects(pending.effects, pending);
  } else {
    // In multiplayer, just emit the event - it will be applied via event replay
    enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.PENDING_RESOLVED, {
      controller: pending.controller,
      kind: 'ability',
      card: cardToEventPayload(creature),
      chosenTargets: pending.chosenTargets,
      effects: pending.effects,
    });
  }
  
  cleanupPending(pending);
  game.pendingAction = null;
  requestRender();
  continueAIIfNeeded();
}

