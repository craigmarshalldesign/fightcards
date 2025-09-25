import { buildDeck, COLORS } from '../../game/cards/index.js';
import { state, requestRender } from '../state.js';
import { addLog, cardSegment, damageSegment, healSegment, playerSegment, textSegment } from './log.js';
import {
  addTemporaryBuff,
  applyPermanentBuff,
  bounceCreature,
  bounceStrongestCreatures,
  checkForDeadCreatures,
  dealDamageToCreature,
  dealDamageToPlayer,
  distributeSplashDamage,
  freezeCreature,
  getCreatureStats,
  grantHaste,
  grantShimmer,
  instantiateToken,
  registerWinnerHook,
  removeFromBattlefield,
} from './creatures.js';
import {
  startCombatStage,
  toggleAttacker,
  confirmAttackers,
  skipCombat,
  prepareBlocks,
  assignBlockerToAttacker,
  selectBlocker,
  resolveCombat as resolveCombatPhase,
  describePhase,
  describePhaseDetailed,
  canSelectBlocker,
  isAttackingCreature,
  registerPassiveHandler,
} from './combat.js';
import { registerAIHelpers, runAI } from './ai.js';

function continueAIIfNeeded() {
  if (state.game?.currentPlayer === 1) {
    runAI();
  }
}

function skipCombatPhase() {
  skipCombat();
  continueAIIfNeeded();
}

function resolveCombatWrapper() {
  resolveCombatPhase();
  continueAIIfNeeded();
}

export function createPlayer(name, color, isAI, deck) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color,
    isAI,
    deck: [...deck],
    hand: [],
    battlefield: [],
    graveyard: [],
    life: 15,
    maxMana: 0,
    availableMana: 0,
  };
}

function createCreatureTarget(creature, controller) {
  return { type: 'creature', creature, controller };
}

function createPlayerTarget(controller) {
  const player = state.game?.players?.[controller] || null;
  return { type: 'player', controller, player };
}

function initializeCreature(card) {
  card.baseAttack = card.baseAttack ?? card.attack ?? 0;
  card.baseToughness = card.baseToughness ?? card.toughness ?? 0;
  card.summoningSickness = !card.abilities?.haste;
  card.damageMarked = 0;
  card.buffs = [];
}

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

function cleanupPending(pending) {
  if (!pending) return;
  clearPendingTimers(pending);
  if (pending.previewTargets) {
    pending.previewTargets = [];
  }
}

function resetTriggerSelection(pending) {
  if (!pending) return;
  clearPendingTimers(pending);
  pending.selectedTargets = [];
  pending.requirementIndex = 0;
  pending.awaitingConfirmation = false;
  pending.previewTargets = [];
  const locked = pending.lockedTargets || {};
  pending.chosenTargets = {};
  Object.entries(locked).forEach(([effectIndex, targets]) => {
    pending.chosenTargets[effectIndex] = (targets || []).map((target) => ({ ...target }));
  });
}

function scheduleAIPendingResolution(pending) {
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
    // If the effect allows fewer than the desired number of targets (allowLess),
    // the AI should finalize after selecting what is available instead of waiting
    // to hit the required count.
    const currentReq = pending.requirements?.[pending.requirementIndex];
    const requiredCount = currentReq?.count ?? 1;
    if (currentReq?.allowLess && (pending.selectedTargets?.length ?? 0) < requiredCount) {
      finalizeCurrentRequirement();
    }
  }, AI_PENDING_DELAY);
  registerPendingTimer(pending, timer);
}

