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
  if (pending.selectedTargets.length >= (requirement.count ?? 1)) {
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
  if (pending.requirementIndex >= pending.requirements.length) {
    pending.awaitingConfirmation = true;
    requestRender();
    if (pending.isAI) {
      scheduleAIPendingConfirmation(pending);
    }
  } else {
    requestRender();
    if (pending.isAI) {
      scheduleAIPendingResolution(pending);
    }
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
  cleanupPending(pendingAction);
  game.pendingAction = null;
  if (pendingAction.type === 'spell') {
    addLog([cardSegment(pendingAction.card), textSegment(' cancelled.')], undefined, 'spell');
  } else if (pendingAction.card) {
    addLog([cardSegment(pendingAction.card), textSegment(' action cancelled.')]);
  } else {
    addLog([textSegment('Action cancelled.')]);
  }
  requestRender();
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
  resolveEffects(pending.effects, pending);
  if (game.pendingAction === pending) {
    cleanupPending(pending);
    game.pendingAction = null;
  }
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
}

function executeSpell(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
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
  resolveEffects(pending.effects, pending);
  player.graveyard.push(pending.card);
  cleanupPending(pending);
  game.pendingAction = null;
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
}

function resolvePendingSummon(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  player.battlefield.push(pending.card);
  addLog([
    playerSegment(player),
    textSegment(' summons '),
    cardSegment(pending.card),
    textSegment('.'),
  ], undefined, 'spell');
  resolveEffects(pending.effects, pending);
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

  cleanupPending(pending);
  resolveEffects(pending.effects, pending);
  game.pendingAction = null;
  requestRender();
  continueAIIfNeeded();
}

