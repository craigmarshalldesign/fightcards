import { getLocalSeatIndex } from '../../../multiplayer/runtime.js';
import { getCreatureStats } from '../../../game/creatures.js';
import { escapeHtml } from './shared.js';

function renderStatLine(stats) {
  const attack = Math.max(stats?.attack ?? 0, 0);
  const toughness = Math.max(stats?.toughness ?? 0, 0);
  return `
    <span class="combat-stat-line">
      <span class="combat-chip attack">${attack}</span>
      /
      <span class="combat-chip toughness">${toughness}</span>
    </span>
  `;
}

function renderCombatant(creature, stats, role, outcome) {
  const outcomeText = outcome == null ? '' : outcome ? 'Survives' : 'Destroyed';
  const outcomeMarkup = outcomeText
    ? `<span class="combat-outcome ${outcome ? 'survives' : 'destroyed'}">${outcomeText}</span>`
    : '';

  return `
    <div class="combat-column ${role}">
      <span class="combat-name">${renderStatLine(stats)} ${escapeHtml(creature?.name || 'Unknown')}</span>
      ${outcomeMarkup}
    </div>
  `;
}

function computeLifeRemaining(creature, stats) {
  const toughness = Math.max(stats?.toughness ?? 0, 0);
  const damage = Math.max(creature?.damageMarked ?? 0, 0);
  return Math.max(toughness - damage, 0);
}

function renderBlockedCombat({ attackerEntry, blocker, game, defendingIndex, defendingPlayer }) {
  const attackerStats = getCreatureStats(attackerEntry.creature, attackerEntry.controller, game);
  const blockerStats = getCreatureStats(blocker, defendingIndex, game);

  const attackerAttack = Math.max(attackerStats?.attack ?? 0, 0);
  const blockerAttack = Math.max(blockerStats?.attack ?? 0, 0);
  const attackerLife = computeLifeRemaining(attackerEntry.creature, attackerStats);
  const blockerLife = computeLifeRemaining(blocker, blockerStats);

  const preventDamageToAttacker = game.preventDamageToAttackersFor === attackerEntry.controller;
  const incomingToAttacker = preventDamageToAttacker ? 0 : blockerAttack;
  const remainingAttackerLife = Math.max(attackerLife - incomingToAttacker, 0);
  const attackerSurvives = remainingAttackerLife > 0;

  const incomingToBlocker = attackerAttack;
  const remainingBlockerLife = Math.max(blockerLife - incomingToBlocker, 0);
  const blockerSurvives = remainingBlockerLife > 0;

  const defenderDamage = 0;
  const damageChipClass = defenderDamage === 0 ? 'damage-chip defender zero' : 'damage-chip defender';

  return `
    <li class="attacker-item blocked">
      <div class="combat-row blocked">
        ${renderCombatant(attackerEntry.creature, attackerStats, 'attacker', attackerSurvives)}
        <div class="combat-arrow">➝</div>
        ${renderCombatant(blocker, blockerStats, 'blocker', blockerSurvives)}
        <div class="combat-result">
          <span class="combat-damage-label">Damage</span>
          <span class="${damageChipClass}">${defenderDamage}</span>
        </div>
      </div>
    </li>
  `;
}

function renderUnblockedCombat({ attackerEntry, game, defendingIndex, defendingPlayer }) {
  const attackerStats = getCreatureStats(attackerEntry.creature, attackerEntry.controller, game);
  const attackerAttack = Math.max(attackerStats?.attack ?? 0, 0);
  const damagePrevented =
    attackerAttack <= 0 || game.preventCombatDamageFor === defendingIndex;
  const targetName = escapeHtml(defendingPlayer?.name || 'Opponent');

  return `
    <li class="attacker-item unblocked">
      <div class="combat-row unblocked">
        <span class="combat-line">${renderStatLine(attackerStats)} ${escapeHtml(attackerEntry.creature.name || 'Attacker')} → ${targetName}</span>
        <div class="combat-result ${damagePrevented ? 'prevented' : ''}">
          <span class="combat-damage-label">Damage</span>
          <span class="damage-chip defender ${damagePrevented ? 'zero' : ''}">${damagePrevented ? 0 : attackerAttack}</span>
        </div>
      </div>
    </li>
  `;
}

