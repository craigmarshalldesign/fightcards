import { state } from '../../state.js';
import { getCreatureStats } from '../creatures.js';

export function createCreatureTarget(creature, controller) {
  return { type: 'creature', creature, controller };
}

export function createPlayerTarget(controller) {
  const player = state.game?.players?.[controller] || null;
  return { type: 'player', controller, player };
}

const TARGETABLE_EFFECT_TYPES = new Set([
  'bounce',
  'buff',
  'temporaryBuff',
  'freeze',
  'heal',
  'grantShimmer',
  'damage',
  'massBounce',
]);
const FRIENDLY_EFFECT_TYPES = new Set(['buff', 'temporaryBuff', 'heal', 'grantShimmer']);
const TARGETABLE_TARGETS = new Set(['friendly-creature', 'enemy-creature', 'any-creature', 'creature', 'any']);

export function effectRequiresChoice(effect) {
  if (!effect) return false;
  if (!TARGETABLE_TARGETS.has(effect.target)) return false;
  if (effect.target === 'any' && effect.type !== 'damage') {
    return false;
  }
  return TARGETABLE_EFFECT_TYPES.has(effect.type);
}

export function buildEffectRequirements(effects = []) {
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
        if (['friendly-creature', 'any-creature', 'creature'].includes(effect.target)) {
          const target = effect.target === 'creature' ? 'creature' : effect.target;
          reqs.push({ ...requirementBase, count: 1, target });
        }
        break;
      }
      case 'grantShimmer': {
        if (['friendly-creature', 'any-creature', 'creature'].includes(effect.target)) {
          const target = effect.target === 'creature' ? 'creature' : effect.target;
          reqs.push({ ...requirementBase, count: 1, target });
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
      case 'massBounce': {
        if (effect.target === 'enemy-creature' || effect.target == null) {
          const amount = Number.isFinite(effect.amount) ? effect.amount : 1;
          reqs.push({
            ...requirementBase,
            count: amount,
            target: 'enemy-creature',
            allowLess: true,
          });
        }
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

export function getValidTargetsForRequirement(requirement, controllerIndex, sourceCard) {
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

export function autoSelectTargetsForRequirement(requirement, controllerIndex, sourceCard) {
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
      
      // CRITICAL: For damage effects with player targeting, prefer face unless we can kill a creature
      if (requirement.effect?.type === 'damage' && requirement.allowPlayers) {
        const damageAmount = requirement.effect.amount || 0;
        const opponentCreatures = opponent.battlefield.filter(c => c.type === 'creature');
        
        // Find creatures we can actually kill
        const killableCreatures = opponentCreatures.filter(creature => {
          const stats = getCreatureStats(creature, opponentIndex, state.game);
          const hp = stats.toughness - (creature.damageMarked || 0);
          return damageAmount >= hp;
        });
        
        if (killableCreatures.length > 0) {
          // We can kill a creature - target the biggest one
          killableCreatures.sort((a, b) => {
            const aStats = getCreatureStats(a, opponentIndex, state.game);
            const bStats = getCreatureStats(b, opponentIndex, state.game);
            const aThreat = aStats.attack * 2 + aStats.toughness;
            const bThreat = bStats.attack * 2 + bStats.toughness;
            return bThreat - aThreat;
          });
          return [{ type: 'creature', creature: killableCreatures[0], controller: opponentIndex }];
        } else {
          // Can't kill anything - hit face for guaranteed damage
          return [createPlayerTarget(opponentIndex)];
        }
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

export function isTargetValid(target, requirement, pending) {
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
