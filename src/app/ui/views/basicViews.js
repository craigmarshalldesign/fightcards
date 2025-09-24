import { state } from '../../state.js';
import { COLORS } from '../../../game/cards/index.js';

export function renderLoading() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Summoning the Arena...</h1>
        <p>Please wait.</p>
      </div>
    </div>
  `;
}

export function renderLogin() {
  const { email, codeSent, code, message } = state.emailLogin;
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Fight Cards</h1>
        <p class="subtitle">Sign in with email to save your duels.</p>
        <form id="email-form" class="form">
          <label>Email</label>
          <input type="email" name="email" value="${email}" placeholder="you@example.com" required />
          <button type="submit">${codeSent ? 'Resend code' : 'Send magic code'}</button>
        </form>
        ${codeSent ? `
          <form id="verify-form" class="form">
            <label>Magic code</label>
            <input type="text" name="code" value="${code}" placeholder="123456" maxlength="6" required />
            <button type="submit">Sign in</button>
          </form>
        ` : ''}
        ${message ? `<p class="info">${message}</p>` : ''}
      </div>
    </div>
  `;
}

export function renderMenu() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Fight Cards</h1>
        <p class="subtitle">Three elements collide in strategic battles.</p>
        <button class="primary" data-action="start">Start Game</button>
        <button data-action="signout">Sign out</button>
      </div>
    </div>
  `;
}

export function renderModeSelect() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>Select Mode</h2>
        <button class="primary" data-action="choose-mode" data-mode="ai">Battle AI</button>
        <button class="disabled" disabled>Player vs Player (coming soon)</button>
        <button data-action="back-menu">Back</button>
      </div>
    </div>
  `;
}

export function renderColorSelect() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>Choose Your Element</h2>
        <div class="color-grid">
          ${Object.entries(COLORS)
            .map(
              ([colorKey, info]) => `
                <button class="color-card" data-action="select-color" data-color="${colorKey}">
                  <span class="color-title">${info.name}</span>
                  <span class="color-desc">${info.theme}</span>
                </button>
              `,
            )
            .join('')}
        </div>
        <button data-action="back-menu">Back</button>
      </div>
    </div>
  `;
}

export function renderGameOver() {
  const { game } = state;
  if (!game) return '';
  const winnerText = game.winner === 0 ? 'You won!' : game.winner === 1 ? 'AI wins.' : 'Game ended.';
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>${winnerText}</h2>
        <p>The battle is over. Ready to try again?</p>
        <button class="primary" data-action="restart">Play Again</button>
        <button data-action="back-menu">Main Menu</button>
      </div>
    </div>
  `;
}
