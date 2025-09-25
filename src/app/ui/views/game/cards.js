import { getCreatureStats, hasShimmer } from '../../../game/creatures.js';
import { canPlayCard } from '../../../game/core/index.js';
import { escapeHtml, formatText, sanitizeClass } from './shared.js';

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
  }

  if (chips.length === 0) return '';
  return `<div class="status-chips">${chips
    .map((c) => `<span class="status-chip ${sanitizeClass(c.variant)}">${escapeHtml(c.label)}</span>`)
    .join('')}</div>`;
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
  if (card.passive?.description) {
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
