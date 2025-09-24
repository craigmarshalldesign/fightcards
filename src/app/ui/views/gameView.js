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

function getCardColorClass(card) {
  return `card-color-${card?.color ?? 'neutral'}`;
}

export function renderGame() {
  const { game } = state;
  if (!game) return '';
  const player = game.players[0];
  const opponent = game.players[1];
  const recentLogEntries = getRecentLogEntries(game);
  // Always show exactly 5 entries to maintain consistent size
  const paddedEntries = [...recentLogEntries];
  while (paddedEntries.length < 5) {
    paddedEntries.push({ segments: [{ type: 'text', text: '' }] });
  }
  const recentLog = paddedEntries.map((entry) => `<li>${renderLogEntry(entry) || '&nbsp;'}</li>`).join('');
  const fullLog = getFullLog(game, recentLogEntries.length)
    .map((entry) => `<li>${renderLogEntry(entry)}</li>`)
    .join('');
  const pending = game.pendingAction;
  const blocking = game.blocking;
  const shouldShowBlocking = Boolean(blocking && game.currentPlayer === 1 && blocking.awaitingDefender);
  const shouldShowAttackers = Boolean(game.combat && game.combat.stage === 'choose' && game.currentPlayer === 0);
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
      ${renderPlayerStatBar(opponent, game, true)}
      <section class="battlefield-area">
        <div class="battle-row opponent-row">
          ${renderPlayerBoard(opponent, game, true)}
        </div>
        <div class="battle-row player-row">
          ${renderPlayerBoard(player, game, false)}
        </div>
      </section>
      ${renderPlayerStatBar(player, game, false)}
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
        ${pending ? renderPendingAction(pending) : ''}
        ${shouldShowBlocking ? renderBlocking(blocking, game) : ''}
        ${shouldShowAttackers ? renderAttackers(game) : ''}
      </section>
      ${renderAttackLines(game)}
      <section class="hand-area">
        <div class="hand-mana-section">
          <div class="mana-crystals">
            <div class="mana-crystal-row">
              ${Array.from({length: Math.max(player.maxMana, 1)}, (_, i) => `
                <div class="mana-crystal ${i < player.availableMana ? 'filled' : (i < player.maxMana ? 'available' : 'locked')}">
                  <div class="crystal-inner"></div>
                </div>
              `).join('')}
            </div>
            <div class="mana-label">${player.availableMana}/${player.maxMana} Mana</div>
          </div>
        </div>
        <header class="hand-header">
          <h3>Your Hand</h3>
          <span>${player.hand.length} cards</span>
        </header>
        <div class="hand-cards">
          ${[...player.hand].sort((a, b) => {
            const costA = a.cost ?? 0;
            const costB = b.cost ?? 0;
            if (costA !== costB) return costA - costB;
            return (a.name || '').localeCompare(b.name || '');
          }).map((card) => renderCard(card, true, game)).join('')}
        </div>
      </section>
      ${renderCardPreviewModal(game)}
    </div>
  `;
}

function renderPlayerStatBar(player, game, isOpponent) {
  const deckCount = player.deck.length;
  const handCount = player.hand.length;
  const graveCount = player.graveyard.length;
  const playerIndex = game.players.indexOf(player);
  const maxLife = 30; // Assuming max life is 30, adjust if needed
  const lifePercentage = Math.max(0, Math.min(100, (player.life / maxLife) * 100));
  const currentMana = isOpponent ? 0 : player.availableMana; // Hide opponent mana for gameplay reasons
  const maxMana = isOpponent ? 0 : player.maxMana;
  
  // Determine health color based on life percentage
  let lifeColor = 'healthy';
  if (lifePercentage <= 25) {
    lifeColor = 'critical';
  } else if (lifePercentage <= 50) {
    lifeColor = 'warning';
  }
  
  return `
    <section class="player-stat-bar ${isOpponent ? 'opponent-stat-bar' : 'player-stat-bar'}">
      <div class="stat-bar-content">
        <div class="player-identity">
          <div class="player-name">${player.name}</div>
          <div class="player-type">${isOpponent ? 'AI Opponent' : 'You'}</div>
        </div>
        
        <div class="life-orb-container">
          <div class="life-orb life-${lifeColor}" ${isOpponent ? 'id="opponent-life-orb"' : 'id="player-life-orb"'}>
            <div class="life-orb-fill" style="height: ${lifePercentage}%"></div>
            <div class="life-value">${player.life}</div>
          </div>
          <div class="life-label">Life</div>
        </div>
        
        <div class="card-counts">
          <div class="card-count-item">
            <div class="count-icon deck-icon"></div>
            <div class="count-value">${deckCount}</div>
            <div class="count-label">Deck</div>
          </div>
          <div class="card-count-item">
            <div class="count-icon hand-icon"></div>
            <div class="count-value">${handCount}</div>
            <div class="count-label">Hand</div>
          </div>
          <div class="card-count-item">
            <div class="count-icon grave-icon"></div>
            <div class="count-value">${graveCount}</div>
            <div class="count-label">Grave</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPlayerBoard(player, game, isOpponent) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const playerIndex = game.players.indexOf(player);
  return `
    <div class="board" data-player="${playerIndex}">
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
  const classes = ['card', 'creature-card', getCardColorClass(creature)];
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
  const blockingInfo = game.blocking;
  if (blockingInfo?.selectedBlocker?.instanceId === creature.instanceId) {
    classes.push('blocker-selected');
  }
  if (blockingInfo && controllerIndex === 0) {
    const isBlocking = Object.values(blockingInfo.assignments || {}).some(
      (assigned) => assigned.instanceId === creature.instanceId,
    );
    if (isBlocking) {
      classes.push('blocking-creature');
    }
  }
  if (blockingInfo && controllerIndex === 1 && blockingInfo.assignments?.[creature.instanceId]) {
    classes.push('attacker-blocked');
  }
  if (creature._dying) {
    classes.push('fading-out');
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
  const damage = creature.damageMarked || 0;
  const currentToughness = Math.max(stats.toughness - damage, 0);
  const toughnessClasses = ['stat', 'toughness'];
  if (damage > 0) {
    toughnessClasses.push('damaged');
  }
  const damageChip = damage > 0 ? `<span class="damage-chip">-${damage}</span>` : '';
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
        <span class="stat attack">${stats.attack}</span>/<span class="${toughnessClasses.join(' ')}">${currentToughness}</span>${damageChip}
      </div>
      ${abilityButtons.length ? `<div class="ability">${abilityButtons.join('')}</div>` : ''}
    </div>
  `;
}