function scheduleAIPendingConfirmation(pending) {
  if (!pending?.isAI) return;
  const timer = setTimeout(() => {
    if (state.game.pendingAction !== pending) return;
    confirmPendingAction(pending);
  }, AI_PENDING_DELAY);
  registerPendingTimer(pending, timer);
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

export function drawCards(player, amount) {
  for (let i = 0; i < amount; i += 1) {
    if (!player.deck.length) {
      addLog([playerSegment(player), textSegment(' cannot draw more cards.')]);
      break;
    }
    const card = player.deck.pop();
    player.hand.push(card);
  }
  sortHand(player);
}

export function spendMana(player, amount) {
  player.availableMana = Math.max(0, player.availableMana - amount);
}

export function removeFromHand(player, instanceId) {
  const index = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (index >= 0) {
    player.hand.splice(index, 1);
  }
}

export function sortHand(player) {
  player.hand.sort((a, b) => {
    const costA = a.cost ?? 0;
    const costB = b.cost ?? 0;
    if (costA !== costB) {
      return costA - costB;
    }
    // If costs are equal, sort by name for consistency
    return (a.name || '').localeCompare(b.name || '');
  });
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
  removeFromHand(player, card.instanceId);
  spendMana(player, card.cost ?? 0);
  initializeCreature(card);

  const onEnterEffect = card.passive?.type === 'onEnter' ? card.passive.effect : null;
  const requiresSelection = Boolean(onEnterEffect && effectRequiresChoice(onEnterEffect));

  if (requiresSelection) {
    // Build requirements and mark as confirmable when no valid targets exist
    const rawRequirements = onEnterEffect ? buildEffectRequirements([onEnterEffect]) : [];
    const requirements = rawRequirements.map((req) => {
      const validTargets = getValidTargetsForRequirement(req, playerIndex, card);
      if (validTargets.length === 0) {
        // Allow confirming with 0 selections so the summon can complete
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
      // Let players cancel a summon that requires targeting
      cancellable: true,
      awaitingConfirmation: false,
      isAI: Boolean(player.isAI),
    };
    game.pendingAction = pending;
    addLog([playerSegment(player), textSegment(' prepares to summon '), cardSegment(card), textSegment('.')], undefined, 'spell');
    requestRender();
    if (player.isAI) {
      scheduleAIPendingResolution(pending);
    }
    return;
  }

  player.battlefield.push(card);
  addLog([playerSegment(player), textSegment(' summons '), cardSegment(card), textSegment('.')], undefined, 'spell');
  handlePassive(card, playerIndex, 'onEnter');
}

export function prepareSpell(playerIndex, card, options = {}) {
  const game = state.game;
  const player = game.players[playerIndex];
  // Compute requirements and allow confirmation with zero targets when none are valid
  const baseRequirements = computeRequirements(card);
  const requirements = baseRequirements.map((req) => {
    const validTargets = getValidTargetsForRequirement(req, playerIndex, card);
    if (validTargets.length === 0) {
      return { ...req, allowLess: true, noValidTargets: true };
    }
    return req;
  });
  // Visually move the card out of the hand while pending
  removeFromHand(player, card.instanceId);
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
  game.pendingAction = pending;
  addLog([playerSegment(player), textSegment(' prepares '), cardSegment(card), textSegment('.')], undefined, 'spell');
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

function buildEffectRequirements(effects = []) {
  const reqs = [];
  effects.forEach((effect, idx) => {
    const requirementBase = { effectIndex: idx, effect };
    switch (effect.type) {
      case 'damage': {
        if (['enemy-creature', 'friendly-creature', 'any', 'any-creature', 'creature'].includes(effect.target)) {
          const requirement = {
            ...requirementBase,
            count: 1,
            target: effect.target === 'creature' ? 'creature' : effect.target,
          };
          if (effect.target === 'any') {
            requirement.allowPlayers = true;
          }
          reqs.push(requirement);
        }
        break;
      }
      case 'buff': {
        if (effect.target === 'friendly-creature' || effect.target === 'any-creature') {
          reqs.push({ ...requirementBase, count: 1, target: effect.target });
        }
        break;
      }
      case 'temporaryBuff': {
        if (effect.target === 'friendly-creature' || effect.target === 'any-creature') {
          reqs.push({ ...requirementBase, count: 1, target: effect.target });
        }
        break;
      }
      case 'grantShimmer': {
        if (effect.target === 'friendly-creature' || effect.target === 'any-creature') {
          reqs.push({ ...requirementBase, count: 1, target: effect.target });
        }
        break;
      }
      case 'grantHaste': {
        if (effect.target === 'two-friendly') {
          reqs.push({ ...requirementBase, count: 2, target: 'friendly-creature', allowLess: true });
        }
        break;
      }
      case 'multiBuff': {
        reqs.push({ ...requirementBase, count: effect.count, target: 'friendly-creature', allowLess: true });
        break;
      }
      case 'heal': {
        reqs.push({ ...requirementBase, count: 1, target: 'friendly-creature' });
        break;
      }
      case 'freeze': {
        if (effect.target === 'enemy-creature') {
          reqs.push({ ...requirementBase, count: 1, target: 'enemy-creature' });
        }
        break;
      }
      case 'bounce': {
        if (['creature', 'friendly-creature', 'enemy-creature', 'any-creature'].includes(effect.target)) {
          const target = effect.target === 'creature' ? 'creature' : effect.target;
          reqs.push({ ...requirementBase, count: 1, target });
        }
        break;
      }
      default:
        break;
    }
  });
  return reqs;
}

export function computeRequirements(card) {
  if (!card.effects) return [];
  return buildEffectRequirements(card.effects);
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
  // If there are no valid targets for this requirement, allow finalizing with 0
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
    if (game.pendingAction.type === 'trigger') {
      resetTriggerSelection(game.pendingAction);
      requestRender();
    }
    return;
  }
  const { pendingAction } = game;
  // Refund resources for cancellable actions
  if (pendingAction.type === 'summon' && pendingAction.card) {
    const player = game.players[pendingAction.controller];
    // Return card to hand and refund mana
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

export function executeSpell(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  removeFromHand(player, pending.card.instanceId);
  spendMana(player, pending.card.cost ?? 0);
  // Build a readable target list for the log if any targets were chosen
  const buildTargetSegments = () => {
    if (!pending?.chosenTargets) return [];
    const effectIndexes = Object.keys(pending.chosenTargets).map((k) => Number.parseInt(k, 10)).sort((a, b) => a - b);
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
  if (game.currentPlayer === 1) {
    runAI();
  }
}

function resolvePendingSummon(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  player.battlefield.push(pending.card);
  addLog([playerSegment(player), textSegment(' summons '), cardSegment(pending.card), textSegment('.')], undefined, 'spell');
  resolveEffects(pending.effects, pending);
  cleanupPending(pending);
  game.pendingAction = null;
  requestRender();
  checkForWinner();
  continueAIIfNeeded();
}

export function executeAbility(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  const creature = pending.card;
  
  // Now spend the mana and mark ability as used
  spendMana(player, creature.activated.cost ?? 0);
  creature.activatedThisTurn = true;
  
  // Build log message for ability activation
  const targetSegments = [];
  if (pending?.chosenTargets) {
    const effectIndexes = Object.keys(pending.chosenTargets).map((k) => Number.parseInt(k, 10)).sort((a, b) => a - b);
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
      break; // Only show first effect's targets for simplicity
    }
  }
  
  addLog([playerSegment(player), textSegment(' activates '), cardSegment(creature), textSegment(`'s ${creature.activated.name || 'ability'}`), ...targetSegments, textSegment('.')]);
  
  // Clear timers and resolve effects
  cleanupPending(pending);
  resolveEffects(pending.effects, pending);
  game.pendingAction = null;
  checkForDeadCreatures();
  requestRender();
  continueAIIfNeeded();
}

export function resolveEffects(effects, pending) {
  // Always resolve effects in order. Each effect uses only its own chosen targets;
  // if a targeted effect has no valid targets, it simply does nothing while
  // other effects (like draw) still resolve.
  effects.forEach((effect, idx) => {
    const targets = pending.chosenTargets[idx] || [];
    applyEffect(effect, pending.controller, targets, pending.card);
  });
}

function applyEffect(effect, controllerIndex, targets, sourceCard) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];
  switch (effect.type) {
    case 'damage': {
      if (effect.target === 'opponent') {
        dealDamageToPlayer(opponentIndex, effect.amount);
      } else if (effect.target === 'player') {
        dealDamageToPlayer(controllerIndex, effect.amount);
      } else if (targets.length) {
        targets.forEach((target) => {
          if (target.type === 'player') {
            dealDamageToPlayer(target.controller, effect.amount);
          } else if (target.creature) {
            dealDamageToCreature(target.creature, target.controller, effect.amount);
          }
        });
      }
      break;
    }
    case 'draw': {
      drawCards(controller, effect.amount);
      addLog([playerSegment(controller), textSegment(` draws ${effect.amount} card(s).`)]);
      break;
    }
    case 'damageAllEnemies': {
      dealDamageToPlayer(opponentIndex, effect.amount);
      opponent.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => dealDamageToCreature(creature, opponentIndex, effect.amount));
      break;
    }
    case 'damageAllCreatures': {
      if (effect.target === 'enemy') {
        opponent.battlefield
          .filter((c) => c.type === 'creature')
          .forEach((creature) => dealDamageToCreature(creature, opponentIndex, effect.amount));
      }
      break;
    }
    case 'temporaryBuff': {
      targets.forEach((target) => addTemporaryBuff(target.creature, effect.attack, effect.toughness));
      break;
    }
    case 'buff': {
      targets.forEach((target) => applyPermanentBuff(target.creature, effect.attack, effect.toughness));
      if (!targets.length && effect.type === 'buff' && effect.excludeSelf) {
        const allies = controller.battlefield.filter((c) => c.type === 'creature' && c.instanceId !== sourceCard.instanceId);
        if (allies.length) {
          applyPermanentBuff(allies[0], effect.attack, effect.toughness);
        }
      }
      break;
    }
    case 'grantHaste': {
      targets.forEach((target) => grantHaste(target.creature, effect.duration));
      break;
    }
    case 'grantShimmer': {
      targets.forEach((target) => grantShimmer(target.creature, effect.duration));
      break;
    }
    case 'globalBuff': {
      controller.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => {
          if (effect.scope === 'other-friendly' && sourceCard && creature.instanceId === sourceCard.instanceId) {
            return;
          }
          applyPermanentBuff(creature, effect.attack, effect.toughness);
        });
      break;
    }
    case 'createToken': {
      const token = instantiateToken(effect.token, controller.color);
      controller.battlefield.push(token);
      addLog([playerSegment(controller), textSegment(' creates '), cardSegment(token), textSegment('.')]);
      break;
    }
    case 'createMultipleTokens': {
      for (let i = 0; i < effect.count; i += 1) {
        const token = instantiateToken(effect.token, controller.color);
        controller.battlefield.push(token);
        addLog([playerSegment(controller), textSegment(' creates '), cardSegment(token), textSegment('.')]);
      }
      break;
    }
    case 'bounce': {
      if (targets.length) {
        targets.forEach((target) => bounceCreature(target.creature, target.controller));
      }
      break;
    }
    case 'massBounce': {
      bounceStrongestCreatures(opponentIndex, effect.amount);
      break;
    }
    case 'bounceAttackers': {
      if (game.combat?.attackers) {
        game.combat.attackers.forEach((attacker) => bounceCreature(attacker.creature, attacker.controller));
        game.combat = null;
        game.blocking = null;
        addLog([textSegment('All attackers returned to hand.')]);
      }
      break;
    }
    case 'freeze': {
      targets.forEach((target) => freezeCreature(target.creature));
      break;
    }
    case 'preventDamageToAttackers': {
      game.preventDamageToAttackersFor = controllerIndex;
      addLog([playerSegment(controller), textSegment(' protects attacking creatures this turn.')]);
      break;
    }
    case 'damageAttackers': {
      if (game.combat?.attackers) {
        game.combat.attackers.forEach((attacker) => {
          dealDamageToCreature(attacker.creature, attacker.controller, effect.amount);
        });
      }
      break;
    }
    case 'heal': {
      targets.forEach((target) => {
        target.creature.damageMarked = 0;
      });
      break;
    }
    case 'gainLife': {
      controller.life += effect.amount;
      addLog([playerSegment(controller), textSegment(' gains '), healSegment(effect.amount), textSegment(' life.')]);
      break;
    }
    case 'preventCombatDamage': {
      game.preventCombatDamageFor = controllerIndex;
      addLog([playerSegment(controller), textSegment(' prevents combat damage this turn.')]);
      break;
    }
    case 'teamBuff': {
      controller.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => applyPermanentBuff(creature, effect.attack, effect.toughness));
      break;
    }
    case 'multiBuff': {
      targets.forEach((target) => applyPermanentBuff(target.creature, effect.attack, effect.toughness));
      break;
    }
    case 'revive': {
      if (controller.graveyard.length) {
        const revived = controller.graveyard.pop();
        controller.hand.push(revived);
        sortHand(controller);
        addLog([playerSegment(controller), textSegment(' returns '), cardSegment(revived), textSegment(' to hand.')]);
      }
      break;
    }
    case 'splashDamage': {
      distributeSplashDamage(opponentIndex, effect.amount);
      break;
    }
    case 'selfBuff': {
      if (sourceCard) {
        applyPermanentBuff(sourceCard, effect.attack, effect.toughness);
      }
      break;
    }
    default:
      break;
  }
  checkForDeadCreatures();
}

