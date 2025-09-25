import { state, requestRender } from '../../state.js';
import { addLog, cardSegment, textSegment } from '../log.js';
import { triggerAttackPassive } from './passives.js';
import { buildInitialAttackers, isEligibleAttacker } from './helpers.js';
import { skipCombat } from './resolution.js';
import { prepareBlocks } from './blockers.js';

export function startCombatStage() {
  const game = state.game;
  const currentPlayerIndex = game.currentPlayer ?? 0;
  const currentPlayer = game.players[currentPlayerIndex];

  const eligibleAttackers = currentPlayer.battlefield.filter(isEligibleAttacker);

  game.combat = {
    attackers:
      currentPlayerIndex === 0 ? buildInitialAttackers(eligibleAttackers, 0) : [],
    stage: 'choose',
  };
  game.blocking = null;

  addLog('Combat begins.');

  if (currentPlayerIndex === 0) {
    if (eligibleAttackers.length > 0) {
      addLog(`${eligibleAttackers.length} creature(s) ready to attack.`);
    } else {
      addLog('No creatures available to attack.');
    }
  }
}

export function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (game.combat.stage !== 'choose') {
    addLog('Attackers have already been declared.');
    requestRender();
    return;
  }
  if (!isEligibleAttacker(creature)) {
    const reason = creature.frozenTurns > 0 ? ' is frozen and cannot attack this turn.' : ' cannot attack this turn.';
    addLog([cardSegment(creature), textSegment(reason)]);
    requestRender();
    return;
  }
  const existing = game.combat.attackers.find((atk) => atk.creature.instanceId === creature.instanceId);
  if (existing) {
    game.combat.attackers = game.combat.attackers.filter((atk) => atk.creature.instanceId !== creature.instanceId);
  } else {
    game.combat.attackers.push({ creature, controller: 0 });
    triggerAttackPassive(creature, 0);
  }
  requestRender();
}

export function confirmAttackers() {
  const game = state.game;
  if (!game.combat || game.combat.attackers.length === 0) {
    addLog('No attackers declared.');
    skipCombat();
    return;
  }
  if (game.combat.stage !== 'choose') {
    addLog('Attackers already declared.');
    requestRender();
    return;
  }
  addLog(`Attacking with ${game.combat.attackers.length} creature(s).`);
  game.combat.stage = 'blockers';
  prepareBlocks();
}
