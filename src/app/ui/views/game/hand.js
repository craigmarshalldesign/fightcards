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
    if (costA !== costB) return costA - costB;
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
    </section>
  `;
}
