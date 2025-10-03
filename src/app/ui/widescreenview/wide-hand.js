import { renderCard } from '../views/game/cards.js';
import { canPlayCard } from '../../game/core/index.js';
import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

/**
 * Renders the floating hand tray for widescreen view
 * Shows a peek of cards at the bottom that can expand upward
 */
export function renderWideHand(player, game, isOpen) {
  if (!player || !player.hand) return '';

  const hand = player.hand || [];
  // Sort by mana cost first, then creatures before spells within same cost
  const sortedHand = [...hand].sort((a, b) => {
    const costA = a.cost ?? 0;
    const costB = b.cost ?? 0;
    
    // First sort by mana cost (ascending)
    if (costA !== costB) {
      return costA - costB;
    }
    
    // Within same cost, creatures come before spells
    if (a.type !== b.type) {
      return a.type === 'creature' ? -1 : 1;
    }
    
    return 0;
  });

  const handCount = sortedHand.length;
  const hasCards = handCount > 0;
  const availableMana = player.availableMana ?? 0;

  // Render card previews - simplified versions for peek mode
  const cardPreviews = sortedHand.map((card) => renderWideHandCard(card, game, isOpen, player)).join('');

  const toggleIcon = isOpen ? '▼' : '▲';
  const toggleLabel = isOpen ? 'Hand' : 'Hand';

  return `
    <div class="wide-hand-container ${isOpen ? 'open' : 'closed'}">
      <div class="wide-hand-toggle" data-action="toggle-wide-hand">
        <span class="toggle-icon">${toggleIcon}</span>
        <span class="mana-display">
          <span class="mana-gem">${availableMana}</span>
        </span>
        <span class="toggle-label">${toggleLabel}</span>
        <span class="hand-count-badge">${handCount}</span>
      </div>
      
      <div class="wide-hand-content">
        <div class="wide-hand-scroll">
          ${hasCards 
            ? `<div class="wide-hand-grid">${cardPreviews}</div>` 
            : '<div class="wide-hand-empty">No cards in hand</div>'
          }
        </div>
      </div>
    </div>
  `;
}

/**
 * Renders a single card in the wide hand view
 * Shows compact preview when closed, full card when open
 */
function renderWideHandCard(card, game, isOpen, player) {
  const localSeatIndex = getLocalSeatIndex();
  const playable = !game?.pendingAction && canPlayCard(card, localSeatIndex, game);
  
  if (isOpen) {
    // Full card rendering when hand is open
    return `<div class="wide-hand-card-wrapper">${renderCard(card, true, game)}</div>`;
  } else {
    // Compact peek preview when hand is closed
    const colorClass = `card-color-${card?.color ?? 'neutral'}`;
    const typeClass = card.type === 'creature' ? 'creature-card' : 'spell-card';
    const playableClass = playable ? 'playable' : 'unplayable';
    
    return `
      <div class="wide-hand-card-peek ${colorClass} ${typeClass} ${playableClass}" data-card="${card.instanceId}" data-location="hand">
        <div class="peek-header">
          <span class="peek-cost"><span class="mana-gem">${card.cost ?? ''}</span></span>
          <span class="peek-name">${card.name}</span>
        </div>
      </div>
    `;
  }
}