function isTargetValid(target, requirement, pending) {
  if (!target) return false;
  if (target.type === 'player') {
    return Boolean(requirement.allowPlayers);
  }
  const { creature, controller } = target;
  if (!creature) return false;
  if (requirement.target === 'friendly-creature') {
    if (requirement.effect?.excludeSelf && pending.card && creature.instanceId === pending.card.instanceId) {
      return false;
    }
    return controller === pending.controller;
  }
  if (requirement.target === 'enemy-creature') {
    return controller !== pending.controller;
  }
  if (requirement.target === 'any-creature' || requirement.target === 'any' || requirement.target === 'creature') {
    if (requirement.effect?.excludeSelf && pending.card && creature.instanceId === pending.card.instanceId) {
      return false;
    }
    return true;
  }
  return false;
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

export function describeRequirement(requirement) {
  switch (requirement.target) {
    case 'friendly-creature':
      return 'Select a friendly creature.';
    case 'enemy-creature':
      return 'Select an enemy creature.';
    case 'any-creature':
    case 'any':
    case 'creature':
      return requirement.allowPlayers ? 'Select a target.' : 'Select a creature.';
    default:
      return 'Choose targets.';
  }
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
  const callback = pending.afterResolve;
  pending.afterResolve = null;
  if (typeof callback === 'function') {
    callback();
  }
  continueAIIfNeeded();
}

const TARGETABLE_EFFECT_TYPES = new Set(['bounce', 'buff', 'temporaryBuff', 'freeze', 'heal', 'grantShimmer', 'damage']);
const FRIENDLY_EFFECT_TYPES = new Set(['buff', 'temporaryBuff', 'heal', 'grantShimmer']);
const TARGETABLE_TARGETS = new Set(['friendly-creature', 'enemy-creature', 'any-creature', 'creature', 'any']);

function effectRequiresChoice(effect) {
  if (!effect) return false;
  if (!TARGETABLE_TARGETS.has(effect.target)) return false;
  if (effect.target === 'any' && effect.type !== 'damage') {
    return false;
  }
  return TARGETABLE_EFFECT_TYPES.has(effect.type);
}

function getValidTargetsForRequirement(requirement, controllerIndex, sourceCard) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];

  const mapCreatures = (cards, ownerIndex) =>
    cards
      .filter((c) => c.type === 'creature')
      .filter((c) => !(requirement.effect?.excludeSelf && sourceCard && c.instanceId === sourceCard.instanceId))
      .map((creature) => ({ creature, controller: ownerIndex }));

  switch (requirement.target) {
    case 'friendly-creature':
      return mapCreatures(controller.battlefield, controllerIndex);
    case 'enemy-creature':
      return mapCreatures(opponent.battlefield, opponentIndex);
    case 'any-creature':
    case 'creature':
    case 'any':
      return [
        ...mapCreatures(controller.battlefield, controllerIndex),
        ...mapCreatures(opponent.battlefield, opponentIndex),
        ...(requirement.allowPlayers
          ? [createPlayerTarget(controllerIndex), createPlayerTarget(opponentIndex)]
          : []),
      ];
    default:
      return [];
  }
}