function renderAttackerSummary(game) {
  if (!game?.combat || !Array.isArray(game.combat.attackers)) {
    return '';
  }

  const activeController = game.currentPlayer;
  const defendingIndex = activeController === 0 ? 1 : 0;
  const defendingPlayer = game.players?.[defendingIndex];
  const blockingAssignments = game.blocking?.assignments ?? {};

  const attackers = game.combat.attackers.filter((entry) => entry?.creature);

  if (attackers.length === 0) {
    const activeSeat = game.currentPlayer ?? 0;
    if (activeSeat === getLocalSeatIndex()) {
      return `
        <div class="attacker-summary empty">
          <div class="summary-title">No attackers selected</div>
          <p class="summary-description">Choose creatures to attack or skip combat.</p>
        </div>
      `;
    }
    return `
      <div class="attacker-summary empty">
        <div class="summary-title">Opponent is choosing attackers…</div>
        <p class="summary-description">Waiting for their selections.</p>
      </div>
    `;
  }

  const items = attackers
    .map((entry) => {
      const assignment = blockingAssignments[entry.creature.instanceId];
      if (assignment) {
        return renderBlockedCombat({
          attackerEntry: entry,
          blocker: assignment,
          game,
          defendingIndex,
          defendingPlayer,
        });
      }
      return renderUnblockedCombat({ attackerEntry: entry, game, defendingIndex, defendingPlayer });
    })
    .join('');

  return `
    <div class="attacker-summary">
      <div class="summary-title">Attacking ${escapeHtml(defendingPlayer?.name || 'opponent')}</div>
      <ul class="attacker-list">${items}</ul>
    </div>
  `;
}

export function renderGameControls({
  game,
  shouldShowBlocking,
  canDeclareBlockers,
  showDeclareAttackerActions,
  showAttackerSummary,
  showPhaseControls,
}) {
  if (!game) return '';
  const localSeatIndex = getLocalSeatIndex();
  const isLocalTurn = game.currentPlayer === localSeatIndex;

  let mainButtonLabel = 'Next Phase';
  let showPhaseButton = showPhaseControls;
  switch (game.phase) {
    case 'main1':
    mainButtonLabel = 'Go to Combat';
      break;
    case 'main2':
      mainButtonLabel = 'End Turn';
      break;
    case 'combat':
      showPhaseButton = false;
      break;
    default:
      break;
  }

  const blockingControls = shouldShowBlocking
    ? `
        <div class="control-row blockers">
          <button class="primary" data-action="declare-blockers" ${canDeclareBlockers ? '' : 'disabled'}>Declare Blockers</button>
        </div>
      `
    : '';

  const showSkipCombat = showDeclareAttackerActions && isLocalTurn;
  const attackerSummary = showAttackerSummary ? renderAttackerSummary(game) : '';
  const attackerActions = showDeclareAttackerActions
    ? `
        <div class="attacker-actions">
          <button class="primary" data-action="declare-attackers" ${!isLocalTurn ? 'disabled' : ''}>Declare Attackers</button>
          ${showSkipCombat ? `<button class="ghost" data-action="skip-combat" ${!isLocalTurn ? 'disabled' : ''}>Skip Combat</button>` : ''}
        </div>
      `
    : '';

  const attackerControls = showAttackerSummary || showDeclareAttackerActions
    ? `
        <div class="control-row attackers">
          ${attackerActions}
          ${attackerSummary}
        </div>
      `
    : '';

  const phaseControls = showPhaseButton
    ? `
        <div class="control-row phases">
          <button class="primary" data-action="end-phase" ${!isLocalTurn ? 'disabled' : ''}>${mainButtonLabel}</button>
        </div>
      `
    : '';

  return `
    <section class="game-controls">
      ${attackerControls}
      ${blockingControls}
      ${phaseControls}
    </section>
  `;
}
