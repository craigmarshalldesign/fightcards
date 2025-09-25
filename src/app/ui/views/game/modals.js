import { state } from '../../../state.js';
import { renderPreviewCard } from './cards.js';

export function renderCardPreviewModal(game) {
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