function autoSelectTargetsForRequirement(requirement, controllerIndex, sourceCard) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];
  const desired = requirement.count ?? 1;

  const selectCreatures = (cards, ownerIndex, count) =>
    cards
      .filter((c) => c.type === 'creature')
      .filter((c) => !(requirement.effect?.excludeSelf && sourceCard && c.instanceId === sourceCard.instanceId))
      .sort(
        (a, b) =>
          getCreatureStats(b, ownerIndex, game).attack - getCreatureStats(a, ownerIndex, game).attack,
      )
      .slice(0, count)
      .map((creature) => createCreatureTarget(creature, ownerIndex));

  switch (requirement.target) {
    case 'friendly-creature':
      return selectCreatures(controller.battlefield, controllerIndex, desired);
    case 'enemy-creature':
      return selectCreatures(opponent.battlefield, opponentIndex, desired);
    case 'any-creature':
    case 'creature':
    case 'any': {
      const preferFriendly = FRIENDLY_EFFECT_TYPES.has(requirement.effect?.type);
      if (preferFriendly) {
        const friendly = selectCreatures(controller.battlefield, controllerIndex, desired);
        if (friendly.length >= desired) {
          return friendly;
        }
        const enemy = selectCreatures(opponent.battlefield, opponentIndex, desired);
        return friendly.concat(enemy).slice(0, desired);
      }
      const enemy = selectCreatures(opponent.battlefield, opponentIndex, desired);
      const friendly = selectCreatures(controller.battlefield, controllerIndex, desired);
      const playerTargets = requirement.allowPlayers
        ? [createPlayerTarget(opponentIndex), createPlayerTarget(controllerIndex)]
        : [];
      const combined = [...enemy, ...playerTargets, ...friendly];
      return combined.slice(0, desired);
    }
    default:
      return [];
  }
}

