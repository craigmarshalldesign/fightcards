import { getCreatureStats, getCounterTotals, hasShimmer } from '../../../game/creatures.js';
import { canPlayCard } from '../../../game/core/index.js';
import { escapeHtml, formatText, sanitizeClass, getPassivePreviewInfo } from './shared.js';

export function getCardColorClass(card) {
  return `card-color-${card?.color ?? 'neutral'}`;
}

export function renderTypeBadge(card) {
  const label = (card?.type || '').toString().toUpperCase();
  const variant = card?.type === 'creature' ? 'type-creature' : 'type-spell';
  return `<span class="type-badge ${variant}">${escapeHtml(label || 'CARD')}</span>`;
}

export function renderStatusChips(card, controllerIndex, game) {
  if (!card || card.type !== 'creature') return '';

  const chips = [];
  const inBattlefield = Number.isInteger(controllerIndex);

  const abilities = card.abilities || {};
  const hasHaste = Boolean(abilities.haste || (inBattlefield && card.temporaryHaste));
  const shimmerActive = inBattlefield ? hasShimmer(card) : Boolean(abilities.shimmer);

  if (hasHaste) chips.push({ label: 'Haste', variant: 'haste' });
  if (shimmerActive) chips.push({ label: 'Shimmer', variant: 'shimmer' });
  if (inBattlefield && card.frozenTurns) chips.push({ label: 'Frozen', variant: 'frozen' });
  if (inBattlefield && game && game.currentPlayer === controllerIndex && card.summoningSickness && !hasHaste) {
    chips.push({ label: 'Summoning', variant: 'sickness' });
  }

  if (inBattlefield) {
    const counters = getCounterTotals(card, controllerIndex, game);
    const permanentLabel = formatCounterLabel(counters.permanent);
    if (permanentLabel) {
      chips.push({ label: permanentLabel, variant: 'counter-permanent' });
    }
    const temporaryLabel = formatCounterLabel(counters.temporary);
    if (temporaryLabel) {
      chips.push({ label: temporaryLabel, variant: 'counter-temporary' });
    }
  } else {
    const counters = getCounterTotals(card);
    const permanentLabel = formatCounterLabel(counters.permanent);
    if (permanentLabel) {
      chips.push({ label: permanentLabel, variant: 'counter-permanent' });
    }
  }

  if (chips.length === 0) return '';
  return `<div class="status-chips">${chips
    .map((c) => `<span class="status-chip ${sanitizeClass(c.variant)}">${escapeHtml(c.label)}</span>`)
    .join('')}</div>`;
}

function formatCounterLabel(counter = { attack: 0, toughness: 0 }) {
  if (!counter) return '';
  const { attack = 0, toughness = 0 } = counter;
  if (attack === 0 && toughness === 0) {
    return '';
  }
  return `${formatCounterValue(attack)}/${formatCounterValue(toughness)}`;
}

function formatCounterValue(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '+0';
}

export function renderCard(card, isHand, game) {
  const playable = isHand && !game?.pendingAction && canPlayCard(card, 0, game);
  const classes = ['card', card.type === 'creature' ? 'creature-card' : 'spell-card', getCardColorClass(card)];
  if (playable) classes.push('playable');
  const pending = game?.pendingAction;
  if (pending && pending.card.instanceId === card.instanceId) {
    classes.push('selected');
  }
  if (pending && isHand) {
    classes.push('disabled');
  }
  const baseAttack = card.baseAttack ?? card.attack ?? 0;
  const baseToughness = card.baseToughness ?? card.toughness ?? 0;
  const activatedAbilityText = card.activated
    ? `<p class="card-ability-preview">${escapeHtml(card.activated.name || 'Ability')}: ${escapeHtml(card.activated.description)}</p>`
    : '';
  const passiveInfo = getPassivePreviewInfo(card.passive);
  const passiveAbilityText = passiveInfo
    ? `<p class="card-passive-preview">${passiveInfo.label ? `${escapeHtml(passiveInfo.label)}: ` : ''}${escapeHtml(
        passiveInfo.description,
      )}</p>`
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
        ${passiveAbilityText}
        ${card.type === 'creature' ? renderStatusChips(card, undefined, game) : ''}
      </div>
      ${card.type === 'creature' ? `<div class="card-footer"><span class="stat attack">${baseAttack}</span>/<span class="stat toughness">${baseToughness}</span></div>` : ''}
    </div>
  `;
}

export function renderPreviewCard(card) {
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
  const passiveInfo = getPassivePreviewInfo(card.passive);
  if (passiveInfo) {
    bodyParts.push(
      `<p class="card-passive-preview">${passiveInfo.label ? `${escapeHtml(passiveInfo.label)}: ` : ''}${formatText(
        passiveInfo.description,
      )}</p>`,
    );
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