function renderCard(card, isHand, game) {
  const playable = isHand && canPlayCard(card, 0, game);
  const classes = ['card', card.type === 'creature' ? 'creature-card' : 'spell-card', getCardColorClass(card)];
  if (playable) classes.push('playable');
  const pending = game?.pendingAction;
  if (pending && pending.card.instanceId === card.instanceId) {
    classes.push('selected');
  }
  const baseAttack = card.baseAttack ?? card.attack ?? 0;
  const baseToughness = card.baseToughness ?? card.toughness ?? 0;
  const statsMarkup = card.type === 'creature' ? `<span class="card-stats">${baseAttack}/${baseToughness}</span>` : '';
  return `
    <div class="${classes.join(' ')}" data-card="${card.instanceId}" data-location="hand">
      <div class="card-header">
        <span class="card-cost">${card.cost ?? ''}</span>
        <span class="card-name">${card.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${card.text || ''}</p>
        ${statsMarkup}
      </div>
    </div>
  `;
}

function renderPhaseControls(game, hideSkipCombat = false) {
  const isPlayerTurn = game.currentPlayer === 0;
  if (!isPlayerTurn) {
    return `<p class="info">AI is taking its turn...</p>`;
  }
  const buttons = [];
  if (game.phase === 'main1') {
    buttons.push('<button data-action="end-phase">Go to Combat</button>');
  } else if (game.phase === 'combat' && !hideSkipCombat) {
    buttons.push('<button data-action="skip-combat">Skip Combat</button>');
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
      ${pending.cancellable === false ? '' : '<button data-action="cancel-action">Cancel</button>'}
    </div>
  `;
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

function renderAttackLines(game) {
  // Only show attack lines during combat when attackers are declared
  if (!game.combat || !game.combat.attackers || game.combat.attackers.length === 0) {
    return '';
  }

  // During AI "choose" stage, hide lines to avoid stray indicators.
  // For the player's "choose" stage, show lines so selections are visible.
  if (game.combat.stage === 'choose' && game.currentPlayer === 1) {
    return '';
  }

  // Strong guard: only render lines if the current player has declared at least one attacker.
  const visibleAttackers = game.combat.attackers.filter((atk) => atk.controller === game.currentPlayer);
  if (!visibleAttackers.length) {
    return '';
  }

  const lines = visibleAttackers
    .map((attacker) => {
      const attackerId = attacker.creature.instanceId;
      const attackerController = attacker.controller;
      const defendingPlayer = attackerController === 0 ? 1 : 0;
      const assignedBlocker = game.blocking?.assignments?.[attackerId];
      const variant = assignedBlocker ? 'blocked' : 'unblocked';
      const targetId = assignedBlocker
        ? assignedBlocker.instanceId
        : defendingPlayer === 0
          ? 'player-life-orb'
          : 'opponent-life-orb';
      // Safety: never draw lines pointing to the wrong life orb for current turn
      if (!assignedBlocker) {
        if (game.currentPlayer === 1 && targetId === 'opponent-life-orb') {
          return '';
        }
        if (game.currentPlayer === 0 && targetId === 'player-life-orb') {
          return '';
        }
      }
      const targetControllerAttr = assignedBlocker ? ` data-target-controller="${defendingPlayer}"` : '';
      return `<line class="attack-line ${variant}" data-attacker="${attackerId}" data-attacker-controller="${attackerController}" data-target="${targetId}"${targetControllerAttr} x1="0" y1="0" x2="0" y2="0" />`;
    })
    .filter(Boolean)
    .join('');

  return `
    <svg class="attack-lines-svg" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <marker id="arrow-red" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
        </marker>
        <marker id="arrow-orange" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#f97316" />
        </marker>
      </defs>
      ${lines}
    </svg>
  `;
}

function renderLogEntry(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') {
    return escapeHtml(entry);
  }
  const segments = Array.isArray(entry) ? entry : entry.segments || [];
  if (!segments.length && entry.text) {
    return escapeHtml(entry.text);
  }
  return segments.map((segment) => renderLogSegment(segment)).join('');
}

function renderLogSegment(segment) {
  if (!segment) return '';
  switch (segment.type) {
    case 'player':
      return renderPlayerSegment(segment);
    case 'card':
      return renderLogCard(segment);
    case 'damage':
      return `<span class="log-value damage">${escapeHtml(segment.amount ?? segment.value ?? '')}</span>`;
    case 'heal':
      return `<span class="log-value heal">${escapeHtml(segment.amount ?? segment.value ?? '')}</span>`;
    case 'keyword':
      return `<span class="log-keyword">${escapeHtml(segment.text)}</span>`;
    case 'value': {
      const variant = sanitizeClass(segment.variant);
      const variantClass = variant ? ` ${variant}` : '';
      return `<span class="log-value${variantClass}">${escapeHtml(segment.value)}</span>`;
    }
    case 'text':
    default:
      return `<span class="log-text">${escapeHtml(segment.text ?? segment)}</span>`;
  }
}

function renderPlayerSegment(segment) {
  const colorClass = sanitizeClass(segment.color || 'neutral');
  return `<span class="log-player player-${colorClass}">${escapeHtml(segment.name)}</span>`;
}

function renderLogCard(segment) {
  const colorClass = sanitizeClass(segment.color || 'neutral');
  const typeClass = sanitizeClass(segment.cardType || 'card');
  const classes = `log-card-ref card-color-${colorClass} card-type-${typeClass}`;
  const instanceAttr = segment.instanceId ? ` data-card-ref="${escapeHtml(segment.instanceId)}"` : '';
  const snapshotAttr = segment.snapshot
    ? ` data-card-snapshot="${escapeHtml(encodeURIComponent(JSON.stringify(segment.snapshot)))}"`
    : '';
  return `<span class="${classes}"${instanceAttr}${snapshotAttr}>${escapeHtml(segment.name)}</span>`;
}

function renderCardPreviewModal(game) {
  const preview = state.ui.previewCard;
  if (!preview) return '';
  const cardFromGame = preview.instanceId ? findCardByInstance(game, preview.instanceId) : null;
  const resolvedCard = { ...(preview.snapshot || {}), ...(cardFromGame || {}) };
  const hasCard = Boolean(resolvedCard.name);
  const content = hasCard
    ? renderPreviewCard(resolvedCard)
    : '<p class="card-preview-missing">Card details unavailable.</p>';
  return `
    <div class="card-preview-overlay" data-preview-overlay="true">
      <div class="card-preview-dialog" data-preview-dialog="true">
        <button type="button" class="preview-close" data-action="close-preview" aria-label="Close preview">&times;</button>
        ${content}
      </div>
    </div>
  `;
}

function renderPreviewCard(card) {
  const typeClass = card.type === 'creature' ? 'creature-card' : 'spell-card';
  const colorClass = getCardColorClass(card);
  const attack = card.baseAttack ?? card.attack ?? 0;
  const toughness = card.baseToughness ?? card.toughness ?? 0;
  const stats = card.type === 'creature'
    ? `<div class="card-footer"><span class="stat attack">${escapeHtml(attack)}</span>/<span class="stat toughness">${escapeHtml(toughness)}</span></div>`
    : '';
  const bodyParts = [];
  if (card.text) {
    bodyParts.push(`<p class="card-text">${formatText(card.text)}</p>`);
  }
  if (card.passive?.description) {
    bodyParts.push(`<p class="card-passive">${formatText(card.passive.description)}</p>`);
  }
  if (!bodyParts.length) {
    bodyParts.push('<p class="card-text">No abilities.</p>');
  }
  return `
    <article class="card preview-card ${typeClass} ${colorClass}">
      <div class="card-header">
        <span class="card-cost">${escapeHtml(card.cost ?? '')}</span>
        <span class="card-name">${escapeHtml(card.name ?? 'Unknown Card')}</span>
      </div>
      <div class="card-body">
        ${bodyParts.join('')}
      </div>
      ${stats}
    </article>
  `;
}

function findCardByInstance(game, instanceId) {
  if (!game || !instanceId) return null;
  const zones = ['hand', 'battlefield', 'graveyard', 'deck'];
  for (const player of game.players) {
    for (const zone of zones) {
      const cards = player[zone] || [];
      const found = cards.find((card) => card.instanceId === instanceId);
      if (found) return found;
    }
  }
  if (game.pendingAction?.card?.instanceId === instanceId) {
    return game.pendingAction.card;
  }
  return null;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeClass(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}