export function handlePassive(card, controllerIndex, trigger, options = {}) {
  const { afterResolve, context } = options;
  if (!card.passive || card.passive.type !== trigger) {
    afterResolve?.();
    return;
  }
  const effect = card.passive.effect;
  if (!effect) {
    afterResolve?.();
    return;
  }
  const description = card.passive.description;
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const player = state.game.players[controllerIndex];

  const pending = {
    type: 'trigger',
    controller: controllerIndex,
    card,
    effects: [effect],
    requirements: [],
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: false,
    awaitingConfirmation: false,
    isAI: Boolean(player.isAI),
    context: context || null,
    afterResolve: afterResolve || null,
    lockedTargets: {},
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
        resolveTriggeredPending(pending);
        return;
      }
    }
    dealDamageToPlayer(opponentIndex, effect.amount);
    requestRender();
    checkForWinner();
    afterResolve?.();
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
      const player = state.game.players[controllerIndex];
      const isHuman = !player.isAI;
      let needsSelection = false;

      requirements.forEach((requirement) => {
        const validTargets = getValidTargetsForRequirement(requirement, controllerIndex, card);
        if (validTargets.length === 0) {
          pending.chosenTargets[requirement.effectIndex] = [];
          pending.lockedTargets[requirement.effectIndex] = [];
          return;
        }
        const requiredCount = requirement.count ?? 1;
        const autoTargets = autoSelectTargetsForRequirement(requirement, controllerIndex, card);
        const uniqueChoices = validTargets.length > requiredCount;
        const canPlayerChoose =
          requirement.target !== 'any' && isHuman && uniqueChoices && requiredCount > 0;

        if (canPlayerChoose) {
          needsSelection = true;
          return;
        }

        const chosen = autoTargets.slice(0, requiredCount);
        pending.chosenTargets[requirement.effectIndex] = chosen;
        pending.lockedTargets[requirement.effectIndex] = chosen.map((target) => ({ ...target }));
      });

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

  resolveTriggeredPending(pending);
}

