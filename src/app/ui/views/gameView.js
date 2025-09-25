import { state } from '../../state.js';
import { getLogEntries } from '../../game/log.js';
import {
  describePhase,
  describeRequirement,
  isTargetableCreature,
  isTargetablePlayer,
  canSelectBlocker,
  isAttackingCreature,
  canPlayCard,
} from '../../game/core.js';
import { getCreatureStats, hasShimmer } from '../../game/creatures.js';
import { renderBattlefieldSkin } from './battlefield/index.js';
import { renderGraveyardModal } from './graveyardView.js';

function getCardColorClass(card) {
  return `card-color-${card?.color ?? 'neutral'}`;
}

function renderTypeBadge(card) {
  const label = (card?.type || '').toString().toUpperCase();
  const variant = card?.type === 'creature' ? 'type-creature' : 'type-spell';
  return `<span class="type-badge ${variant}">${escapeHtml(label || 'CARD')}</span>`;
}

function renderDeckIcon(color) {
  const c = (color || 'neutral').toLowerCase();
  if (c === 'red') {
    // Flame icon
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="flameGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#fb923c" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <path fill="url(#flameGrad)" d="M12 2c1.5 3.5-.5 5.5-1.5 6.5-1 .9-1.5 1.9-1.5 3 0 2.5 2 4 4 4 2.2 0 4-1.8 4-4 0-2.8-2.2-4.6-3.2-6.9-.4-.9-.6-1.8-.8-2.6z"/>
        <path fill="#fde68a" opacity="0.9" d="M12 10c-.7.8-1 1.4-1 2.1 0 1.1.9 1.9 2 1.9s2-.8 2-1.9c0-1.2-1-2-1.8-3.2-.3.5-.7.8-1.2 1.1z"/>
      </svg>`;
  }
  if (c === 'blue') {
    // Water drop
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="waterGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" />
            <stop offset="100%" stop-color="#1d4ed8" />
          </linearGradient>
        </defs>
        <path fill="url(#waterGrad)" d="M12 2c3.5 5 7 7.9 7 12a7 7 0 1 1-14 0c0-4.1 3.5-7 7-12z"/>
        <circle cx="10" cy="14" r="2" fill="#bfdbfe" opacity="0.7"/>
      </svg>`;
  }
  if (c === 'green') {
    // Leaf
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="leafGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#86efac" />
            <stop offset="100%" stop-color="#22c55e" />
          </linearGradient>
        </defs>
        <path fill="url(#leafGrad)" d="M20 4c-7 0-12 4-14 8 0 5 4 8 8 8 6 0 8-7 6-16z"/>
        <path d="M8 14c2-2 6-4 10-4" stroke="#065f46" stroke-width="1.5" fill="none" opacity="0.6"/>
      </svg>`;
  }
  return '';
}

// Build status chips for a card.
// controllerIndex is required for battlefield creatures (to compute global buffs),
// but can be omitted for hand/preview contexts.
function renderStatusChips(card, controllerIndex, game) {
  if (!card || card.type !== 'creature') return '';

  const chips = [];
  const inBattlefield = Number.isInteger(controllerIndex);

  const abilities = card.abilities || {};
  const hasHaste = Boolean(abilities.haste || (inBattlefield && card.temporaryHaste));
  const shimmerActive = inBattlefield ? hasShimmer(card) : Boolean(abilities.shimmer);

  if (hasHaste) chips.push({ label: 'Haste', variant: 'haste' });
  if (shimmerActive) chips.push({ label: 'Shimmer', variant: 'shimmer' });
  if (inBattlefield && card.frozenTurns) chips.push({ label: 'Frozen', variant: 'frozen' });
  // Show Summoning only during the controller's own turn to avoid implying it blocks
  if (inBattlefield && game && game.currentPlayer === controllerIndex && card.summoningSickness && !hasHaste) {
    chips.push({ label: 'Summoning', variant: 'sickness' });
  }

  // Show net permanent/temporary power/toughness modification (ignores damage)
  if (inBattlefield) {
    const stats = getCreatureStats(card, controllerIndex, game);
    const baseA = card.baseAttack ?? card.attack ?? 0;
    const baseT = card.baseToughness ?? card.toughness ?? 0;
    const dA = stats.attack - baseA;
    const dT = stats.toughness - baseT;
    if (dA !== 0 || dT !== 0) {
      const signA = dA >= 0 ? '+' : '';
      const signT = dT >= 0 ? '+' : '';
      const label = `${dA !== 0 ? signA + dA : '+0'}/${dT !== 0 ? signT + dT : '+0'}`;
      chips.push({ label, variant: dA >= 0 && dT >= 0 ? 'buff' : 'debuff' });
    }
  } else {
    // In hand/preview: surface innate stat keywords (no deltas available)
    // Nothing extra needed here beyond ability chips above.
  }

  if (chips.length === 0) return '';
  return `<div class="status-chips">${chips
    .map((c) => `<span class="status-chip ${sanitizeClass(c.variant)}">${escapeHtml(c.label)}</span>`)
    .join('')}</div>`;
}

export function renderGame() {
  const { game } = state;
  if (!game) return '';
  const player = game.players[0];
  const opponent = game.players[1];
  const battleLogEntries = getLogEntries(game, 'battle');
  const spellLogEntries = getLogEntries(game, 'spell');
  const blocking = game.blocking;
  const shouldShowBlocking = Boolean(blocking && game.currentPlayer === 1 && blocking.awaitingDefender);
  const shouldShowAttackers = Boolean(game.combat && game.combat.stage === 'choose' && game.currentPlayer === 0);
  return `
    <div class="view game-view">
      <section class="top-status-grid">
        ${renderLogSection({
          title: 'Battle Log',
          className: 'battle-log',
          entries: battleLogEntries,
          expanded: state.ui.battleLogExpanded,
          toggleAction: 'toggle-battle-log',
          emptyMessage: 'No battle events yet.',
        })}
        ${renderActiveSpellSlot(game)}
        ${renderLogSection({
          title: 'Spell Log',
          className: 'spell-log',
          entries: spellLogEntries,
          expanded: state.ui.spellLogExpanded,
          toggleAction: 'toggle-spell-log',
          emptyMessage: 'No spell activity yet.',
        })}
      </section>
${renderPlayerStatBar(opponent, game, true)}
      <section class="battlefield-area">
        <div class="battle-row opponent-row">
          ${renderPlayerBoard(opponent, game, true)}
        </div>
        ${renderBattlefieldCrevice()}
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
        ${shouldShowBlocking ? renderBlocking(blocking, game) : ''}
        ${shouldShowAttackers ? renderAttackers(game) : ''}
      </section>
      ${renderTargetLines(game)}
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
      ${renderGraveyardModal(game)}
    </div>
  `;
}

function renderLogSection({ title, className = '', entries = [], expanded = false, toggleAction, emptyMessage }) {
  const hasEntries = entries.length > 0;
  let items;
  if (hasEntries) {
    const renderedEntries = entries.map((entry) => `<li>${renderLogEntry(entry) || '&nbsp;'}</li>`);
    const placeholders = [];
    for (let i = renderedEntries.length; i < 5; i += 1) {
      placeholders.push('<li class="log-placeholder">&nbsp;</li>');
    }
    items = [...renderedEntries, ...placeholders].join('');
  } else {
    items = `<li class="log-empty">${emptyMessage || 'No events yet.'}</li>`;
  }

  return `
    <section class="log-panel ${className}">
      <div class="log-header">
        <h3>${title}</h3>
        <button class="mini" data-action="${toggleAction}">${expanded ? 'Hide Full Log' : 'View Full Log'}</button>
      </div>
      <div class="log-scroll ${expanded ? 'expanded' : ''}">
        <ul>${items}</ul>
      </div>
    </section>
  `;
}

function renderActiveSpellSlot(game) {
  const pending = game.pendingAction;
  // Skip rendering abilities in the active slot - they handle their own UI
  if (
    pending &&
    (pending.type === 'ability' || (pending.type === 'trigger' && pending.context === 'combat-trigger'))
  ) {
    return `
      <section class="active-spell-panel empty">
        <div class="panel-header">
          <h3>Active Spell Slot</h3>
        </div>
        <div class="active-spell-body">
          <p class="active-placeholder-text">Spells will appear here while they resolve.</p>
        </div>
      </section>
    `;
  }
  const card = pending?.card;
  const requirement = pending?.requirements?.[pending.requirementIndex];
  let instruction = 'No active spell.';
  if (pending) {
    if (pending.awaitingConfirmation) {
      instruction = 'Press Choose to resolve the action.';
    } else if (requirement) {
      instruction = describeRequirement(requirement);
    } else if (pending.requirements?.length) {
      instruction = pending.type === 'trigger' ? 'Triggered ability resolving…' : 'Spell resolving…';
    } else {
      instruction = pending.type === 'trigger' ? 'Triggered ability resolving…' : 'Spell resolving…';
    }
  }

  const selectedCount = requirement ? pending.selectedTargets.length : 0;
  const requiredCount = requirement?.count ?? 0;
  const confirmedCount = Object.values(pending?.chosenTargets || {}).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0,
  );
  const progressLabel = requirement
    ? `<div class="target-progress">${selectedCount}/${requiredCount} selected</div>`
    : pending?.awaitingConfirmation && confirmedCount > 0
      ? `<div class="target-progress">${confirmedCount} target${confirmedCount === 1 ? '' : 's'} ready</div>`
      : '';
  const confirmButton = pending?.awaitingConfirmation
    ? '<button data-action="confirm-pending" class="confirm">Choose</button>'
    : requirement?.allowLess
      ? `<button class="mini" data-action="confirm-targets">Confirm Targets (${selectedCount}/${requiredCount})</button>`
      : '';
  const cancelButton = pending && pending.cancellable !== false
    ? '<button class="mini cancel" data-action="cancel-action">Cancel</button>'
    : '';
  const cardText = card?.text ? `<p class="active-card-text">${formatText(card.text)}</p>` : '';
  const statusChips = card?.type === 'creature' ? renderStatusChips(card, undefined, game) : '';
  const cardMeta = card
    ? `<div class="active-card-title">
        <span class="name">${escapeHtml(card.name ?? 'Unknown Card')}</span>
        ${card.cost != null ? `<span class="cost"><span class="mana-gem">${escapeHtml(card.cost)}</span></span>` : ''}
      </div>
      <div class="active-card-meta">${renderTypeBadge(card)}</div>
      ${statusChips}
      ${cardText}`
    : '<p class="active-placeholder-text">Spells will appear here while they resolve.</p>';

  return `
    <section class="active-spell-panel ${pending ? 'has-active' : 'empty'}">
        <div class="panel-header">
          <h3>Active Spell Slot</h3>
        </div>
      <div class="active-spell-body ${card ? `card-color-${sanitizeClass(card.color ?? 'neutral')}` : ''}">
        ${cardMeta}
        <div class="active-instructions">
          <p>${escapeHtml(instruction)}</p>
          ${progressLabel}
        </div>
      </div>
      ${pending ? `<div class="active-actions">${cancelButton}${confirmButton}</div>` : ''}
    </section>
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

  const pending = game.pendingAction;
  const isLifeTargetable = pending ? isTargetablePlayer(playerIndex, pending) : false;
  const isLifeChosen = pending
    ? Boolean(
        pending.selectedTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
          pending.previewTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
          Object.values(pending.chosenTargets || {}).some((list) =>
            (list || []).some((target) => target.type === 'player' && target.controller === playerIndex),
          ),
      )
    : false;
  const lifeOrbClasses = ['life-orb', `life-${lifeColor}`];
  if (isLifeTargetable) lifeOrbClasses.push('targetable');
  if (isLifeChosen) lifeOrbClasses.push('targeted');
  const lifeOrbId = isOpponent ? 'opponent-life-orb' : 'player-life-orb';

  const colorClass = sanitizeClass(player.color || 'neutral');
  return `
    <section class="player-stat-bar ${isOpponent ? 'opponent-stat-bar' : 'player-stat-bar'} player-color-${colorClass}">
      <div class="stat-bar-content">
        <div class="player-identity">
          <div class="player-icon">${renderDeckIcon(player.color)}</div>
          <div class="player-name">${player.name}</div>
          <div class="player-type">${isOpponent ? 'AI Opponent' : 'You'}</div>
        </div>

        <div class="life-orb-container">
          <div class="${lifeOrbClasses.join(' ')}" id="${lifeOrbId}" data-player-target="${playerIndex}">
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
          <div class="card-count-item" data-open-grave="${playerIndex}" tabindex="0" role="button" aria-label="Open graveyard">
            <div class="count-icon grave-icon"></div>
            <div class="count-value">${graveCount}</div>
            <div class="count-label">Grave</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderBattlefieldCrevice() {
  return `
    <div class="battlefield-crevice">
      <div class="crevice-surface"></div>
      <div class="crevice-fissures"></div>
    </div>
  `;
}

function renderPlayerBoard(player, game, isOpponent) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const playerIndex = game.players.indexOf(player);
  const colorClass = sanitizeClass(player.color || 'neutral');
  const skin = renderBattlefieldSkin(player.color, { isOpponent });
  return `
    <div class="board player-battlefield player-color-${colorClass}" data-player="${playerIndex}">
      ${skin}
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
  const isTargeted = pending
    ? Boolean(
        pending.selectedTargets?.some(
          (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
        ) ||
          pending.previewTargets?.some(
            (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
          ) ||
          Object.values(pending.chosenTargets || {}).some((list) =>
            (list || []).some(
              (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
            ),
          ),
      )
    : false;
  if (isTargeted) {
    classes.push('targeted');
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
  // Always show ability button if creature has an activated ability
  if (creature.activated) {
    const canActivate = controllerIndex === 0 && // Only player can activate abilities
                       !creature.activatedThisTurn && 
                       (!game.pendingAction || (game.pendingAction.type === 'ability' && game.pendingAction.card?.instanceId === creature.instanceId)) &&
                       game.players[controllerIndex].availableMana >= creature.activated.cost &&
                       (game.phase === 'main1' || game.phase === 'main2') &&
                       game.currentPlayer === controllerIndex;
    const isThisAbilityActive = game.pendingAction && game.pendingAction.card?.instanceId === creature.instanceId && game.pendingAction.type === 'ability';
    const abilityName = creature.activated.name ? `${escapeHtml(creature.activated.name)}:` : 'Ability:';
    abilityButtons.push(
      `<div class="ability-row">
         <button class="ability-button ${!canActivate ? 'disabled' : ''}" data-action="activate" data-creature="${creature.instanceId}" ${!canActivate ? 'disabled' : ''}>
           <span class="mana-gem small">${creature.activated.cost ?? 0}</span>
           <span class="ability-name">${abilityName}</span>
           <span class="ability-label">${escapeHtml(creature.activated.description)}</span>
         </button>
       </div>`,
    );
  }
  const damage = creature.damageMarked || 0;
  const currentToughness = Math.max(stats.toughness - damage, 0);
  const toughnessClasses = ['stat', 'toughness'];
  if (damage > 0) {
    toughnessClasses.push('damaged');
  }
  const damageChip = damage > 0 ? `<span class="damage-chip">-${damage}</span>` : '';
  // Add ability actions below stats if this creature has an active ability (only for player creatures)
  const isThisAbilityActive = controllerIndex === 0 && game.pendingAction && game.pendingAction.card?.instanceId === creature.instanceId && game.pendingAction.type === 'ability';
  const abilityActions = isThisAbilityActive ? `
    <div class="creature-ability-actions">
      <button class="mini cancel" data-action="cancel-action">Cancel</button>
      ${(() => {
        const req = game.pendingAction.requirements?.[game.pendingAction.requirementIndex];
        const selectedCount = game.pendingAction.selectedTargets?.length || 0;
        const requiredCount = req?.count || 0;
        const hasRequiredTargets = !req || selectedCount >= requiredCount;
        
        if (game.pendingAction.awaitingConfirmation || hasRequiredTargets) {
          return '<button class="mini" data-action="confirm-pending">Choose</button>';
        } else {
          return '<button class="mini disabled" disabled>Choose</button>';
        }
      })()}
    </div>
    <div class="ability-status">
      ${(() => {
        const req = game.pendingAction.requirements?.[game.pendingAction.requirementIndex];
        const selectedCount = game.pendingAction.selectedTargets?.length || 0;
        const requiredCount = req?.count || 0;
        
        if (!req) {
          return 'Ready to activate';
        } else if (selectedCount === 0) {
          return `Select ${requiredCount} target${requiredCount > 1 ? 's' : ''}`;
        } else {
          return `${selectedCount}/${requiredCount} selected`;
        }
      })()}
    </div>
  ` : '';

  const isTriggerPendingForThis =
    pending &&
    pending.type === 'trigger' &&
    pending.context === 'combat-trigger' &&
    pending.card?.instanceId === creature.instanceId &&
    pending.controller === controllerIndex;

  const triggerActions = isTriggerPendingForThis && controllerIndex === 0 ? `
    <div class="creature-ability-actions">
      <button class="mini cancel" data-action="cancel-action">Cancel</button>
      ${(() => {
        const req = pending.requirements?.[pending.requirementIndex];
        const selectedCount = pending.selectedTargets?.length || 0;
        const requiredCount = req?.count || 0;
        const hasRequiredTargets = !req || selectedCount >= requiredCount;

        if (pending.awaitingConfirmation || hasRequiredTargets) {
          return '<button class="mini" data-action="confirm-pending">Choose</button>';
        }
        return '<button class="mini disabled" disabled>Choose</button>';
      })()}
    </div>
    <div class="ability-status">
      ${(() => {
        const req = pending.requirements?.[pending.requirementIndex];
        const selectedCount = pending.selectedTargets?.length || 0;
        const requiredCount = req?.count || 0;

        if (!req) {
          return 'Ready to resolve';
        }
        if (selectedCount === 0) {
          return `Select ${requiredCount} target${requiredCount > 1 ? 's' : ''}`;
        }
        return `${selectedCount}/${requiredCount} selected`;
      })()}
    </div>
  ` : '';

  return `
    <div class="${classes.join(' ')}" data-card="${creature.instanceId}" data-controller="${controllerIndex}">
      <div class="card-header">
        <span class="card-cost"><span class="mana-gem">${creature.cost ?? ''}</span></span>
        <span class="card-name">${creature.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${creature.text || ''}</p>
        ${creature.passive ? `<p class="card-passive">${creature.passive.description}</p>` : ''}
        ${renderStatusChips(creature, controllerIndex, game)}
      </div>
      ${abilityButtons.length ? `<div class="ability">${abilityButtons.join('')}</div>` : ''}
      ${abilityActions}
      ${triggerActions}
      <div class="card-footer">
        <span class="stat attack">${stats.attack}</span>/<span class="${toughnessClasses.join(' ')}">${currentToughness}</span>${damageChip}
      </div>
    </div>
  `;
}

function renderCard(card, isHand, game) {
  const playable = isHand && !game?.pendingAction && canPlayCard(card, 0, game);
  const classes = ['card', card.type === 'creature' ? 'creature-card' : 'spell-card', getCardColorClass(card)];
  if (playable) classes.push('playable');
  const pending = game?.pendingAction;
  if (pending && pending.card.instanceId === card.instanceId) {
    classes.push('selected');
  }
  // Visually and interactively disable hand cards while a pending action exists
  if (pending && isHand) {
    classes.push('disabled');
  }
  const baseAttack = card.baseAttack ?? card.attack ?? 0;
  const baseToughness = card.baseToughness ?? card.toughness ?? 0;

  // Show activated abilities in small text for hand/graveyard/preview cards
  const activatedAbilityText = card.activated ?
    `<p class="card-ability-preview">${escapeHtml(card.activated.name || 'Ability')}: ${escapeHtml(card.activated.description)}</p>` : '';
  const triggeredAbilityText = card.passive?.type === 'onAttack'
    ? `<p class="card-triggered-preview">Triggered — ${escapeHtml(card.passive.description)}</p>`
    : '';

  return `
    <div class="${classes.join(' ')}" data-card="${card.instanceId}" data-location="hand">
      <div class="card-header">
        <span class="card-cost"><span class="mana-gem">${card.cost ?? ''}</span></span>
        <span class="card-name">${card.name}</span>
      </div>
      <div class="card-subtitle">${renderTypeBadge(card)}</div>
      <div class="card-body">
        <p class="card-text">${card.text || ''}</p>
        ${activatedAbilityText}
        ${triggeredAbilityText}
        ${card.type === 'creature' ? renderStatusChips(card, undefined, game) : ''}
      </div>
      ${card.type === 'creature' ? `<div class="card-footer"><span class="stat attack">${baseAttack}</span>/<span class="stat toughness">${baseToughness}</span></div>` : ''}
    </div>
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

function renderTargetLines(game) {
  const pending = game.pendingAction;
  if (!pending) return '';

  const treatAsAbilitySource = pending.type === 'ability' || (pending.type === 'trigger' && pending.context === 'combat-trigger');

  const targets = [];
  const seen = new Set();

  const pushTargets = (list = [], variant) => {
    list.forEach((target) => {
      if (!target) return;
      let key;
      if (target.type === 'player') {
        key = `player-${target.controller}`;
      } else if (target.creature?.instanceId) {
        key = `creature-${target.creature.instanceId}`;
      }
      if (!key) return;
      if (variant !== 'preview' && seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({ target, variant });
    });
  };

  if (pending.previewTargets?.length) {
    pushTargets(pending.previewTargets, 'preview');
  }

  const requirement = pending.requirements?.[pending.requirementIndex];
  if (requirement && pending.selectedTargets?.length) {
    pushTargets(pending.selectedTargets, 'active');
    Object.entries(pending.chosenTargets || {}).forEach(([effectIndex, list]) => {
      if (Number.parseInt(effectIndex, 10) !== requirement.effectIndex) {
        pushTargets(list, 'confirmed');
      }
    });
  } else if (pending.awaitingConfirmation) {
    Object.values(pending.chosenTargets || {}).forEach((list) => {
      pushTargets(list, 'confirmed');
    });
  }

  if (!targets.length) {
    return '';
  }

  const lines = targets
    .map(({ target, variant }) => {
      let targetId = '';
      let controllerAttr = '';
      if (target.type === 'player') {
        targetId = target.controller === 0 ? 'player-life-orb' : 'opponent-life-orb';
        controllerAttr = ` data-target-controller="${target.controller}"`;
      } else if (target.creature?.instanceId) {
        targetId = target.creature.instanceId;
        controllerAttr = ` data-target-controller="${target.controller}"`;
      }
      if (!targetId) return '';
      const variantClass = variant ? ` ${variant}` : '';
      const abilityClass = treatAsAbilitySource ? ' ability' : '';
      return `<line class="target-line${variantClass}${abilityClass}" data-target="${targetId}"${controllerAttr} x1="0" y1="0" x2="0" y2="0" />`;
    })
    .filter(Boolean)
    .join('');

  if (!lines) return '';

  return `
    <svg class="target-lines-svg" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <marker id="arrow-blue" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" />
        </marker>
        <marker id="arrow-green" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#22c55e" />
        </marker>
      </defs>
      ${lines}
    </svg>
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
  if (card.activated) {
    bodyParts.push(`<p class="card-ability-preview">${escapeHtml(card.activated.name || 'Ability')}: ${escapeHtml(card.activated.description)}</p>`);
  }
  if (card.passive?.type === 'onAttack') {
    bodyParts.push(`<p class="card-triggered-preview">Triggered — ${escapeHtml(card.passive.description)}</p>`);
  }
  if (card.passive?.description && card.passive?.type !== 'onAttack') {
    bodyParts.push(`<p class="card-passive">${formatText(card.passive.description)}</p>`);
  }
  if (!bodyParts.length) {
    bodyParts.push('<p class="card-text">No abilities.</p>');
  }
  return `
    <article class="card preview-card ${typeClass} ${colorClass}">
      <div class="card-header">
        <span class="card-cost"><span class="mana-gem">${escapeHtml(card.cost ?? '')}</span></span>
        <span class="card-name">${escapeHtml(card.name ?? 'Unknown Card')}</span>
      </div>
      <div class="card-subtitle">${renderTypeBadge(card)}</div>
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
