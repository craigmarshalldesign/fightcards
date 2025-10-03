import { renderCard } from './cards.js';

export function renderHandArea(player, game) {
  const manaCrystals = Array.from({ length: Math.max(player.maxMana, 1) }, (_, i) => `
    <div class="mana-crystal ${i < player.availableMana ? 'filled' : i < player.maxMana ? 'available' : 'locked'}">
      <div class="crystal-inner"></div>
    </div>
  `).join('');

  const sortedHand = [...player.hand].sort((a, b) => {
    const costA = a.cost ?? 0;
    const costB = b.cost ?? 0;
    
    // First sort by mana cost
    if (costA !== costB) return costA - costB;
    
    // Within same mana cost, group by type (creatures first, then spells)
    const typeA = a.type === 'creature' ? 0 : 1;
    const typeB = b.type === 'creature' ? 0 : 1;
    if (typeA !== typeB) return typeA - typeB;
    
    // Within same cost and type, group identical cards together by name
    return (a.name || '').localeCompare(b.name || '');
  });

  return `
    <section class="hand-area">
      <div class="hand-mana-section">
        <div class="mana-crystals">
          <div class="mana-crystal-row">${manaCrystals}</div>
          <div class="mana-label">${player.availableMana}/${player.maxMana} Mana</div>
        </div>
      </div>
      <header class="hand-header">
        <h3>Your Hand</h3>
        <span>${player.hand.length} cards</span>
      </header>
      <div class="hand-cards">
        ${sortedHand.map((card) => renderCard(card, true, game)).join('')}
      </div>
      <div class="hand-footer">
        <button class="ghost mini" data-action="show-end-game-modal">End Game</button>
      </div>
      <div class="hand-footer">
        <button class="ghost mini" data-action="toggle-viewmode" title="Switch to widescreen view">🖥️ Widescreen</button>
      </div>
    </section>
  `;
}
