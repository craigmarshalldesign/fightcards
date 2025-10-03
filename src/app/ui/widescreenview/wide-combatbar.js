import { getLocalSeatIndex } from '../../multiplayer/runtime.js';
import { getCreatureStats, hasStomp } from '../../game/creatures.js';
import { escapeHtml } from '../views/game/shared.js';
import { state, requestRender } from '../../state.js';

function renderStatLine(stats, addStrikethrough = false) {
  const attack = Math.max(stats?.attack ?? 0, 0);
  const toughness = Math.max(stats?.toughness ?? 0, 0);
  const strikeClass = addStrikethrough ? ' strikethrough' : '';
  return `<span class="cbt-stats${strikeClass}"><span class="cbt-attack">${attack}</span>/<span class="cbt-toughness">${toughness}</span></span>`;
}

function computeLifeRemaining(creature, stats) {
  const toughness = Math.max(stats?.toughness ?? 0, 0);
  const damage = Math.max(creature?.damageMarked ?? 0, 0);
  return Math.max(toughness - damage, 0);
}

function renderBlockedCombat({ attackerEntry, blocker, game, defendingIndex }) {
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

  let defenderDamage = 0;
  if (hasStomp(attackerEntry.creature) && attackerAttack > blockerLife) {
    defenderDamage = attackerAttack - blockerLife;
  }

  const attackerClass = attackerSurvives ? 'survives' : 'dies';
  const blockerClass = blockerSurvives ? 'survives' : 'dies';

  return `
    <div class="cbt-line blocked">
      <span class="cbt-creature attacker ${attackerClass}">${renderStatLine(attackerStats, !attackerSurvives)} <span class="${!attackerSurvives ? 'name-dies' : ''}">${escapeHtml(attackerEntry.creature?.name || 'Attacker')}</span></span>
      <span class="cbt-vs">→</span>
      <span class="cbt-creature blocker ${blockerClass}">${renderStatLine(blockerStats, !blockerSurvives)} <span class="${!blockerSurvives ? 'name-dies' : ''}">${escapeHtml(blocker?.name || 'Blocker')}</span></span>
      <span class="cbt-damage-badge ${defenderDamage === 0 ? 'zero' : ''}">${defenderDamage}</span>
    </div>
  `;
}

function renderUnblockedCombat({ attackerEntry, game, defendingIndex, defendingPlayer }) {
  const attackerStats = getCreatureStats(attackerEntry.creature, attackerEntry.controller, game);
  const attack = Math.max(attackerStats?.attack ?? 0, 0);
  const damagePrevented = attack <= 0 || game.preventCombatDamageFor === defendingIndex;
  const damage = damagePrevented ? 0 : attack;
  return `
    <div class="cbt-line unblocked">
      <span class="cbt-creature attacker">${renderStatLine(attackerStats, false)} <span>${escapeHtml(attackerEntry.creature?.name || 'Attacker')}</span></span>
      <span class="cbt-vs">→</span>
      <span class="cbt-damage-badge ${damagePrevented ? 'zero' : ''}">${damage}</span>
    </div>
  `;
}

function renderAttackerSummary(game) {
  const activeController = game.currentPlayer;
  const defendingIndex = activeController === 0 ? 1 : 0;
  const defendingPlayer = game.players?.[defendingIndex];
  const blockingAssignments = game.blocking?.assignments ?? {};

  const attackers = (game.combat?.attackers || []).filter((a) => a?.creature);
  if (attackers.length === 0) {
    return `<div class="cbt-empty">No attackers</div>`;
  }

  const items = attackers
    .map((entry) => {
      const assignment = blockingAssignments[entry.creature.instanceId];
      if (assignment) {
        return renderBlockedCombat({ attackerEntry: entry, blocker: assignment, game, defendingIndex });
      }
      return renderUnblockedCombat({ attackerEntry: entry, game, defendingIndex, defendingPlayer });
    })
    .join('');

  return `<div class="cbt-list">${items}</div>`;
}

export function renderWideCombatBar(game) {
  if (!game) return '';
  if (game.phase !== 'combat') return '';

  // Initialize state if needed
  if (state.ui && state.ui.wideCombatBarExpanded === undefined) {
    state.ui.wideCombatBarExpanded = true;
  }

  const summary = renderAttackerSummary(game);
  const isExpanded = state.ui?.wideCombatBarExpanded ?? true;
  const expandedClass = isExpanded ? 'expanded' : 'collapsed';

  return `
    <section class="wide-combat-bar ${expandedClass}">
      <div class="cbt-toggle" onclick="window.toggleCombatBar()">
        <span class="cbt-toggle-label">COMBAT</span>
        <span class="cbt-toggle-icon">${isExpanded ? '▼' : '▲'}</span>
      </div>
      ${isExpanded ? `<div class="cbt-body">${summary}</div>` : ''}
    </section>
  `;
}

// Export toggle function for onclick handler
if (typeof window !== 'undefined') {
  window.toggleCombatBar = function() {
    if (state.ui) {
      state.ui.wideCombatBarExpanded = !state.ui.wideCombatBarExpanded;
      requestRender();
    }
  };
}


