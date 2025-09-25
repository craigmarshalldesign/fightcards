import { buildDeck, COLORS } from '../../../game/cards/index.js';
import { addLog, cardSegment, playerSegment, textSegment } from '../log.js';
import { state, requestRender } from '../../state.js';
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

function skipCombatWrapper() {
  skipCombatPhase();
  continueAIIfNeeded();
}

function resolveCombatWrapper() {
  resolveCombatPhase();
  continueAIIfNeeded();
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
    requestRender();
    if (player.isAI) {
      scheduleAIPendingResolution(pending);
    }
    return;
  }

  player.battlefield.push(card);
  logSummon(player, card);
  handlePassive(card, playerIndex, 'onEnter');
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

      requirements.forEach((requirement) => {
        const validTargets = getValidTargetsForRequirement(requirement, controllerIndex, card);
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
  const creature = game.players[0].battlefield.find((c) => c.instanceId === creatureId);
  if (game.pendingAction) return;
  if (!creature || !creature.activated || creature.activatedThisTurn) return;
  if (game.players[0].availableMana < creature.activated.cost) return;
  const effect = creature.activated.effect;
  const requirements = buildEffectRequirements([effect]);
  const pending = {
    type: 'ability',
    controller: 0,
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
    const player = game.players[0];
    spendMana(player, creature.activated.cost ?? 0);
    creature.activatedThisTurn = true;
    addLog([
      playerSegment(player),
      textSegment(' activates '),
      cardSegment(creature),
      textSegment(`'s ${creature.activated.name || 'ability'}.`),
    ]);
    resolveEffects([effect], {
      controller: 0,
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
    const valid = getValidTargetsForRequirement(req, 0, creature);
    const requiredCount = req.count ?? 1;
    if (valid.length === 0) {
      pending.chosenTargets[req.effectIndex] = [];
      return;
    }
    if (req.allowLess) {
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

  game.players.forEach((p) => {
    p.battlefield.forEach((creature) => {
      if (creature.frozenTurns) {
        creature.frozenTurns = Math.max(0, creature.frozenTurns - 1);
      }
    });
  });

  player.maxMana += 1;
  player.availableMana = player.maxMana;
  drawCards(player, 2);
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
    requestRender();
  } else if (game.phase === 'combat') {
    skipCombatWrapper();
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
  };
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
};
