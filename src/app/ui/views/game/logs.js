import { state } from '../../../state.js';
import { describeRequirement } from '../../../game/core/index.js';
import { renderStatusChips, renderTypeBadge } from './cards.js';
import { escapeHtml, formatText, sanitizeClass } from './shared.js';

export function renderTopStatusGrid({ game, battleLogEntries, spellLogEntries }) {
  return `
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
  if (pending && (pending.type === 'ability' || pending.type === 'trigger')) {
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
  const hasPending = Boolean(pending);
  let instruction = '';
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
  const isPlayerAction = pending?.controller === 0;
  const confirmButton = isPlayerAction && pending?.awaitingConfirmation
    ? '<button data-action="confirm-pending" class="confirm">Choose</button>'
    : isPlayerAction && requirement?.allowLess
      ? `<button class="mini" data-action="confirm-targets">Confirm Targets (${selectedCount}/${requiredCount})</button>`
      : '';
  const cancelButton = isPlayerAction && pending && pending.cancellable !== false
    ? '<button class="mini cancel" data-action="cancel-action">Cancel</button>'
    : '';
  const cardText = card?.text ? `<p class="active-card-text">${formatText(card.text)}</p>` : '';
  const statusChips = card?.type === 'creature' ? renderStatusChips(card, undefined, game) : '';
  const bodyClass = card ? `card-color-${sanitizeClass(card.color ?? 'neutral')}` : 'card-color-idle';

  const cardMeta = card
    ? `<div class="active-card-title">
        <span class="name">${escapeHtml(card.name ?? 'Unknown Card')}</span>
        ${card.cost != null ? `<span class="cost"><span class="mana-gem">${escapeHtml(card.cost)}</span></span>` : ''}
      </div>
      <div class="active-card-meta">${renderTypeBadge(card)}</div>
      ${statusChips}
      ${cardText}`
    : `<div class="active-card-title">
        <span class="name">No Active Spell</span>
      </div>
      <div class="active-card-meta">
        <span class="type-badge neutral">IDLE</span>
      </div>
      <p class="active-card-text">Spells will appear here while they resolve.</p>`;

  return `
    <section class="log-panel active-spell-panel ${hasPending ? 'has-actions' : ''}">
      <div class="log-header">
        <h3>Active Spell Slot</h3>
        <button class="mini invisible" aria-hidden="true">View Full Log</button>
      </div>
      <div class="active-spell-content">
        <div class="active-spell-body ${bodyClass}">
          ${cardMeta}
          ${instruction || progressLabel ? `
            <div class="active-instructions">
              <p>${escapeHtml(instruction)}</p>
              ${progressLabel}
            </div>
          ` : ''}
        </div>
        ${hasPending ? `<div class="active-actions">${cancelButton}${confirmButton}</div>` : ''}
      </div>
    </section>
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
