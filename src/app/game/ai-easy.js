import { state, requestRender } from '../state.js';
import { addLog, cardSegment, playerSegment, textSegment } from './log.js';
import { skipCombat, startTriggerStage } from './combat/index.js';
import { getCreatureStats, hasShimmer } from './creatures.js';
import { isEligibleAttacker, isBlockerEligible } from './combat/helpers.js';

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
        if (!state.game?.pendingAction) {
          runAI();
        }
      });
      return true;
    }
    const requirements = helpers.computeRequirements(card);
    const chosenTargets = {};
    let requirementsSatisfied = true;
    requirements.forEach((req) => {
      const targets = pickTargetsForAI(req, 1);
      const requiredCount = req.count ?? 1;
      const minimumRequired = req.allowLess ? 0 : requiredCount;
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
      helpers.prepareSpell(1, card, { aiChosenTargets: chosenTargets });
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
      .map((creature) => ({ type: 'creature', creature, controller: ownerIndex }));

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
    const selections = selectCreatures(opponent.battlefield, opponentIndex, desired);
    if (requirement.allowPlayers) {
      selections.push({ type: 'player', controller: opponentIndex });
    }
    if (selections.length < desired) {
      selections.push(...selectCreatures(controller.battlefield, controllerIndex, desired - selections.length));
    }
    if (requirement.allowPlayers && selections.length < desired) {
      selections.push({ type: 'player', controller: controllerIndex });
    }
    return selections.slice(0, Math.max(0, Math.min(desired, selections.length)));
  }
  return [];
}

function aiDeclareAttacks() {
  const game = state.game;
  if (!game.combat) {
    return;
  }
  const attackers = game.players[1].battlefield.filter(isEligibleAttacker);
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
  attackers.forEach((creature) => {
    helpers.addLog([
      playerSegment(game.players[1]),
      textSegment(' sends '),
      cardSegment(creature),
      textSegment(' into battle.'),
    ]);
  });
  startTriggerStage({
    onComplete: () => {
      scheduleAI(() => {
        runAI();
      });
    },
  });
}

// ============================================================================
// EASY AI BLOCKING - ALWAYS BLOCKS WITH ALL AVAILABLE CREATURES
// ============================================================================

export function assignAIBlocks() {
  const game = state.game;
  const aiIndex = 1;
  
  if (!game.blocking) return;
  
  // Get all eligible defenders (non-frozen creatures)
  const defenders = game.players[aiIndex].battlefield.filter(isBlockerEligible);
  
  // Get all attackers, excluding shimmer (unblockable) creatures
  const attackers = game.blocking.attackers.filter(attacker => !hasShimmer(attacker.creature));
  
  if (defenders.length === 0 || attackers.length === 0) {
    // No eligible defenders or no blockable attackers
    return;
  }
  
  // EASY AI STRATEGY: Always block with as many creatures as possible
  // Block the first N attackers where N = min(attackers.length, defenders.length)
  const blocksToMake = Math.min(attackers.length, defenders.length);
  
  for (let i = 0; i < blocksToMake; i++) {
    const attacker = attackers[i];
    const defender = defenders[i];
    
    // Assign this defender to block this attacker
    game.blocking.assignments[attacker.creature.instanceId] = defender;
    
    helpers.addLog([
      cardSegment(defender),
      textSegment(' blocks '),
      cardSegment(attacker.creature),
      textSegment('.'),
    ]);
  }
}