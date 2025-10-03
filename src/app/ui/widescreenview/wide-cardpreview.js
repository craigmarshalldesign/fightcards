import { renderCard } from '../views/game/cards.js';
import { state } from '../../state.js';

/**
 * Renders a static container for the card preview
 * The content will be updated via DOM manipulation on hover (no re-render)
 */
export function renderWideCardPreview() {
  return `
    <div class="wide-card-preview-container" id="wide-card-preview">
      <div class="wide-card-preview" id="wide-card-preview-content">
        <!-- Card content injected on hover -->
      </div>
    </div>
  `;
}

/**
 * Shows the card preview instantly (called on hover, no re-render)
 */
export function showCardPreview(card, game) {
  if (!card) return;
  
  const container = document.getElementById('wide-card-preview');
  const content = document.getElementById('wide-card-preview-content');
  
  if (container && content) {
    // Update content first
    content.innerHTML = renderCard(card, true, game);
    // Show with opacity transition
    container.style.opacity = '1';
    container.style.pointerEvents = 'none';
  }
}

/**
 * Hides the card preview instantly (called on mouse leave, no re-render)
 */
export function hideCardPreview() {
  const container = document.getElementById('wide-card-preview');
  if (container) {
    container.style.opacity = '0';
  }
}

/**
 * Finds a card by instance ID from the player's hand
 */
export function findCardInHand(game, instanceId) {
  if (!game || !instanceId) return null;
  
  for (const player of game.players) {
    const hand = player.hand || [];
    const found = hand.find(card => card.instanceId === instanceId);
    if (found) return found;
  }
  
  return null;
}