export function activateCreatureAbility(creatureId) {
  const game = state.game;
  const creature = game.players[0].battlefield.find((c) => c.instanceId === creatureId);
  // Block when any pending action exists (spell, summon, trigger, or ability)
  if (game.pendingAction) return;
  if (!creature || !creature.activated || creature.activatedThisTurn) return;
  if (game.players[0].availableMana < creature.activated.cost) return;
  // Don't spend mana yet - only spend when confirmed
  const effect = creature.activated.effect;
  // Treat activated abilities like spells with a pending flow so target lines + confirm/cancel work
  const pending = {
    type: 'ability',
    controller: 0,
    card: creature,
    effects: [effect],
    requirements: buildEffectRequirements([effect]),
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: true,
    awaitingConfirmation: false,
    isAI: false,
  };

  // If there are no requirements, immediately resolve like a spell but keep UX consistent
  if (!pending.requirements.length) {
    resolveEffects([effect], { controller: 0, card: creature, requirements: [], requirementIndex: 0, selectedTargets: [], chosenTargets: {} });
    requestRender();
    return;
  }

  // If requirements have auto-targets and require no choice, prefill chosen targets
  pending.requirements.forEach((req) => {
    const valid = getValidTargetsForRequirement(req, 0, creature);
    const requiredCount = req.count ?? 1;
    if (valid.length === 0) {
      pending.chosenTargets[req.effectIndex] = [];
      return;
    }
    const auto = autoSelectTargetsForRequirement(req, 0, creature);
    if (auto.length && auto.length <= requiredCount) {
      pending.chosenTargets[req.effectIndex] = auto.slice(0, requiredCount);
    }
  });

  state.game.pendingAction = pending;
  requestRender();
}

