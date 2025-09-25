export { registerPassiveHandler, triggerAttackPassive } from './passives.js';
export { startCombatStage, toggleAttacker, confirmAttackers } from './attackers.js';
export { prepareBlocks, selectBlocker, assignBlockerToAttacker, aiAssignBlocks } from './blockers.js';
export { skipCombat, resolveCombat } from './resolution.js';
export {
  describePhase,
  describePhaseDetailed,
  canSelectBlocker,
  isAttackingCreature,
  isEligibleAttacker,
  isBlockerEligible,
  getDefendingPlayerIndex,
  buildInitialAttackers,
} from './helpers.js';
