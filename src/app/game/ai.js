import { state, requestRender } from '../state.js';
import { addLog, cardSegment, playerSegment, textSegment } from './log.js';
import { skipCombat, startTriggerStage } from './combat/index.js';
import { getCreatureStats, hasShimmer } from './creatures.js';
import { isEligibleAttacker, isBlockerEligible } from './combat/helpers.js';

let helpers = {
  advancePhase: () => {},
  playCreature: () => {},
  prepareSpell: () => {},
  activateCreatureAbility: () => {},
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

// CRITICAL: AI personality/difficulty settings
const AI_SETTINGS = {
  // Bluffing: Chance to make suboptimal plays (0 = perfect, 0.2 = 20% chance of mistakes)
  bluffChance: 0.15,
  
  // Card advantage: How much to value holding cards (higher = more conservative)
  cardValueMultiplier: 1.5,
  
  // Blocking: How risk-averse (0 = never block, 1 = always block optimally)
  blockingAggression: 0.7,
  
  // Planning: How many turns ahead to think
  planningHorizon: 2,
};

// ============================================================================
// DECK ARCHETYPE STRATEGIES - ADD NEW DECKS HERE
// ============================================================================

const DECK_STRATEGIES = {
  red: {
    name: 'Aggressive Burn',
    description: 'Aggressive deck with direct damage - pressure life and finish with burn spells',
    
    // Strategic priorities
    priorities: {
      faceTargeting: 0.8,        // Prioritize dealing damage to opponent (0-1)
      boardControl: 0.4,          // Care about controlling creatures
      cardAdvantage: 0.3,         // Don't care much about card advantage
      creatureQuality: 0.5,       // Individual creature power matters less
    },
    
    // Combat strategy
    combat: {
      attackAggression: 0.9,      // Very aggressive attacks (0-1)
      blockAggression: 0.4,       // Block less, race opponent
      acceptBadTrades: true,      // Willing to lose creatures for damage
      pressureThreshold: 12,      // Start racing when opponent at this life
    },
    
    // Gameplay strategy
    evaluate: (game, aiIndex) => {
      const ai = game.players[aiIndex];
      const opponent = game.players[aiIndex === 0 ? 1 : 0];
      
      // Count burn spells in hand
      const burnSpells = ai.hand.filter(card => 
        card.effects?.some(e => e.type === 'damage' && 
          (e.target === 'opponent' || e.target === 'any' || e.target === 'player'))
      );
      
      const potentialBurnDamage = burnSpells.reduce((total, card) => {
        const dmg = card.effects?.find(e => e.type === 'damage')?.amount || 0;
        return ai.availableMana >= (card.cost || 0) ? total + dmg : total;
      }, 0);
      
      return {
        // If opponent is low and we have burn, go ALL IN
        shouldRace: opponent.life <= 12 || (opponent.life <= 15 && burnSpells.length > 0),
        canFinish: potentialBurnDamage >= opponent.life,
        priority: 'damage-face', // Always prioritize face damage
      };
    },
  },
  
  green: {
    name: 'Ramp & Smash',
    description: 'Build board of big creatures, use life gain to survive, overwhelm late game',
    
    priorities: {
      faceTargeting: 0.3,
      boardControl: 0.8,          // Build strong board
      cardAdvantage: 0.5,
      creatureQuality: 0.9,       // Big creatures are the win condition
    },
    
    combat: {
      attackAggression: 0.6,      // Moderate attacks, prefer to build
      blockAggression: 0.8,       // Block to protect life total
      acceptBadTrades: false,     // Preserve creatures
      pressureThreshold: 10,      // Only race when very ahead
    },
    
    evaluate: (game, aiIndex) => {
      const ai = game.players[aiIndex];
      const opponent = game.players[aiIndex === 0 ? 1 : 0];
      
      // Count big creatures (4+ power)
      const bigCreatures = ai.battlefield.filter(c => {
        const stats = getCreatureStats(c, aiIndex, game);
        return c.type === 'creature' && stats.attack >= 4;
      }).length;
      
      const totalPower = ai.battlefield.reduce((total, c) => {
        if (c.type === 'creature') {
          const stats = getCreatureStats(c, aiIndex, game);
          return total + stats.attack;
        }
        return total;
      }, 0);
      
      const opponentPower = opponent.battlefield.reduce((total, c) => {
        if (c.type === 'creature') {
          const stats = getCreatureStats(c, aiIndex === 0 ? 1 : 0, game);
          return total + stats.attack;
        }
        return total;
      }, 0);
      
      return {
        shouldRace: false, // Green doesn't race, it dominates
        canFinish: totalPower > opponentPower + opponent.life, // Can smash through
        priority: bigCreatures >= 2 ? 'attack-big' : 'build-board',
      };
    },
  },
  
  blue: {
    name: 'Control & Card Advantage',
    description: 'Control board with bounce/freeze, draw cards, win with card advantage',
    
    priorities: {
      faceTargeting: 0.2,
      boardControl: 0.9,          // Control the board
      cardAdvantage: 0.9,         // Card advantage is key
      creatureQuality: 0.4,       // Creatures are less important
    },
    
    combat: {
      attackAggression: 0.5,      // Defensive attacks
      blockAggression: 0.9,       // Block aggressively
      acceptBadTrades: false,     // Never bad trades
      pressureThreshold: 8,       // Only race if far ahead
    },
    
    evaluate: (game, aiIndex) => {
      const ai = game.players[aiIndex];
      const opponent = game.players[aiIndex === 0 ? 1 : 0];
      
      const handSize = ai.hand.length;
      const opponentHandSize = opponent.hand.length;
      const cardAdvantage = handSize - opponentHandSize;
      
      // Count control spells
      const controlSpells = ai.hand.filter(card =>
        card.effects?.some(e => ['bounce', 'freeze', 'damage'].includes(e.type))
      ).length;
      
      const opponentThreats = opponent.battlefield.filter(c => {
        if (c.type === 'creature') {
          const stats = getCreatureStats(c, aiIndex === 0 ? 1 : 0, game);
          return stats.attack >= 3;
        }
        return false;
      }).length;
      
      return {
        shouldRace: false, // Blue never races, it controls
        canFinish: cardAdvantage >= 3 && opponentThreats === 0,
        priority: cardAdvantage >= 2 ? 'stabilize-and-win' : 'draw-and-control',
      };
    },
  },
};

// Get current deck strategy based on AI's deck color
function getDeckStrategy() {
  const game = state.game;
  if (!game || !game.players[1]) return null;
  
  const aiPlayer = game.players[1];
  const deckColor = aiPlayer.color || 'red'; // Default to red if unknown
  
  return DECK_STRATEGIES[deckColor] || DECK_STRATEGIES.red;
}

function scheduleAI(action, delayMs = AI_DELAY_MS) {
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
  }, delayMs);
}