export function beginTurn(playerIndex) {
  const game = state.game;
  const player = game.players[playerIndex];
  player.maxMana += 1;
  player.availableMana = player.maxMana;
  drawCards(player, 2);
  player.battlefield.forEach((creature) => {
    if (creature.frozenTurns) {
      creature.frozenTurns -= 1;
    }
    // Summoning sickness resets at the start of the controller's turn regardless of freeze
    // (frozen status itself prevents attacking/blocking elsewhere)
    creature.summoningSickness = false;
    creature.activatedThisTurn = false;
    if (creature.temporaryHaste) {
      creature.temporaryHaste = false;
    }
    // Note: damage and end-of-turn buffs are now cleared in endTurn(), not here
  });
  addLog([playerSegment(player), textSegment(` starts their turn with ${player.availableMana} mana.`)]);
  game.phase = 'main1';
  game.preventCombatDamageFor = null;
  // Also clear protection to attackers at the start of each turn
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
    requestRender();
  } else if (game.phase === 'combat') {
    skipCombatPhase();
    return;
  } else if (game.phase === 'main2') {
    endTurn();
    return;
  } else {
    game.phase = 'main2';
    requestRender();
  }
  continueAIIfNeeded();
}

export function endTurn() {
  const game = state.game;
  
  // End of turn cleanup - clear damage and end-of-turn effects for all creatures
  game.players.forEach((player) => {
    player.battlefield.forEach((creature) => {
      // Clear damage at end of turn, not beginning of next turn
      creature.damageMarked = 0;
      // Remove end-of-turn buffs
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

export function checkForWinner() {
  const game = state.game;
  if (game.winner != null) return;
  if (game.players[0].life <= 0) {
    game.winner = 1;
    state.screen = 'game-over';
  } else if (game.players[1].life <= 0) {
    game.winner = 0;
    state.screen = 'game-over';
  }
  if (game.winner != null) {
    requestRender();
  }
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
  };
  game.currentPlayer = game.dice.winner;
  state.game = game;
  state.screen = 'game';
  state.ui.battleLogExpanded = false;
  state.ui.spellLogExpanded = false;
  state.ui.previewCard = null;
  addLog(
    `Initiative roll — You: ${game.dice.player}, AI: ${game.dice.ai}. ${game.currentPlayer === 0 ? 'You go first.' : 'AI goes first.'}`,
    game,
  );
  addLog(`AI Opponent will wield the ${COLORS[aiColor].name} deck.`, game);
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

export {
  startCombatStage,
  toggleAttacker,
  confirmAttackers,
  skipCombatPhase as skipCombat,
  prepareBlocks,
  assignBlockerToAttacker,
  selectBlocker,
  resolveCombatWrapper as resolveCombat,
  describePhase,
  describePhaseDetailed,
  canSelectBlocker,
  isAttackingCreature,
};
