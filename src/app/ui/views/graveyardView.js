import { state } from '../../state.js';

export function renderGraveyardModal(game) {
  const controller = state.ui.openGraveFor;
  if (controller === null || controller === undefined) return '';
  const player = game?.players?.[controller];
  if (!player) return '';

  const cards = [...(player.graveyard || [])];
  const title = controller === 0 ? 'Your Graveyard' : `${player.name}'s Graveyard`;

  const items = cards.length
    ? cards
        .map((card) => {
          const typeClass = card.type === 'creature' ? 'creature-card' : 'spell-card';
          const colorClass = `card-color-${card?.color ?? 'neutral'}`;
          const baseAttack = card.baseAttack ?? card.attack ?? 0;
          const baseToughness = card.baseToughness ?? card.toughness ?? 0;
          const stats =
            card.type === 'creature'
              ? `<div class="card-footer"><span class="stat attack">${baseAttack}</span>/<span class="stat toughness">${baseToughness}</span></div>`
              : '';
          const bodyParts = [];
          if (card.text) {
            bodyParts.push(`<p class="card-text">${escapeHtml(card.text)}</p>`);
          }
          if (card.activated) {
            bodyParts.push(`<p class="card-ability-preview">${escapeHtml(card.activated.name || 'Ability')}: ${escapeHtml(card.activated.description)}</p>`);
          }
          if (card.passive?.type === 'onAttack') {
            bodyParts.push(`<p class="card-triggered-preview">Triggered — ${escapeHtml(card.passive.description)}</p>`);
          }
          const body = bodyParts.join('');
          return `
            <article class="card ${typeClass} ${colorClass}">
              <div class="card-header">
                <span class="card-cost"><span class="mana-gem">${escapeHtml(card.cost ?? '')}</span></span>
                <span class="card-name">${escapeHtml(card.name ?? 'Card')}</span>
              </div>
              <div class="card-subtitle"><span class="type-badge ${card.type === 'creature' ? 'type-creature' : 'type-spell'}">${escapeHtml((card.type || '').toString().toUpperCase())}</span></div>
              <div class="card-body">${body}</div>
              ${stats}
            </article>
          `;
        })
        .join('')
    : '<p class="card-preview-missing">No cards in graveyard.</p>';

  return `
    <div class="graveyard-overlay">
      <div class="graveyard-dialog" data-grave-dialog="true">
        <div class="graveyard-header">
          <h3>${escapeHtml(title)}</h3>
          <button class="preview-close" data-action="close-graveyard" aria-label="Close graveyard">&times;</button>
        </div>
        <div class="graveyard-grid">${items}</div>
      </div>
    </div>
  `;
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