// Helper to schedule AI action with visual delay before execution
function scheduleAIWithDelay(action, delayMs = AI_DELAY_MS) {
  scheduleAI(action, delayMs);
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
    const scheduled = aiPlayTurnStep(aiPlayer, game.phase);
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function willCreatureSurvive(attacker, blocker, attackerIndex, blockerIndex, game) {
  const attackerStats = getCreatureStats(attacker, attackerIndex, game);
  const blockerStats = getCreatureStats(blocker, blockerIndex, game);
  const attackerHP = attackerStats.toughness - (attacker.damageMarked || 0);
  return attackerHP > blockerStats.attack;
}

function canKillCreature(attacker, defender, attackerIndex, defenderIndex, game) {
  const attackerStats = getCreatureStats(attacker, attackerIndex, game);
  const defenderStats = getCreatureStats(defender, defenderIndex, game);
  const defenderHP = defenderStats.toughness - (defender.damageMarked || 0);
  return attackerStats.attack >= defenderHP;
}

function getCreatureThreatLevel(creature, controllerIndex, game) {
  const stats = getCreatureStats(creature, controllerIndex, game);
  let threat = stats.attack * 2 + stats.toughness;
  
  // CRITICAL FIX: Buffed creatures are higher priority targets for removal
  // Check if creature has been buffed (has buffs array with items)
  if (creature.buffs && creature.buffs.length > 0) {
    threat += 3; // Buffed creatures are more valuable targets
    // Extra value for each buff
    threat += creature.buffs.length * 2;
  }
  
  // Boost value for abilities
  if (creature.abilities?.haste) threat += 2;
  if (creature.abilities?.shimmer || hasShimmer(creature)) threat += 3;
  
  // Activated abilities are more valuable (repeatable)
  if (creature.activated) {
    threat += 4; // Worth more than passive abilities
    // Extra value for mana/draw effects
    if (creature.activated.effect?.type === 'gainMana') threat += 2;
    if (creature.activated.effect?.type === 'draw') threat += 2;
  }
  
  // Passive abilities have situational value
  if (creature.passive) {
    threat += 2;
    // onAttack triggers only when attacking (less reliable)
    if (creature.passive.type === 'onAttack') threat -= 1;
  }
  
  return threat;
}

function calculateUnblockedDamage(attackers, attackerIndex, game) {
  return attackers.reduce((total, creature) => {
    const stats = getCreatureStats(creature, attackerIndex, game);
    return total + stats.attack;
  }, 0);
}

// ============================================================================
// BLUFFING SYSTEM
// ============================================================================

function shouldBluff() {
  return Math.random() < AI_SETTINGS.bluffChance;
}

function bluffDelay() {
  // Sometimes add extra delay to simulate "thinking"
  if (Math.random() < 0.3) {
    return Math.floor(Math.random() * 500) + 500;
  }
  return 0;
}

// ============================================================================
// MANA CURVE & PLANNING SYSTEM
// ============================================================================

function evaluateManaEfficiency(hand, currentMana, turnsAhead = 1) {
  // Simulate future turns and calculate how efficiently we can spend mana
  let totalValue = 0;
  let manaAvailable = currentMana;
  const sortedHand = [...hand].sort((a, b) => (b.cost || 0) - (a.cost || 0));
  
  for (let turn = 0; turn < turnsAhead; turn++) {
    const playableThisTurn = sortedHand.filter(card => (card.cost || 0) <= manaAvailable);
    
    // Try to spend as much mana as possible
    let manaSpent = 0;
    playableThisTurn.forEach(card => {
      if (manaSpent + (card.cost || 0) <= manaAvailable) {
        totalValue += evaluateCardValue(card, 1, state.game);
        manaSpent += (card.cost || 0);
      }
    });
    
    // Next turn we'd have more mana
    manaAvailable += Math.min(10 - currentMana - turn, 1);
  }
  
  return totalValue;
}

function shouldHoldCard(card, phase, hand, availableMana) {
  // CRITICAL: Card advantage evaluation
  const game = state.game;
  const opponent = game.players[0];
  const aiPlayer = game.players[1];
  
  // CRITICAL FIX: If AI is desperate (low life), play EVERYTHING to try to win
  if (aiPlayer.life <= 12) {
    return false; // Never hold cards when desperate - play everything!
  }
  
  // Don't hold creatures in main1 - we want them on board
  if (card.type === 'creature' && phase === 'main1') {
    return false;
  }
  
  // Hold expensive cards if we can't afford them efficiently
  const cost = card.cost || 0;
  if (cost > availableMana) {
    return true; // Can't play it anyway
  }
  
  // CRITICAL FIX: If hand is large (5+ cards), be more aggressive about playing
  // Don't hoard cards - use them!
  if (hand.length >= 5) {
    // With many cards, only hold if we literally can't use it now
    // and it's expensive (6+ mana)
    if (cost >= 6 && availableMana < cost) {
      return true;
    }
    return false; // Play cards when we have many
  }
  
  // If hand is small, don't hold cards (card disadvantage)
  if (hand.length <= 3) {
    return false;
  }
  
  // Evaluate if holding this card creates better future value
  const playNowValue = evaluateCardValue(card, 1, game);
  
  // Calculate value if we wait a turn
  const futureHand = hand.filter(c => c.instanceId !== card.instanceId);
  const futureValue = evaluateManaEfficiency(futureHand, availableMana + 1, 2);
  const currentValue = evaluateManaEfficiency(hand, availableMana, 1);
  
  // Bluffing: Sometimes hold cards randomly (but less often)
  if (shouldBluff() && Math.random() < 0.2) {
    return true;
  }
  
  // Hold if future value is significantly better (increased threshold)
  return futureValue > currentValue * (AI_SETTINGS.cardValueMultiplier + 0.3);
}

// ============================================================================
// CARD EVALUATION
// ============================================================================

function evaluateCardValue(card, playerIndex, game) {
  const player = game.players[playerIndex];
  const opponent = game.players[playerIndex === 0 ? 1 : 0];
  
  // CRITICAL: Get deck strategy
  const strategy = getDeckStrategy();
  const priorities = strategy?.priorities || {
    faceTargeting: 0.5,
    boardControl: 0.5,
    cardAdvantage: 0.5,
    creatureQuality: 0.5,
  };
  
  if (card.type === 'creature') {
    const threat = (card.attack || 0) * 2 + (card.toughness || 0);
    let value = threat + (card.cost || 0);
    
    // Scale creature value by deck strategy
    value *= priorities.creatureQuality;
    
    // Bonus for abilities
    if (card.abilities?.haste) value += 3;
    if (card.abilities?.shimmer) value += 4 * priorities.faceTargeting; // Aggressive decks love unblockable
    if (card.activated) value += 3;
    if (card.passive) value += 3;
    
    return value;
  }
  
  // Evaluate spells based on effects and deck strategy
  const effects = card.effects || [];
  let value = 0;
  
  effects.forEach(effect => {
    switch (effect.type) {
      case 'damage': {
        // Check if it targets face or creatures
        if (effect.target === 'opponent' || effect.target === 'player') {
          // Face damage - value scales with aggressive strategy
          value += (effect.amount || 0) * 4 * priorities.faceTargeting;
          
          // CRITICAL: Lethal damage is priceless
          if (effect.amount >= opponent.life) {
            value += 100;
          } else if (opponent.life - effect.amount <= 5) {
            value += 20; // Gets into burn range
          }
        } else {
          // Creature removal
          const opponentCreatures = opponent.battlefield.filter(c => c.type === 'creature');
          const canKillTarget = opponentCreatures.some(creature => {
            const stats = getCreatureStats(creature, playerIndex === 0 ? 1 : 0, game);
            const hp = stats.toughness - (creature.damageMarked || 0);
            return effect.amount >= hp;
          });
          value += (canKillTarget ? 8 : 4) * priorities.boardControl;
        }
        break;
      }
      case 'draw':
        value += effect.amount * 3 * priorities.cardAdvantage;
        break;
      case 'bounce':
        value += 6 * priorities.boardControl;
        break;
      case 'freeze':
        value += 5 * priorities.boardControl;
        break;
      case 'temporaryBuff':
      case 'buff': {
        const buffAmount = (effect.attack || 0) + (effect.toughness || 0);
        // Aggressive decks value buffs for pushing damage
        value += buffAmount * (1 + priorities.faceTargeting);
        break;
      }
      case 'grantShimmer':
        // Unblockable is great for aggressive decks
        value += 8 * priorities.faceTargeting;
        break;
      case 'gainLife': {
        // Defensive decks value life gain more
        const lifeValue = priorities.faceTargeting < 0.5 ? 1.5 : 0.5;
        value += effect.amount * lifeValue;
        break;
      }
      case 'gainMana':
        value += effect.amount * 2;
        break;
      default:
        value += 2;
    }
  });
  
  return value;
}

function isCombatBuff(card) {
  // Check if card is a combat-relevant buff that should be played before combat
  // CRITICAL: ALL buffs should be played in main1, not main2, to be useful in combat
  if (!card.effects) return false;
  
  return card.effects.some(effect => {
    // Any buff or combat-relevant effect should be played before combat
    return [
      'temporaryBuff',           // +attack/+toughness until end of turn (Ignite Fury)
      'buff',                    // Permanent +attack/+toughness (Flame Shield)
      'selfBuff',                // Permanent buff to self (Blooming Hydra)
      'multiBuff',               // Buff multiple creatures
      'teamBuff',                // Buff all creatures (Ancient Awakening)
      'grantShimmer',            // Makes creature unblockable (Shimmer Strike)
      'grantHaste',              // Allows immediate attack (Blitz Formation)
      'preventCombatDamage',     // Prevents damage this turn
      'preventDamageToAttackers', // Combat-specific (old)
      'grantHidden',             // Prevents combat damage to attackers (Hidden Ambush)
    ].includes(effect.type);
  });
}

function shouldSaveForMain2(card, playerIndex, game) {
  // We're in main1, should we save this spell for main2?
  if (!card.effects) return false;
  
  const effects = card.effects;
  const opponent = game.players[playerIndex === 0 ? 1 : 0];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  
  // Removal spells (damage/bounce/freeze) should be saved if they can enable better attacks
  const hasRemoval = effects.some(e => ['damage', 'bounce', 'freeze'].includes(e.type));
  if (!hasRemoval) return false;
  
  // Bluffing: Sometimes don't save spells (play unpredictably)
  if (shouldBluff() && Math.random() < 0.4) {
    return false;
  }
  
  // Check if we have attackers and opponent has blockers
  const player = game.players[playerIndex];
  const potentialAttackers = player.battlefield.filter(isEligibleAttacker);
  const potentialBlockers = opponent.battlefield.filter(isBlockerEligible);
  
  if (potentialAttackers.length === 0 || potentialBlockers.length === 0) {
    return false;
  }
  
  // Check if removal spell can kill a blocker after combat damage
  const damageEffect = effects.find(e => e.type === 'damage');
  if (damageEffect && damageEffect.target === 'enemy-creature') {
    const biggestAttacker = potentialAttackers.reduce((best, creature) => {
      const stats = getCreatureStats(creature, playerIndex, game);
      const bestStats = best ? getCreatureStats(best, playerIndex, game) : { attack: 0 };
      return stats.attack > bestStats.attack ? creature : best;
    }, null);
    
    if (biggestAttacker) {
      const threateningBlockers = potentialBlockers.filter(blocker => {
        const blockerStats = getCreatureStats(blocker, opponentIndex, game);
        const attackerStats = getCreatureStats(biggestAttacker, playerIndex, game);
        const blockerHP = blockerStats.toughness - (blocker.damageMarked || 0);
        // Blocker would survive and block effectively
        return blockerHP > attackerStats.attack;
      });
      
      const canKillBlocker = threateningBlockers.some(blocker => {
        const stats = getCreatureStats(blocker, opponentIndex, game);
        const hp = stats.toughness - (blocker.damageMarked || 0);
        return damageEffect.amount >= hp;
      });
      
      if (canKillBlocker) {
        return true;
      }
    }
  }
  
  return false;
}

// ============================================================================
// SPELL UTILITY CHECK
// ============================================================================

function isSpellUseful(card, player, game) {
  // Check if a spell would have any useful effect
  if (!card.effects) return true; // No effects to check
  
  const aiIndex = 1;
  const opponentIndex = 0;
  const opponent = game.players[opponentIndex];
  
  for (const effect of card.effects) {
    switch (effect.type) {
      case 'preventDamageToAttackers':
      case 'grantHidden':
        // CRITICAL FIX: Only useful if we have creatures that can attack
        // Check battlefield exists and has creatures
        if (!player.battlefield || player.battlefield.length === 0) {
          return false;
        }
        
        // Check if we have any creatures at all
        const hasAnyCreatures = player.battlefield.some(c => c.type === 'creature');
        if (!hasAnyCreatures) {
          return false;
        }
        
        // Then check if any can attack (not summoning sick, not frozen)
        const canAttack = player.battlefield.some(c => 
          c.type === 'creature' && !c.summoningSickness && !(c.frozenTurns > 0)
        );
        if (!canAttack) {
          return false;
        }
        break;
        
      case 'revive':
        // CRITICAL FIX: Only useful if graveyard has creatures
        const hasCreaturesInGraveyard = player.graveyard?.some(c => c.type === 'creature');
        if (!hasCreaturesInGraveyard) return false;
        break;
        
      case 'buff':
      case 'temporaryBuff':
      case 'multiBuff':
      case 'teamBuff':
        // Only useful if we have creatures to buff
        const hasCreatures = player.battlefield.some(c => c.type === 'creature');
        if (!hasCreatures) return false;
        break;
        
      case 'heal':
        // Only useful if we have damaged creatures
        const hasDamagedCreatures = player.battlefield.some(c => 
          c.type === 'creature' && (c.damageMarked || 0) > 0
        );
        if (!hasDamagedCreatures) return false;
        break;
    }
  }
  
  return true; // Spell is useful
}

// ============================================================================
// MAIN PHASE AI
// ============================================================================

function aiPlayTurnStep(aiPlayer, phase) {
  const game = state.game;
  const aiIndex = 1;
  
  // Try to use activated abilities first
  // CRITICAL: Exclude creatures with summoning sickness
  const creaturesWithAbilities = aiPlayer.battlefield.filter(c => 
    c.activated && 
    !c.activatedThisTurn && 
    !c.summoningSickness &&
    !(c.frozenTurns > 0) &&
    aiPlayer.availableMana >= (c.activated.cost || 0)
  );
  
  for (const creature of creaturesWithAbilities) {
    const effect = creature.activated.effect;
    let shouldUse = false;
    
    if (effect.type === 'draw') {
      // Bluffing: Sometimes don't draw (play suboptimally)
      shouldUse = !shouldBluff() || Math.random() > 0.3;
    } else if (effect.type === 'gainMana') {
      // CRITICAL: Use gainMana if it enables playing any card in hand
      const cost = creature.activated.cost || 0;
      const currentMana = aiPlayer.availableMana;
      const extraMana = effect.amount || 1;
      const manaAfterAbility = currentMana - cost + extraMana;
      
      // Check if we have any cards we can play with the extra mana
      const cardsPlayableWithExtra = aiPlayer.hand.filter(card => {
        const cardCost = card.cost || 0;
        return cardCost <= manaAfterAbility && cardCost > currentMana;
      });
      
      // Also check if it helps us play multiple cards this turn
      const cardsPlayableNow = aiPlayer.hand.filter(card => (card.cost || 0) <= currentMana);
      const cardsPlayableAfter = aiPlayer.hand.filter(card => (card.cost || 0) <= manaAfterAbility);
      
      // Use if: we can play a new card, OR we can play more total cards
      shouldUse = cardsPlayableWithExtra.length > 0 || cardsPlayableAfter.length > cardsPlayableNow.length;
    } else if (effect.type === 'damage' || effect.type === 'buff') {
      shouldUse = true;
    }
    
    if (shouldUse) {
      scheduleAI(() => {
        helpers.activateCreatureAbility(creature.instanceId, aiIndex);
        requestRender();
        // Don't call runAI() here - continueAIIfNeeded() in flow.js handles it
        // This prevents double-scheduling which can mess up the AI's decision flow
      });
      return true;
    }
  }
  
  const playableCards = aiPlayer.hand.filter((card) => helpers.canPlayCard(card, aiIndex, game));
  
  // Sort cards by value
  const sortedCards = playableCards.sort((a, b) => {
    const aValue = evaluateCardValue(a, aiIndex, game);
    const bValue = evaluateCardValue(b, aiIndex, game);
    return bValue - aValue;
  });
  
  for (const card of sortedCards) {
    // CRITICAL: Card advantage - should we hold this card?
    if (shouldHoldCard(card, phase, aiPlayer.hand, aiPlayer.availableMana)) {
      continue; // Hold this card for later
    }
    
    // CRITICAL: Don't play combat buffs in main2 (after combat)
    if (phase === 'main2' && card.type === 'spell' && isCombatBuff(card)) {
      continue; // Save for next turn's main1
    }
    
    // CRITICAL: In main1, check if we should save removal spells for main2
    if (phase === 'main1' && card.type === 'spell' && shouldSaveForMain2(card, aiIndex, game)) {
      continue;
    }
    
    if (card.type === 'creature') {
      scheduleAI(() => {
        helpers.playCreature(aiIndex, card);
        requestRender();
        if (!state.game?.pendingAction) {
          runAI();
        }
      });
      return true;
    }
    
    // CRITICAL FIX: Check if spell would have any effect before playing it
    if (card.type === 'spell' && !isSpellUseful(card, aiPlayer, game)) {
      continue; // Don't waste this spell
    }
    
    const requirements = helpers.computeRequirements(card);
    const chosenTargets = {};
    let requirementsSatisfied = true;
    requirements.forEach((req) => {
      const targets = pickTargetsForAI(req, aiIndex);
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
    
    scheduleAI(() => {
      helpers.prepareSpell(aiIndex, card, { aiChosenTargets: chosenTargets });
    });
    return true;
  }
  return false;
}

// Helper: Calculate total available damage from all playable damage spells in hand
function getTotalAvailableDamage(player, game) {
  return player.hand.reduce((total, card) => {
    if (!helpers.canPlayCard(card, 1, game)) return total;
    const damageEffect = card.effects?.find(e => e.type === 'damage');
    if (damageEffect && damageEffect.target !== 'opponent' && damageEffect.target !== 'player') {
      return total + (damageEffect.amount || 0);
    }
    return total;
  }, 0);
}

function pickTargetsForAI(requirement, controllerIndex) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];
  const desired = requirement.count ?? 1;

  const selectCreatures = (creatures, ownerIndex, count, sortBy = 'attack', allowBluffing = true) => {
    let sorted = creatures.filter((c) => c.type === 'creature');
    
    if (sortBy === 'attack') {
      sorted = sorted.sort(
        (a, b) =>
          getCreatureStats(b, ownerIndex, game).attack -
          getCreatureStats(a, ownerIndex, game).attack,
      );
    } else if (sortBy === 'threat') {
      sorted = sorted.sort(
        (a, b) =>
          getCreatureThreatLevel(b, ownerIndex, game) -
          getCreatureThreatLevel(a, ownerIndex, game),
      );
    } else if (sortBy === 'weakest') {
      sorted = sorted.sort(
        (a, b) =>
          getCreatureThreatLevel(a, ownerIndex, game) -
          getCreatureThreatLevel(b, ownerIndex, game),
      );
    }
    
    // CRITICAL FIX: Don't bluff when targeting removal spells
    // Bluffing: Sometimes pick random targets (only for buffs, not removal)
    if (allowBluffing && shouldBluff() && sorted.length > 1) {
      const randomIndex = Math.floor(Math.random() * Math.min(3, sorted.length));
      const randomPick = sorted.splice(randomIndex, 1);
      sorted.unshift(...randomPick);
    }
    
    return sorted
      .slice(0, count)
      .map((creature) => ({ type: 'creature', creature, controller: ownerIndex }));
  };

  if (requirement.target === 'friendly-creature') {
    return selectCreatures(controller.battlefield, controllerIndex, desired, 'attack');
  }
  if (requirement.target === 'enemy-creature') {
    // CRITICAL FIX: Damage spells should prioritize creatures they can KILL
    if (requirement.effect?.type === 'damage') {
      const damageAmount = requirement.effect.amount || 0;
      
      // Check for creatures we can kill with THIS spell
      const killableNow = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        return damageAmount >= hp;
      });
      
      if (killableNow.length > 0) {
        // We can kill creatures - target the highest threat we can kill
        return selectCreatures(killableNow, opponentIndex, desired, 'threat', false);
      }
      
      // CRITICAL: Check if we can combo-kill with other damage spells in hand
      const totalDamage = getTotalAvailableDamage(controller, game);
      const killableWithCombo = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        // Can we kill this with all our damage combined?
        return totalDamage >= hp && damageAmount < hp;
      });
      
      if (killableWithCombo.length > 0) {
        // We can combo-kill - target highest threat we can eventually kill
        return selectCreatures(killableWithCombo, opponentIndex, desired, 'threat', false);
      }
      
      // Can't kill anything even with combos - don't waste the spell
      return [];
    }
    
    if (requirement.effect?.type === 'bounce' || requirement.effect?.type === 'freeze') {
      // Bounce/freeze should target highest threat
      return selectCreatures(opponent.battlefield, opponentIndex, desired, 'threat', false);
    }
    return selectCreatures(opponent.battlefield, opponentIndex, desired, 'attack');
  }
  if (requirement.target === 'any-creature') {
    if (['temporaryBuff', 'buff', 'heal', 'grantHaste', 'multiBuff', 'grantShimmer'].includes(requirement.effect.type)) {
      return selectCreatures(controller.battlefield, controllerIndex, desired, 'attack');
    }
    
    // CRITICAL FIX: Damage spells should only target creatures they can KILL
    if (requirement.effect?.type === 'damage') {
      const damageAmount = requirement.effect.amount || 0;
      
      // Check for creatures we can kill with THIS spell
      const killableNow = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        return damageAmount >= hp;
      });
      
      if (killableNow.length > 0) {
        return selectCreatures(killableNow, opponentIndex, desired, 'threat', false);
      }
      
      // Check if we can combo-kill with other damage spells
      const totalDamage = getTotalAvailableDamage(controller, game);
      const killableWithCombo = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        return totalDamage >= hp && damageAmount < hp;
      });
      
      if (killableWithCombo.length > 0) {
        return selectCreatures(killableWithCombo, opponentIndex, desired, 'threat', false);
      }
      
      // Can't kill any enemy creatures - don't waste on our own
      return [];
    }
    
    // Bounce/freeze should target highest threat
    if (requirement.effect?.type === 'bounce' || requirement.effect?.type === 'freeze') {
      const enemySelection = selectCreatures(opponent.battlefield, opponentIndex, desired, 'threat', false);
      if (enemySelection.length) {
        return enemySelection;
      }
    }
    
    return selectCreatures(controller.battlefield, controllerIndex, desired, 'weakest');
  }
  if (requirement.target === 'creature') {
    // CRITICAL FIX: Damage spells should only target creatures they can KILL
    if (requirement.effect?.type === 'damage') {
      const damageAmount = requirement.effect.amount || 0;
      
      // Check for creatures we can kill with THIS spell
      const killableNow = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        return damageAmount >= hp;
      });
      
      if (killableNow.length > 0) {
        return selectCreatures(killableNow, opponentIndex, desired, 'threat', false);
      }
      
      // Check if we can combo-kill with other damage spells
      const totalDamage = getTotalAvailableDamage(controller, game);
      const killableWithCombo = opponent.battlefield.filter(c => {
        if (c.type !== 'creature') return false;
        const stats = getCreatureStats(c, opponentIndex, game);
        const hp = stats.toughness - (c.damageMarked || 0);
        return totalDamage >= hp && damageAmount < hp;
      });
      
      if (killableWithCombo.length > 0) {
        return selectCreatures(killableWithCombo, opponentIndex, desired, 'threat', false);
      }
      
      // Can't kill anything - don't waste the spell
      return [];
    }
    
    // Bounce/freeze should target highest threat
    if (requirement.effect?.type === 'bounce' || requirement.effect?.type === 'freeze') {
      const enemySelection = selectCreatures(opponent.battlefield, opponentIndex, desired, 'threat', false);
      if (enemySelection.length) {
        return enemySelection;
      }
    }
    
    return selectCreatures(controller.battlefield, controllerIndex, desired, 'weakest');
  }
  if (requirement.target === 'any') {
    // CRITICAL: For damage effects, prefer player face unless we can kill a creature
    if (requirement.effect?.type === 'damage' && requirement.allowPlayers) {
      const damageAmount = requirement.effect.amount || 0;
      const opponentCreatures = opponent.battlefield.filter(c => c.type === 'creature');
      
      // CRITICAL FIX: Check for LETHAL first - always go for the win!
      if (damageAmount >= opponent.life) {
        return [{ type: 'player', controller: opponentIndex }];
      }
      
      // CRITICAL FIX: Check if we can get opponent into lethal range (very low life)
      if (opponent.life - damageAmount <= 3) {
        // Getting them to 3 or less life is very valuable (burn range)
        return [{ type: 'player', controller: opponentIndex }];
      }
      
      // Find creatures we can actually kill
      const killableCreatures = opponentCreatures.filter(creature => {
        const stats = getCreatureStats(creature, opponentIndex, game);
        const hp = stats.toughness - (creature.damageMarked || 0);
        return damageAmount >= hp;
      });
      
      if (killableCreatures.length > 0) {
        // We can kill a creature - target the biggest threat we can kill
        const sorted = killableCreatures.sort((a, b) => 
          getCreatureThreatLevel(b, opponentIndex, game) - getCreatureThreatLevel(a, opponentIndex, game)
        );
        return [{ type: 'creature', creature: sorted[0], controller: opponentIndex }];
      } else {
        // Can't kill anything - hit face for guaranteed damage
        return [{ type: 'player', controller: opponentIndex }];
      }
    }
    
    // Non-damage effects: prioritize creatures
    const selections = selectCreatures(opponent.battlefield, opponentIndex, desired, 'threat');
    if (requirement.allowPlayers) {
      selections.push({ type: 'player', controller: opponentIndex });
    }
    if (selections.length < desired) {
      selections.push(...selectCreatures(controller.battlefield, controllerIndex, desired - selections.length, 'weakest'));
    }
    if (requirement.allowPlayers && selections.length < desired) {
      selections.push({ type: 'player', controller: controllerIndex });
    }
    return selections.slice(0, Math.max(0, Math.min(desired, selections.length)));
  }
  return [];
}

