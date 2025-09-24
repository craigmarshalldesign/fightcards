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
const AI_DELAY_MS = 1000; // unified delay between AI actions/stages
let aiPending = false; // prevents overlapping decisions while a delayed action is queued

function scheduleAI(action) {
  if (aiActionTimer) {
    clearTimeout(aiActionTimer);
  }
  aiPending = true;
  aiActionTimer = setTimeout(() => {
    aiActionTimer = null;
    try {
      action();
    } finally {
      aiPending = false;
    }
  }, AI_DELAY_MS);
}

export function registerAIHelpers(api) {
  helpers = { ...helpers, ...api };
}

export function runAI() {
  const game = state.game;
  if (!game || game.currentPlayer !== 1 || game.winner != null) return;
  if (game.blocking?.awaitingDefender && game.currentPlayer === 1) return;
  if (aiActionTimer || aiPending) {
    clearTimeout(aiActionTimer);
    // If something was pending, keep the latest pacing only
  }
  aiActionTimer = setTimeout(() => {
    aiActionTimer = null;
    if (!aiPending) {
      processAI();
    }
  }, AI_DELAY_MS);
}

function processAI() {
  const game = state.game;
  if (!game || game.currentPlayer !== 1 || game.winner != null) return;
  if (game.blocking?.awaitingDefender) return;
  if (aiPending) return;
  const aiPlayer = game.players[1];
  if (game.phase === 'main1' || game.phase === 'main2') {
    const scheduled = aiPlayTurnStep(aiPlayer);
    if (!scheduled) {
      // No play scheduled; advance phase after a delay
      scheduleAI(() => {
        helpers.advancePhase();
        runAI();
      });
    }
    return;
  }
  if (game.phase === 'combat') {
    if (!game.combat || game.combat.stage === 'choose') {
      // Declare attackers after a delay so the player can anticipate
      scheduleAI(() => {
        aiDeclareAttacks();
      });
      return;
    }
  }
}

function aiPlayTurnStep(aiPlayer) {
  const game = state.game;
  const playableCards = aiPlayer.hand.filter((card) => helpers.canPlayCard(card, 1, game));
  for (const card of playableCards) {
    if (card.type === 'creature') {
      scheduleAI(() => {
        helpers.playCreature(1, card);
        requestRender();
        runAI();
      });
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
    // Schedule the casting after a delay, then continue
    scheduleAI(() => {
      helpers.removeFromHand(aiPlayer, card.instanceId);
      helpers.spendMana(aiPlayer, card.cost ?? 0);
      addLog([playerSegment(aiPlayer), textSegment(' casts '), cardSegment(card), textSegment('.')], undefined, 'spell');
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
      requestRender();
      runAI();
    });
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
    // Allow a beat before skipping combat to make the flow readable
    requestRender();
    scheduleAI(() => {
      skipCombat();
      runAI();
    });
    return;
  }
  // Declare after a delay (this function itself is usually called via scheduleAI, but be robust)
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
  const blockers = game.players[0].battlefield.filter((c) => c.type === 'creature');
  if (blockers.length === 0) {
    addLog([playerSegment(game.players[0]), textSegment(' has no blockers.')]);
    // Show attack indicators for a moment, then resolve combat
    requestRender();
    scheduleAI(() => {
      resolveCombat();
      runAI();
    });
    return;
  }
  game.blocking.awaitingDefender = true;
  requestRender();
}
