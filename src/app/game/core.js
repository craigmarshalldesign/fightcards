import { buildDeck, COLORS } from '../../game/cards/index.js';
import { state, requestRender } from '../state.js';
import { addLog } from './log.js';
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
      addLog(`${player.name} cannot draw more cards.`);
      break;
    }
    const card = player.deck.pop();
    player.hand.push(card);
  }
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
  card.baseAttack = card.baseAttack ?? card.attack ?? 0;
  card.baseToughness = card.baseToughness ?? card.toughness ?? 0;
  card.summoningSickness = !card.abilities?.haste;
  card.damageMarked = 0;
  card.buffs = [];
  player.battlefield.push(card);
  addLog(`${player.name} summons ${card.name}.`);
  handlePassive(card, playerIndex, 'onEnter');
}

export function prepareSpell(playerIndex, card) {
  const game = state.game;
  const player = game.players[playerIndex];
  const requirements = computeRequirements(card);
  game.pendingAction = {
    type: 'spell',
    controller: playerIndex,
    card,
    effects: card.effects || [],
    requirements,
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
    cancellable: true,
  };
  addLog(`${player.name} prepares ${card.name}.`);
  if (requirements.length === 0) {
    executeSpell(game.pendingAction);
  } else {
    requestRender();
  }
}

function buildEffectRequirements(effects = []) {
  const reqs = [];
  effects.forEach((effect, idx) => {
    const requirementBase = { effectIndex: idx, effect };
    switch (effect.type) {
      case 'damage': {
        if (['enemy-creature', 'friendly-creature', 'any', 'any-creature', 'creature'].includes(effect.target)) {
          reqs.push({ ...requirementBase, count: 1, target: effect.target === 'creature' ? 'creature' : effect.target });
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
  const pending = state.game.pendingAction;
  if (!pending) return;
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return;
  if (!isTargetValid(creature, controller, requirement, pending)) {
    addLog('Invalid target.');
    requestRender();
    return;
  }
  pending.selectedTargets.push({ creature, controller });
  if (pending.selectedTargets.length >= requirement.count) {
    finalizeCurrentRequirement();
  } else {
    requestRender();
  }
}

export function finalizeCurrentRequirement() {
  const game = state.game;
  const pending = game.pendingAction;
  if (!pending) return;
  const requirement = pending.requirements[pending.requirementIndex];
  pending.chosenTargets[requirement.effectIndex] = [...pending.selectedTargets];
  pending.selectedTargets = [];
  pending.requirementIndex += 1;
  if (pending.requirementIndex >= pending.requirements.length) {
    if (pending.type === 'trigger') {
      resolveTriggeredPending(pending);
    } else {
      executeSpell(pending);
    }
  } else {
    requestRender();
  }
}

export function cancelPendingAction() {
  const game = state.game;
  if (!game.pendingAction) return;
  if (game.pendingAction.cancellable === false) {
    return;
  }
  const cancelled = game.pendingAction.type === 'spell' ? `${game.pendingAction.card.name}` : 'action';
  game.pendingAction = null;
  addLog(`${cancelled} cancelled.`);
  requestRender();
}

export function executeSpell(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  removeFromHand(player, pending.card.instanceId);
  spendMana(player, pending.card.cost ?? 0);
  addLog(`${player.name} casts ${pending.card.name}.`);
  resolveEffects(pending.effects, pending);
  player.graveyard.push(pending.card);
  game.pendingAction = null;
  requestRender();
  checkForWinner();
  if (game.currentPlayer === 1) {
    runAI();
  }
}

export function resolveEffects(effects, pending) {
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
          dealDamageToCreature(target.creature, target.controller, effect.amount);
        });
      }
      break;
    }
    case 'draw': {
      drawCards(controller, effect.amount);
      addLog(`${controller.name} draws ${effect.amount} card(s).`);
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
      addLog(`${controller.name} creates ${token.name}.`);
      break;
    }
    case 'createMultipleTokens': {
      for (let i = 0; i < effect.count; i += 1) {
        const token = instantiateToken(effect.token, controller.color);
        controller.battlefield.push(token);
        addLog(`${controller.name} creates ${token.name}.`);
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
        addLog('All attackers returned to hand.');
      }
      break;
    }
    case 'freeze': {
      targets.forEach((target) => freezeCreature(target.creature));
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
      addLog(`${controller.name} gains ${effect.amount} life.`);
      break;
    }
    case 'preventCombatDamage': {
      game.preventCombatDamageFor = controllerIndex;
      addLog(`${controller.name} prevents combat damage this turn.`);
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
        addLog(`${controller.name} returns ${revived.name} to hand.`);
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

function isTargetValid(creature, controller, requirement, pending) {
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
  return isTargetValid(creature, controller, requirement, pending);
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
      return 'Select a creature.';
    default:
      return 'Choose targets.';
  }
}

function resolveTriggeredPending(pending) {
  const game = state.game;
  resolveEffects(pending.effects, pending);
  if (game.pendingAction === pending) {
    game.pendingAction = null;
  }
  requestRender();
  checkForWinner();
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
      .map((creature) => ({ creature, controller: ownerIndex }));

  switch (requirement.target) {
    case 'friendly-creature':
      return selectCreatures(controller.battlefield, controllerIndex, desired);
    case 'enemy-creature':
      return selectCreatures(opponent.battlefield, opponentIndex, desired);
    case 'any-creature':
    case 'creature':
    case 'any': {
      const preferFriendly = FRIENDLY_EFFECT_TYPES.has(requirement.effect?.type);
      let friendly = [];
      if (preferFriendly) {
        friendly = selectCreatures(controller.battlefield, controllerIndex, desired);
        if (friendly.length >= desired) {
          return friendly;
        }
      }
      const enemy = selectCreatures(opponent.battlefield, opponentIndex, desired);
      if (enemy.length >= desired) {
        return enemy;
      }
      if (!preferFriendly) {
        return enemy.length ? enemy : [];
      }
      return friendly.length ? friendly : enemy;
    }
    default:
      return [];
  }
}

export function handlePassive(card, controllerIndex, trigger) {
  if (!card.passive || card.passive.type !== trigger) return;
  const effect = card.passive.effect;
  if (!effect) return;
  const description = card.passive.description;
  const opponentIndex = controllerIndex === 0 ? 1 : 0;

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
  };

  if (effect.type === 'damage' && effect.target === 'any') {
    if (description) {
      addLog(`${card.name} triggers: ${description}`);
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
    continueAIIfNeeded();
    return;
  }

  if (description) {
    addLog(`${card.name} triggers: ${description}`);
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

        pending.chosenTargets[requirement.effectIndex] = autoTargets.slice(0, requiredCount);
      });

      if (needsSelection) {
        state.game.pendingAction = pending;
        requestRender();
        return;
      }
    }
  }

  resolveTriggeredPending(pending);
}