// ============================================================================
// COMBAT AI
// ============================================================================

function aiDeclareAttacks() {
  const game = state.game;
  const aiIndex = 1;
  const opponentIndex = 0;
  
  if (!game.combat) {
    return;
  }
  
  const allEligible = game.players[aiIndex].battlefield.filter(isEligibleAttacker);
  if (allEligible.length === 0) {
    // AI has no eligible attackers
    addLog('No attackers declared.');
    requestRender();
    scheduleAI(() => {
      skipCombat();
      runAI();
    });
    return;
  }
  
  const opponent = game.players[opponentIndex];
  const aiPlayer = game.players[aiIndex];
  const potentialBlockers = opponent.battlefield.filter(isBlockerEligible);
  
  // CRITICAL: Get deck strategy for this color
  const strategy = getDeckStrategy();
  const gameState = strategy?.evaluate(game, aiIndex) || { shouldRace: false, canFinish: false };
  
  // Calculate total potential damage
  const maxDamage = calculateUnblockedDamage(allEligible, aiIndex, game);
  const isLethal = maxDamage >= opponent.life;
  
  // CRITICAL: Pressure logic - how low does opponent need to be before we go aggressive?
  const pressureThreshold = strategy?.combat.pressureThreshold || 12;
  const isPressure = opponent.life <= pressureThreshold;
  const acceptBadTrades = strategy?.combat.acceptBadTrades || false;
  const attackAggression = strategy?.combat.attackAggression || 0.7;
  
  // Check if we can finish opponent with burn/direct damage after combat
  const directDamageInHand = aiPlayer.hand.reduce((total, card) => {
    if (card.effects?.some(e => e.type === 'damage' && 
        (e.target === 'opponent' || e.target === 'any' || e.target === 'player'))) {
      const dmg = card.effects.find(e => e.type === 'damage')?.amount || 0;
      if (aiPlayer.availableMana >= (card.cost || 0)) {
        return total + dmg;
      }
    }
    return total;
  }, 0);
  
  // Strategic attack decision
  const shouldAttack = allEligible.filter(creature => {
    const stats = getCreatureStats(creature, aiIndex, game);
    
    // Always attack with shimmer (unblockable)
    if (creature.abilities?.shimmer || hasShimmer(creature)) {
      return true;
    }
    
    // CRITICAL FIX: If opponent has no blockers, ALWAYS attack with everything
    // This is guaranteed damage - never pass it up
    if (potentialBlockers.length === 0) {
      return true;
    }
    
    // CRITICAL FIX: Board control - attack if we can kill their blockers
    // Check if this creature can kill any of their blockers
    const canKillBlocker = potentialBlockers.some(blocker => {
      const blockerStats = getCreatureStats(blocker, opponentIndex, game);
      const blockerHP = blockerStats.toughness - (blocker.damageMarked || 0);
      return stats.attack >= blockerHP;
    });
    
    // If we can kill a blocker (even if we die), that's good board control
    if (canKillBlocker) {
      const wouldDie = potentialBlockers.some(blocker => {
        const blockerStats = getCreatureStats(blocker, opponentIndex, game);
        return blockerStats.attack >= stats.toughness;
      });
      
      // Attack if: we survive OR it's a favorable/even trade
      if (!wouldDie) {
        return true; // We survive and kill their creature - always attack
      }
      
      // Both die - check if it's a good trade
      const myThreat = getCreatureThreatLevel(creature, aiIndex, game);
      const bestBlockerThreat = Math.max(...potentialBlockers.map(b => 
        getCreatureThreatLevel(b, opponentIndex, game)
      ));
      
      // Attack if their best blocker is more valuable than us (good trade)
      if (bestBlockerThreat >= myThreat * 0.8) {
        return true; // Even or favorable trade
      }
    }
    
    // CRITICAL: Numerical advantage - if we have more attackers than they have blockers
    if (allEligible.length > potentialBlockers.length) {
      // We outnumber them - some damage WILL get through
      // Aggressive decks: attack with everything
      // Defensive decks: attack with enough to overwhelm
      const ratio = allEligible.length / Math.max(1, potentialBlockers.length);
      if (ratio >= 2 || acceptBadTrades) {
        return true; // Overwhelming advantage or aggressive deck
      }
    }
    
    // CRITICAL: Being outnumbered - don't suicide all creatures
    if (potentialBlockers.length > allEligible.length) {
      // They have more blockers than we have attackers
      // Check if all our creatures will die for zero damage
      const allWillDie = allEligible.every(attacker => {
        const aStats = getCreatureStats(attacker, aiIndex, game);
        // Find if any blocker can kill this attacker
        return potentialBlockers.some(blocker => {
          const bStats = getCreatureStats(blocker, opponentIndex, game);
          return bStats.attack >= aStats.toughness;
        });
      });
      
      if (allWillDie && acceptBadTrades) {
        // Even red deck shouldn't suicide ALL creatures for nothing
        // Only attack if this creature is weak and we're preserving stronger ones
        const myThreat = getCreatureThreatLevel(creature, aiIndex, game);
        const avgThreat = allEligible.reduce((sum, c) => 
          sum + getCreatureThreatLevel(c, aiIndex, game), 0
        ) / allEligible.length;
        
        // Only attack if we're below average threat (sacrifice weak ones)
        return myThreat < avgThreat * 0.8;
      }
    }
    
    // CRITICAL: Aggressive pressure logic
    // If opponent is low OR we can finish with burn, be more aggressive
    if (isPressure || gameState.shouldRace || gameState.canFinish) {
      // Calculate damage that will get through even if this creature dies
      const damageWithoutMe = allEligible
        .filter(c => c.instanceId !== creature.instanceId)
        .reduce((total, c) => {
          const s = getCreatureStats(c, aiIndex, game);
          return total + s.attack;
        }, 0);
      
      const myDamage = stats.attack;
      const totalPotentialDamage = damageWithoutMe + myDamage;
      
      // If attacking gets us close to lethal (within burn range), GO FOR IT
      if (totalPotentialDamage + directDamageInHand >= opponent.life) {
        return true; // This attack contributes to lethal
      }
      
      // If opponent is very low, attack even with bad trades
      if (opponent.life <= 8 && myDamage > 0) {
        return true; // Every point of damage matters
      }
      
      // For aggressive decks (Red), willing to trade creatures for damage
      if (acceptBadTrades && opponent.life <= pressureThreshold) {
        // Attack if we deal ANY damage, even if we die
        return myDamage > 0;
      }
    }
    
    // CRITICAL: Red deck aggression - force damage through
    // BUT don't suicide all creatures when outnumbered
    if (acceptBadTrades && potentialBlockers.length < allEligible.length) {
      // They can't block everything - some damage will get through
      // Check if this creature can actually contribute
      const canContribute = potentialBlockers.length === 0 || stats.attack > 0;
      if (canContribute) {
        return true; // Attack to force damage through
      }
    }
    
    // Check specific creature vs blockers
    const strongestBlocker = potentialBlockers.reduce((best, blocker) => {
      const blockerStats = getCreatureStats(blocker, opponentIndex, game);
      if (!best) return blocker;
      const bestStats = getCreatureStats(best, opponentIndex, game);
      return blockerStats.attack > bestStats.attack ? blocker : best;
    }, null);
    
    if (strongestBlocker) {
      const blockerStats = getCreatureStats(strongestBlocker, opponentIndex, game);
      
      // Evaluate creature threats to determine if trade is favorable
      const myThreat = getCreatureThreatLevel(creature, aiIndex, game);
      const blockerThreat = getCreatureThreatLevel(strongestBlocker, opponentIndex, game);
      
      // Would this creature die for no value?
      const wouldDieForNothing = stats.attack < blockerStats.toughness && stats.toughness <= blockerStats.attack;
      
      if (wouldDieForNothing) {
        // Check for immediate lethal
        if (isLethal) {
          return true;
        }
        
        // CRITICAL: Pressure logic - some creatures dying is OK if others get through
        if (isPressure && potentialBlockers.length < allEligible.length) {
          // If they can't block everything, some damage gets through
          // Attack with weak creatures to "soak up" blockers
          return true;
        }
        
        return false; // Don't suicide otherwise
      }
      
      // Check if both creatures would die (trade)
      const iWouldDie = stats.toughness <= blockerStats.attack;
      const blockerWouldDie = blockerStats.toughness <= stats.attack;
      
      // CRITICAL FIX: If we survive and kill their blocker, ALWAYS attack
      if (!iWouldDie && blockerWouldDie) {
        return true; // We win the trade - always attack
      }
      
      // CRITICAL FIX: If we survive and they survive, still attack (we deal damage)
      if (!iWouldDie && !blockerWouldDie) {
        return true; // We survive and deal damage - always attack
      }
      
      if (iWouldDie && blockerWouldDie) {
        // It's a trade - only attack if it's favorable
        // Don't trade a valuable creature for a weaker one
        if (myThreat > blockerThreat * 1.2) {
          // Our creature is much better - don't trade
          return false;
        }
        // Trade is acceptable - attack
        return true;
      }
    }
    
    // Default: attack if deck is aggressive
    return Math.random() < attackAggression;
  });
  
  if (shouldAttack.length === 0) {
    // AI chose not to attack
    addLog('No attackers declared.');
    requestRender();
    scheduleAI(() => {
      skipCombat();
      runAI();
    });
    return;
  }
  
  game.combat.attackers = shouldAttack.map((creature) => ({ creature, controller: aiIndex }));
  shouldAttack.forEach((creature) => {
    helpers.addLog([
      playerSegment(game.players[aiIndex]),
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
// BLOCKING AI - ADVANCED STRATEGY
// ============================================================================

export function assignAIBlocks() {
  const game = state.game;
  const aiIndex = 1;
  const opponentIndex = 0;
  
  if (!game.blocking) return;
  
  const defenders = game.players[aiIndex].battlefield.filter(isBlockerEligible);
  const attackers = game.blocking.attackers.filter(attacker => !hasShimmer(attacker.creature));
  
  if (defenders.length === 0 || attackers.length === 0) {
    // No eligible defenders or no blockable attackers - just return
    // The prepareBlocks() function will handle logging and resolution
    return;
  }
  
  const aiPlayer = game.players[aiIndex];
  const opponent = game.players[opponentIndex];
  
  // Calculate total incoming damage if we don't block
  const totalIncomingDamage = attackers.reduce((total, attacker) => {
    const stats = getCreatureStats(attacker.creature, attacker.controller, game);
    return total + stats.attack;
  }, 0);
  
  // CRITICAL: Get deck strategy for blocking decisions
  const strategy = getDeckStrategy();
  const blockAggression = strategy?.combat.blockAggression || 0.7;
  
  // CRITICAL: Blocking strategy decision
  const aiLife = aiPlayer.life;
  const isLethal = totalIncomingDamage >= aiLife;
  const isCritical = totalIncomingDamage >= aiLife * 0.5;
  const isVeryLowLife = aiLife <= 8; // Desperate situation - prioritize survival
  
  // CRITICAL FIX: If we're at low life and taking ANY damage, be very defensive
  // Match the card-playing desperate threshold (12 life)
  const isDesperate = aiLife <= 12 && totalIncomingDamage > 0;
  
  // Evaluate each potential block
  const blockOptions = [];
  
  attackers.forEach(attacker => {
    const attackerStats = getCreatureStats(attacker.creature, attacker.controller, game);
    const isLargeThreat = attackerStats.attack >= 5;
    
    defenders.forEach(defender => {
      const defenderStats = getCreatureStats(defender, aiIndex, game);
      const defenderHP = defenderStats.toughness - (defender.damageMarked || 0);
      
      // Calculate trade value
      const defenderThreat = getCreatureThreatLevel(defender, aiIndex, game);
      const attackerThreat = getCreatureThreatLevel(attacker.creature, attacker.controller, game);
      
      const defenderDies = attackerStats.attack >= defenderHP;
      const attackerDies = defenderStats.attack >= attackerStats.toughness - (attacker.creature.damageMarked || 0);
      
      let blockValue = attackerStats.attack; // Damage prevented
      
      // CRITICAL FIX: Board control - heavily prioritize killing attackers
      if (attackerDies) {
        blockValue += attackerThreat * 2; // Killing their creature is very valuable
      }
      
      // CRITICAL FIX: Heavily prioritize blocking large threats (5+ damage)
      if (isLargeThreat) {
        blockValue += 15; // Big bonus for blocking large threats
        // Chump blocking is acceptable for large threats
        if (defenderDies && !attackerDies) {
          // Chump block - sacrifice small creature to block big threat
          // This is good if our creature is small
          if (defenderThreat < attackerStats.attack) {
            blockValue += 5; // Chump blocking large threats is valuable
          }
        }
      }
      
      // Adjust value based on trades
      if (defenderDies && attackerDies) {
        // Even trade - both die
        blockValue += attackerThreat - defenderThreat;
        // CRITICAL: Favor trades that kill their creature
        blockValue += 5; // Bonus for board control
      } else if (defenderDies && !attackerDies) {
        // Bad trade - we lose creature for nothing
        // But if it's a chump block on a large threat, it's acceptable
        if (!isLargeThreat) {
          blockValue -= defenderThreat * 1.5;
        }
      } else if (!defenderDies && attackerDies) {
        // Great trade - we keep our creature and kill theirs
        blockValue += attackerThreat + defenderThreat * 0.5;
        // CRITICAL: This is the best outcome - heavily favor it
        blockValue += 10; // Big bonus for winning the trade
      } else {
        // Both survive - still good to prevent damage
        blockValue += attackerStats.attack * 0.8; // Damage prevention has value
      }
      
      blockOptions.push({
        attacker: attacker.creature,
        defender: defender,
        value: blockValue,
        defenderDies,
        attackerDies,
        isLargeThreat,
      });
    });
  });
  
  // Sort blocks by value
  blockOptions.sort((a, b) => b.value - a.value);
  
  // Decide how many blocks to make based on situation and deck strategy
  let blocksToMake = 0;
  const favorableBlocks = blockOptions.filter(opt => opt.value > 0);
  
  // CRITICAL: Identify large threats that need chump blocking
  const largeThreats = attackers.filter(attacker => {
    const stats = getCreatureStats(attacker.creature, attacker.controller, game);
    return stats.attack >= 5; // Large creatures that deal significant damage
  });
  
  if (isLethal || isDesperate) {
    // CRITICAL FIX: Block EVERYTHING when facing lethal or desperate
    // This is life or death - use all blockers
    blocksToMake = Math.min(attackers.length, defenders.length);
  } else if (isVeryLowLife && totalIncomingDamage >= 3) {
    // CRITICAL: Very low life - every point of damage matters
    // Block as many attackers as possible to preserve life
    // Even aggressive decks need to survive
    blocksToMake = Math.min(attackers.length, defenders.length);
  } else if (isCritical) {
    // Block most dangerous attackers based on deck strategy
    // Defensive decks (blue/green) block more, aggressive decks (red) block less
    // But at low life, block more aggressively
    const criticalBlockAggression = isVeryLowLife ? Math.min(1.0, blockAggression + 0.3) : blockAggression;
    blocksToMake = Math.ceil(attackers.length * criticalBlockAggression);
  } else if (largeThreats.length > 0) {
    // CRITICAL FIX: Always block large threats (5+ damage) when possible
    // Chump blocking is acceptable to prevent massive damage
    // Block ALL large threats plus some others based on strategy
    const largeThreatsToBlock = Math.min(largeThreats.length, defenders.length);
    const otherBlocks = Math.ceil((attackers.length - largeThreats.length) * blockAggression);
    blocksToMake = Math.min(defenders.length, largeThreatsToBlock + otherBlocks);
  } else {
    // Make favorable blocks based on deck strategy
    // Aggressive decks only block the best trades, defensive decks block more
    if (blockAggression >= 0.7) {
      // Defensive deck - block most favorable blocks
      blocksToMake = favorableBlocks.length;
    } else {
      // Aggressive deck - be selective but still block good trades
      // At minimum, block at least 1 attacker if there's a favorable block
      const minBlocks = favorableBlocks.length > 0 ? 1 : 0;
      const strategicBlocks = Math.ceil(attackers.length * blockAggression);
      blocksToMake = Math.max(minBlocks, Math.min(favorableBlocks.length, strategicBlocks));
    }
  }
  
  // Bluffing: Sometimes block more or less
  // CRITICAL FIX: NEVER bluff when life is critical or desperate
  if (shouldBluff() && !isVeryLowLife && !isLethal && !isDesperate) {
    const variance = Math.random() < 0.5 ? -1 : 1;
    blocksToMake = Math.max(0, Math.min(defenders.length, blocksToMake + variance));
  }
  
  // Assign blocks
  const usedDefenders = new Set();
  const usedAttackers = new Set();
  let blocksAssigned = 0;
  
  // CRITICAL FIX: When facing lethal, ensure we block as many attackers as possible
  // Don't just go by sorted value - block ALL attackers we can
  if (isLethal || isDesperate) {
    // Block each attacker with any available defender
    for (const attacker of attackers) {
      if (blocksAssigned >= blocksToMake) break;
      
      // Find any available defender for this attacker
      const availableDefender = defenders.find(d => !usedDefenders.has(d.instanceId));
      if (availableDefender) {
        game.blocking.assignments[attacker.creature.instanceId] = availableDefender;
        usedDefenders.add(availableDefender.instanceId);
        usedAttackers.add(attacker.creature.instanceId);
        blocksAssigned++;
        
        helpers.addLog([
          cardSegment(availableDefender),
          textSegment(' blocks '),
          cardSegment(attacker.creature),
          textSegment('.'),
        ]);
      }
    }
  } else {
    // Normal blocking - use sorted block options
    for (const option of blockOptions) {
      if (blocksAssigned >= blocksToMake) break;
      if (usedDefenders.has(option.defender.instanceId)) continue;
      if (usedAttackers.has(option.attacker.instanceId)) continue;
      
      game.blocking.assignments[option.attacker.instanceId] = option.defender;
      usedDefenders.add(option.defender.instanceId);
      usedAttackers.add(option.attacker.instanceId);
      blocksAssigned++;
      
      helpers.addLog([
        cardSegment(option.defender),
        textSegment(' blocks '),
        cardSegment(option.attacker),
        textSegment('.'),
      ]);
    }
  }
  
  // Log if AI chose not to block at all
  if (blocksAssigned === 0 && defenders.length > 0 && attackers.length > 0) {
    helpers.addLog([
      playerSegment(game.players[aiIndex]),
      textSegment(' chooses not to block.'),
    ]);
  }
}