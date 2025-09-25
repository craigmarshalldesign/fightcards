import { describePhase } from '../../../game/core/index.js';
import { getCreatureStats } from '../../../game/creatures.js';

export function renderGameControls({ game, shouldShowBlocking, shouldShowAttackers }) {
  return `
    <section class="game-controls">
      <div class="turn-indicator ${game.currentPlayer === 0 ? 'player-turn' : 'opponent-turn'}">
        <div class="turn-info">
          <span class="turn-number">Turn ${game.turn}</span>
          <span class="phase-name">${describePhase(game)}</span>
        </div>
        <div class="current-player">
          ${game.currentPlayer === 0 ? 'Your Turn' : 'AI Turn'}
        </div>
      </div>
      <div class="phase-controls">${renderPhaseControls(game, shouldShowAttackers)}</div>
      ${shouldShowBlocking ? renderBlocking(game.blocking, game) : ''}
      ${shouldShowAttackers ? renderAttackers(game) : ''}
    </section>
  `;
}

function renderPhaseControls(game, hideSkipCombat = false) {
  const isPlayerTurn = game.currentPlayer === 0;
  if (!isPlayerTurn) {
    return `<p class="info">AI is taking its turn...</p>`;
  }
  const buttons = [];
  const disabledAttr = game.pendingAction ? ' disabled' : '';
  if (game.phase === 'main1') {
    buttons.push(`<button data-action="end-phase"${disabledAttr}>Go to Combat</button>`);
  } else if (game.phase === 'combat' && !hideSkipCombat) {
    buttons.push(`<button data-action="skip-combat"${disabledAttr}>Skip Combat</button>`);
  } else if (game.phase === 'main2') {
    buttons.push(`<button data-action="end-phase"${disabledAttr}>End Turn</button>`);
  }
  return buttons.join('');
}

function renderBlocking(blocking, game) {
  const attackers = blocking.attackers
    .map((attacker) => {
      const stats = getCreatureStats(attacker.creature, attacker.controller, game);
      const assigned = blocking.assignments[attacker.creature.instanceId];
      const blockerName = assigned ? assigned.name : 'Unblocked';
      const statusClass = assigned ? '' : ' class="unblocked"';
      return `<li data-attacker="${attacker.creature.instanceId}">${attacker.creature.name} (${stats.attack}/${stats.toughness}) → <strong${statusClass}>${blockerName}</strong></li>`;
    })
    .join('');
  const instruction = blocking.selectedBlocker
    ? `Selected blocker: <strong>${blocking.selectedBlocker.name}</strong>. Choose an attacker to assign it, then press Declare Blocks.`
    : 'Select one of your creatures to block, tap an attacker to assign it, then press Declare Blocks.';
  return `
    <div class="pending-overlay blocking-overlay">
      <p>${instruction}</p>
      <ul>${attackers}</ul>
      <button data-action="declare-blocks">Declare Blocks</button>
    </div>
  `;
}

function renderAttackers(game) {
  const attackers = game.combat.attackers
    .map((attacker) => {
      const stats = getCreatureStats(attacker.creature, attacker.controller, game);
      return `<li data-attacker="${attacker.creature.instanceId}">${attacker.creature.name} (${stats.attack}/${stats.toughness}) - <strong class="attacking">Attacking</strong></li>`;
    })
    .join('');

  const instruction = game.combat.attackers.length > 0
    ? 'Click on creatures to remove them from attack, then press Declare Attackers to proceed.'
    : 'No creatures selected to attack. Select creatures by clicking them, then press Declare Attackers.';

  return `
    <div class="pending-overlay attacking-overlay">
      <button data-action="declare-attackers">Declare Attackers</button>
      <p>${instruction}</p>
      <ul>${attackers || '<li>No attackers selected.</li>'}</ul>
      <button data-action="skip-combat">Skip Combat</button>
    </div>
  `;
}