export function activateCreatureAbility(creatureId) {
  const game = state.game;
  const creature = game.players[0].battlefield.find((c) => c.instanceId === creatureId);
  if (!creature || !creature.activated || creature.activatedThisTurn) return;
  if (game.players[0].availableMana < creature.activated.cost) return;
  spendMana(game.players[0], creature.activated.cost);
  creature.activatedThisTurn = true;
  const effect = creature.activated.effect;
  const pending = { controller: 0, card: creature, requirements: [], requirementIndex: 0, selectedTargets: [], chosenTargets: {} };
  if (effect.type === 'selfBuff') {
    applyPermanentBuff(creature, effect.attack, effect.toughness);
    requestRender();
    return;
  }
  if (effect.type === 'temporaryBuff' || effect.type === 'buff') {
    const target = game.players[0].battlefield.find((c) => c.type === 'creature');
    if (target) {
      pending.chosenTargets[0] = [{ creature: target, controller: 0 }];
    }
  }
  resolveEffects([effect], pending);
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
      creature.summoningSickness = true;
    } else {
      creature.summoningSickness = false;
    }
    creature.activatedThisTurn = false;
    if (creature.temporaryHaste) {
      creature.temporaryHaste = false;
    }
    if (creature.buffs) {
      creature.buffs = creature.buffs.filter((buff) => buff.duration !== 'endOfTurn');
    }
    creature.damageMarked = 0;
  });
  addLog(`${player.name} starts their turn with ${player.availableMana} mana.`);
  game.phase = 'main1';
  game.preventCombatDamageFor = null;
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
  state.ui.logExpanded = false;
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
