import { describeRequirement } from '../../game/core/index.js';
import { renderStatusChips, renderTypeBadge } from '../views/game/cards.js';
import { escapeHtml, formatText, sanitizeClass } from '../views/game/shared.js';
import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

/**
 * Renders the active spell slot for widescreen view
 * Positioned on the right side of the screen, shows currently resolving spells/abilities
 */
export function renderWideActiveSpellSlot(game) {
  const pending = game.pendingAction;
  
  // Only show this panel when an actual spell/summon is being played
  // and only during main phases
  const inMainPhase = game.phase === 'main1' || game.phase === 'main2';
  const isSpellLike = pending && (pending.type === 'spell' || pending.type === 'summon');
  if (!pending || !inMainPhase || !isSpellLike) {
    return '';
  }
  
  const card = pending?.card;
  const requirement = pending?.requirements?.[pending.requirementIndex];
  const hasPending = Boolean(pending);
  
  // Build instruction text
  let instruction = '';
  if (pending) {
    if (pending.awaitingConfirmation) {
      instruction = 'Press Choose to resolve.';
    } else if (requirement) {
      instruction = describeRequirement(requirement);
    } else if (pending.requirements?.length) {
      instruction = pending.type === 'trigger' ? 'Triggered ability resolving…' : 'Spell resolving…';
    } else {
      instruction = pending.type === 'trigger' ? 'Triggered ability resolving…' : 'Spell resolving…';
    }
  }
  
  // Calculate progress
  const selectedCount = requirement ? pending.selectedTargets.length : 0;
  const requiredCount = requirement?.count ?? 0;
  const confirmedCount = Object.values(pending?.chosenTargets || {}).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0,
  );
  
  const progressLabel = requirement
    ? `<div class="target-progress">${selectedCount}/${requiredCount}</div>`
    : pending?.awaitingConfirmation && confirmedCount > 0
      ? `<div class="target-progress">${confirmedCount} target${confirmedCount === 1 ? '' : 's'}</div>`
      : '';
  
  // Check if local player controls this action
  const localSeatIndex = getLocalSeatIndex();
  const isPlayerAction = pending?.controller === localSeatIndex;
  
  // Build action buttons
  // Show "Choose" button when:
  // 1. Awaiting final confirmation (after all requirements met)
  // 2. For single-target spells (count=1, not allowLess): show when 1+ target selected
  // 3. For optional spells (allowLess=true): show even with 0 targets selected
  const showChooseButton = isPlayerAction && (
    pending?.awaitingConfirmation ||
    (selectedCount >= requiredCount && requiredCount === 1 && !requirement?.allowLess) ||
    (requirement?.allowLess && selectedCount >= 0)
  );
  
  const confirmButton = showChooseButton
    ? '<button class="wide-spell-button primary" data-action="confirm-targets">Choose</button>'
    : '';
      
  const cancelButton = isPlayerAction && pending && pending.cancellable !== false
    ? '<button class="wide-spell-button cancel" data-action="cancel-action">Cancel</button>'
    : '';
  
  // Card information
  const cardText = card?.text ? `<p class="wide-card-text">${formatText(card.text)}</p>` : '';
  const statusChips = card?.type === 'creature' ? renderStatusChips(card, undefined, game) : '';
  const bodyClass = card ? `card-color-${sanitizeClass(card.color ?? 'neutral')}` : 'card-color-idle';
  
  const cardMeta = card
    ? `<div class="wide-card-title">
        <span class="wide-card-name">${escapeHtml(card.name ?? 'Unknown')}</span>
        ${card.cost != null ? `<span class="wide-card-cost"><span class="mana-gem">${escapeHtml(card.cost)}</span></span>` : ''}
      </div>
      <div class="wide-card-meta">${renderTypeBadge(card)}</div>
      ${statusChips}
      ${cardText}`
    : `<div class="wide-card-title">
        <span class="wide-card-name">No Active Spell</span>
      </div>
      <div class="wide-card-meta">
        <span class="type-badge neutral">IDLE</span>
      </div>
      <p class="wide-card-text">Spells appear here while resolving.</p>`;
  
  return `
    <section class="wide-active-spell-slot ${hasPending ? 'active' : 'idle'}">
      <div class="wide-spell-header">
        <h3>Active Spell</h3>
      </div>
      <div class="wide-spell-content">
        <div class="wide-spell-body ${bodyClass}">
          ${cardMeta}
          ${instruction || progressLabel ? `
            <div class="wide-spell-instructions">
              <p class="instruction-text">${escapeHtml(instruction)}</p>
              ${progressLabel}
            </div>
          ` : ''}
        </div>
        ${hasPending ? `
          <div class="wide-spell-actions">
            ${cancelButton}
            ${confirmButton}
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

