import { state, requestRender } from '../../state.js';
import { prepareBlocks } from './blockers.js';
import { triggerAttackPassive } from './passives.js';

const TRIGGER_ADVANCE_DELAY = 400;

function finalizeTriggerStage() {
  const game = state.game;
  if (!game?.combat) return;
  const options = game.combat.triggerOptions;
  game.combat.stage = 'blockers';
  game.combat.activeTrigger = null;
  game.combat.pendingTriggers = [];
  game.combat.resolvingTrigger = false;
  delete game.combat.triggerOptions;
  requestRender();
  prepareBlocks();
  const latestGame = state.game;
  if (options?.onComplete && !latestGame?.blocking) {
    options.onComplete();
  }
}

function scheduleNextTrigger() {
  const game = state.game;
  if (!game?.combat) return;
  if (game.combat.pendingTriggers.length === 0) {
    finalizeTriggerStage();
    return;
  }
  setTimeout(() => {
    processNextTrigger();
  }, TRIGGER_ADVANCE_DELAY);
}

function processNextTrigger() {
  const game = state.game;
  if (!game?.combat) return;
  if (game.combat.resolvingTrigger) return;
  const next = game.combat.pendingTriggers.shift();
  if (!next) {
    finalizeTriggerStage();
    return;
  }
  game.combat.activeTrigger = next;
  game.combat.resolvingTrigger = true;
  triggerAttackPassive(next.creature, next.controller);
  if (!state.game.pendingAction && game.combat.resolvingTrigger) {
    completeCurrentTrigger();
  }
}

function completeCurrentTrigger() {
  const game = state.game;
  if (!game?.combat) return;
  if (!game.combat.resolvingTrigger) return;
  game.combat.activeTrigger = null;
  game.combat.resolvingTrigger = false;
  requestRender();
  scheduleNextTrigger();
}

export function startTriggerStage(options = {}) {
  const game = state.game;
  if (!game?.combat) return;
  const queue = (game.combat.attackers || [])
    .filter((entry) => entry?.creature?.passive?.type === 'onAttack')
    .map((entry) => ({ creature: entry.creature, controller: entry.controller }));

  game.combat.pendingTriggers = queue;
  game.combat.activeTrigger = null;
  game.combat.resolvingTrigger = false;
  game.combat.triggerOptions = options;

  if (queue.length === 0) {
    finalizeTriggerStage();
    return;
  }

  game.combat.stage = 'triggers';
  requestRender();
  processNextTrigger();
}

export function notifyTriggerResolved() {
  completeCurrentTrigger();
}

