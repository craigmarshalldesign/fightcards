import { state, requestRender } from '../state.js';
import { addLog, cardSegment, playerSegment, textSegment } from './log.js';
import { resolveCombat, skipCombat, triggerAttackPassive } from './combat.js';
import { getCreatureStats } from './creatures.js';

let helpers = {
  advancePhase: () => {},
  playCreature: () => {},
  prepareSpell: () => {},
  computeRequirements: () => [],
  removeFromHand: () => {},
  spendMana: () => {},
  resolveEffects: () => {},
  drawCards: () => {},
  addLog: () => {},
  canPlayCard: () => false,
};

let aiActionTimer = null;

export function registerAIHelpers(api) {
  helpers = { ...helpers, ...api };
}

export function runAI() {
  const game = state.game;
  if (!game || game.currentPlayer !== 1 || game.winner != null) return;
  if (game.blocking?.awaitingDefender && game.currentPlayer === 1) return;
  if (aiActionTimer) {
    clearTimeout(aiActionTimer);
  }
  aiActionTimer = setTimeout(() => {
    aiActionTimer = null;
    processAI();
  }, 1000);
}

function processAI() {
  const game = state.game;
  if (!game || game.currentPlayer !== 1 || game.winner != null) return;
  if (game.blocking?.awaitingDefender) return;
  const aiPlayer = game.players[1];
  if (game.phase === 'main1' || game.phase === 'main2') {
    const played = aiPlayTurnStep(aiPlayer);
    if (!played) {
      helpers.advancePhase();
    } else {
      runAI();
    }
    return;
  }
  if (game.phase === 'combat') {
    if (!game.combat || game.combat.stage === 'choose') {
      aiDeclareAttacks();
      if (game.blocking?.awaitingDefender && game.currentPlayer === 1) {
        return;
      }
      if (!game.combat) {
        runAI();
      }
    }
  }
}

function aiPlayTurnStep(aiPlayer) {
  const game = state.game;
  const playableCards = aiPlayer.hand.filter((card) => helpers.canPlayCard(card, 1, game));
  for (const card of playableCards) {
    if (card.type === 'creature') {
      helpers.playCreature(1, card);
      return true;
    }
    const requirements = helpers.computeRequirements(card);
    const chosenTargets = {};
    let requirementsSatisfied = true;
    requirements.forEach((req) => {
      const targets = pickTargetsForAI(req, 1);
      const requiredCount = req.count ?? 1;
      const minimumRequired = req.allowLess ? Math.min(requiredCount, 1) : requiredCount;
      if (targets.length < minimumRequired) {
        requirementsSatisfied = false;
      }
      chosenTargets[req.effectIndex] = targets;
    });
    if (!requirementsSatisfied) {
      continue;
    }
    helpers.removeFromHand(aiPlayer, card.instanceId);
    helpers.spendMana(aiPlayer, card.cost ?? 0);
    addLog([playerSegment(aiPlayer), textSegment(' casts '), cardSegment(card), textSegment('.')]);
    const pending = {
      controller: 1,
      card,
      requirements,
      requirementIndex: requirements.length,
      selectedTargets: [],
      chosenTargets,
    };
    helpers.resolveEffects(card.effects || [], pending);
    aiPlayer.graveyard.push(card);
    return true;
  }
  return false;
}

function pickTargetsForAI(requirement, controllerIndex) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];
  const desired = requirement.count ?? 1;

  const selectCreatures = (creatures, ownerIndex, count) =>
    creatures
      .filter((c) => c.type === 'creature')
      .sort(
        (a, b) =>
          getCreatureStats(b, ownerIndex, game).attack -
          getCreatureStats(a, ownerIndex, game).attack,
      )
      .slice(0, count)
      .map((creature) => ({ creature, controller: ownerIndex }));

  if (requirement.target === 'friendly-creature') {
    return selectCreatures(controller.battlefield, controllerIndex, desired);
  }
  if (requirement.target === 'enemy-creature') {
    return selectCreatures(opponent.battlefield, opponentIndex, desired);
  }
  if (requirement.target === 'any-creature') {
    if (['temporaryBuff', 'buff', 'heal', 'grantHaste', 'multiBuff'].includes(requirement.effect.type)) {
      return selectCreatures(controller.battlefield, controllerIndex, desired);
    }
    const enemySelection = selectCreatures(opponent.battlefield, opponentIndex, desired);
    if (enemySelection.length) {
      return enemySelection;
    }
    return selectCreatures(controller.battlefield, controllerIndex, desired);
  }
  if (requirement.target === 'creature') {
    const enemySelection = selectCreatures(opponent.battlefield, opponentIndex, desired);
    if (enemySelection.length) {
      return enemySelection;
    }
    return selectCreatures(controller.battlefield, controllerIndex, desired);
  }
  if (requirement.target === 'any') {
    const enemySelection = selectCreatures(opponent.battlefield, opponentIndex, desired);
    if (enemySelection.length) {
      return enemySelection;
    }
    return [];
  }
  return [];
}

function aiDeclareAttacks() {
  const game = state.game;
  if (!game.combat) {
    return;
  }
  const attackers = game.players[1].battlefield.filter((c) => c.type === 'creature' && !c.summoningSickness);
  if (attackers.length === 0) {
    addLog('No attackers declared.');
    skipCombat();
    return;
  }
  game.combat.attackers = attackers.map((creature) => ({ creature, controller: 1 }));
  game.combat.stage = 'blockers';
  attackers.forEach((creature) => {
    helpers.addLog([
      playerSegment(game.players[1]),
      textSegment(' sends '),
      cardSegment(creature),
      textSegment(' into battle.'),
    ]);
    triggerAttackPassive(creature, 1);
  });
  game.blocking = {
    attackers: [...game.combat.attackers],
    assignments: {},
    selectedBlocker: null,
    awaitingDefender: false,
  };
  const blockers = game.players[0].battlefield.filter((c) => c.type === 'creature' && !c.summoningSickness);
  if (blockers.length === 0) {
    addLog([playerSegment(game.players[0]), textSegment(' has no blockers.')]);
    resolveCombat();
    return;
  }
  game.blocking.awaitingDefender = true;
  requestRender();
}
