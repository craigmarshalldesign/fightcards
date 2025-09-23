import { state } from '../../state.js';
import { getRecentLogEntries, getFullLog } from '../../game/log.js';
import {
  describePhase,
  describeRequirement,
  isTargetableCreature,
  canSelectBlocker,
  isAttackingCreature,
  canPlayCard,
} from '../../game/core.js';
import { getCreatureStats } from '../../game/creatures.js';

export function renderGame() {
  const { game } = state;
  if (!game) return '';
  const player = game.players[0];
  const opponent = game.players[1];
  const recentLog = getRecentLogEntries(game).map((entry) => `<li>${entry}</li>`).join('');
  const fullLog = getFullLog(game).map((entry) => `<li>${entry}</li>`).join('');
  const pending = game.pendingAction;
  const blocking = game.blocking;
  return `
    <div class="view game-view">
      <section class="log-panel">
        <div class="log-header">
          <h3>Battle Log</h3>
          <button class="mini" data-action="toggle-log">${state.ui.logExpanded ? 'Hide Full Log' : 'View Full Log'}</button>
        </div>
        <ul class="log-recent">${recentLog || '<li>No events yet.</li>'}</ul>
        <div class="log-dropdown ${state.ui.logExpanded ? 'open' : ''}">
          <div class="log-scroll">
            <ul>${fullLog || '<li>No events yet.</li>'}</ul>
          </div>
        </div>
      </section>
      <section class="battlefield-area">
        <div class="battle-row opponent-row">
          ${renderPlayerBoard(opponent, game, true)}
        </div>
        <div class="battle-row player-row">
          ${renderPlayerBoard(player, game, false)}
        </div>
      </section>
      <section class="status-bar">
        <div class="life-summary">
          <span>Opponent Life: ${opponent.life}</span>
          <span>Your Life: ${player.life}</span>
        </div>
        <div class="turn-summary">
          <span>Turn ${game.turn}</span>
          <span>${describePhase(game)}</span>
          <span>Mana ${player.availableMana}/${player.maxMana}</span>
        </div>
        <div class="phase-controls">${renderPhaseControls(game)}</div>
        ${pending ? renderPendingAction(pending) : ''}
        ${blocking ? renderBlocking(blocking, game) : ''}
      </section>
      <section class="hand-area">
        <header class="hand-header">
          <h3>Your Hand</h3>
          <span>${player.hand.length} cards</span>
        </header>
        <div class="hand-cards">
          ${player.hand.map((card) => renderCard(card, true, game)).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderPlayerBoard(player, game, isOpponent) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const deckCount = player.deck.length;
  const handCount = player.hand.length;
  const graveCount = player.graveyard.length;
  const playerIndex = game.players.indexOf(player);
  return `
    <div class="board" data-player="${playerIndex}">
      <div class="player-header ${isOpponent ? 'opponent' : ''}">
        <div class="player-name">${player.name}</div>
        <div class="player-stats">Deck ${deckCount} · Hand ${handCount} · Grave ${graveCount}</div>
      </div>
      <div class="battlefield">
        ${
          creatures.length
            ? creatures.map((creature) => renderCreature(creature, playerIndex, game)).join('')
            : '<p class="placeholder">No creatures</p>'
        }
      </div>
    </div>
  `;
}

function renderCreature(creature, controllerIndex, game) {
  const stats = getCreatureStats(creature, controllerIndex, game);
  const classes = ['card', 'creature-card'];
  if (creature.summoningSickness) classes.push('summoning');
  if (creature.frozenTurns) classes.push('frozen');
  const pending = game.pendingAction;
  if (pending && isTargetableCreature(creature, controllerIndex, pending)) {
    classes.push('targetable');
  }
  if (game.blocking && canSelectBlocker(creature, controllerIndex, game)) {
    classes.push('blocker-selectable');
  }
  if (game.combat && isAttackingCreature(creature, controllerIndex, game)) {
    classes.push('attacker-card');
  }
  const abilityButtons = [];
  if (
    controllerIndex === 0 &&
    creature.activated &&
    !creature.activatedThisTurn &&
    (game.phase === 'main1' || game.phase === 'main2') &&
    game.currentPlayer === controllerIndex &&
    game.players[controllerIndex].availableMana >= creature.activated.cost
  ) {
    abilityButtons.push(
      `<button class="mini" data-action="activate" data-creature="${creature.instanceId}">${creature.activated.description}</button>`,
    );
  }
  return `
    <div class="${classes.join(' ')}" data-card="${creature.instanceId}" data-controller="${controllerIndex}">
      <div class="card-header">
        <span class="card-cost">${creature.cost ?? ''}</span>
        <span class="card-name">${creature.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${creature.text || ''}</p>
        ${creature.passive ? `<p class="card-passive">${creature.passive.description}</p>` : ''}
      </div>
      <div class="card-footer">
        <span>${stats.attack}/${stats.toughness}</span>
      </div>
      ${abilityButtons.length ? `<div class="ability">${abilityButtons.join('')}</div>` : ''}
    </div>
  `;
}

function renderCard(card, isHand, game) {
  const playable = isHand && canPlayCard(card, 0, game);
  const classes = ['card', card.type === 'creature' ? 'creature-card' : 'spell-card'];
  if (playable) classes.push('playable');
  const pending = game?.pendingAction;
  if (pending && pending.card.instanceId === card.instanceId) {
    classes.push('selected');
  }
  return `
    <div class="${classes.join(' ')}" data-card="${card.instanceId}" data-location="hand">
      <div class="card-header">
        <span class="card-cost">${card.cost ?? ''}</span>
        <span class="card-name">${card.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${card.text || ''}</p>
        ${card.type === 'creature' ? `<span class="card-stats">${card.baseAttack}/${card.baseToughness}</span>` : ''}
      </div>
    </div>
  `;
}

function renderPhaseControls(game) {
  const isPlayerTurn = game.currentPlayer === 0;
  if (!isPlayerTurn) {
    return `<p class="info">AI is taking its turn...</p>`;
  }
  const buttons = [];
  if (game.phase === 'main1') {
    buttons.push('<button data-action="end-phase">Go to Combat</button>');
  } else if (game.phase === 'combat') {
    if (!game.combat || game.combat.stage === 'declare') {
      buttons.push('<button data-action="declare-attackers">Begin Attack</button>');
    } else if (game.combat.stage === 'choose') {
      buttons.push('<button data-action="resolve-attacks">Declare Attackers</button>');
    } else {
      buttons.push('<button data-action="skip-combat">Skip Combat</button>');
    }
  } else if (game.phase === 'main2') {
    buttons.push('<button data-action="end-phase">End Turn</button>');
  }
  return buttons.join('');
}

function renderPendingAction(pending) {
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return '';
  return `
    <div class="pending-overlay">
      <p>${describeRequirement(requirement)}</p>
      ${requirement.count > 1 ? `<button data-action="confirm-targets">Confirm targets (${pending.selectedTargets.length}/${requirement.count})</button>` : ''}
      <button data-action="cancel-action">Cancel</button>
    </div>
  `;
}

function renderBlocking(blocking, game) {
  const attackers = blocking.attackers
    .map((attacker) => {
      const stats = getCreatureStats(attacker.creature, attacker.controller, game);
      const assigned = blocking.assignments[attacker.creature.instanceId];
      const blockerName = assigned ? assigned.name : 'Unblocked';
      return `<li data-attacker="${attacker.creature.instanceId}">${attacker.creature.name} (${stats.attack}/${stats.toughness}) → <strong>${blockerName}</strong></li>`;
    })
    .join('');
  const instructions =
    game.players[1].isAI && game.currentPlayer === 0
      ? 'Select attackers then press Declare Attackers.'
      : 'Select one of your creatures to block, then choose an attacker.';
  return `
    <div class="pending-overlay">
      <p>${instructions}</p>
      <ul>${attackers}</ul>
      ${game.currentPlayer === 1 ? '<button data-action="resolve-blocks">Resolve Combat</button>' : ''}
    </div>
  `;
}
