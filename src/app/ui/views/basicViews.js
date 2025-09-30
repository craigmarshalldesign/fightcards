import { state } from '../../state.js';
import { COLORS } from '../../../game/cards/index.js';
import { escapeHtml } from './game/shared.js';
import './basicViews.css';

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
    <div class="view hero-view">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel">
        <div class="hero-header">
          <span class="hero-kicker">Strategy Card Battler</span>
          <h1>Fight Cards</h1>
          <p>Battle against your friends or the AI in a fast, tactical card game.</p>
        </div>
        <ul class="hero-feature-list">
          <li><strong>Build momentum</strong> with elemental synergies.</li>
          <li><strong>React instantly</strong> to freezes, buffs, and combat tricks.</li>
          <li><strong>Play anywhere</strong> with a touch-friendly interface.</li>
        </ul>
        <div class="hero-actions">
          <button class="primary large" data-action="start">Start Battle</button>
          <button class="ghost large" data-action="signout">Sign out</button>
        </div>
      </div>
    </div>
  `;
}

export function renderModeSelect() {
  return `
    <div class="view hero-view">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel compact">
        <div class="hero-header">
          <span class="hero-kicker">Choose Your Challenge</span>
          <h2>Select Mode</h2>
          <p>Decide how you want to enter the arena.</p>
        </div>
        <div class="hero-card-grid">
          <button class="info-card" data-action="choose-mode" data-mode="ai">
            <span class="info-card-title">Battle AI</span>
            <span class="info-card-body">Face a reactive opponent tuned for punchy, strategic turns.</span>
            <span class="info-card-tag">Single player</span>
          </button>
          <button class="info-card" data-action="choose-mode" data-mode="multiplayer">
            <span class="info-card-title">Player vs Player</span>
            <span class="info-card-body">Browse online lobbies or host your own duel.</span>
            <span class="info-card-tag">Multiplayer</span>
          </button>
        </div>
        <div class="hero-actions">
          <button class="ghost large" data-action="back-menu">Back</button>
        </div>
      </div>
    </div>
  `;
}

export function renderColorSelect() {
  return `
    <div class="view hero-view">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide">
        <div class="hero-header">
          <span class="hero-kicker">Forge Your Identity</span>
          <h2>Choose Your Element</h2>
          <p>Each element bends the battlefield in a different way. Tap a deck to begin.</p>
        </div>
        <div class="hero-card-grid color-grid">
          ${Object.entries(COLORS)
            .map(
              ([colorKey, info]) => `
                <button class="info-card color-card color-${colorKey}" data-action="select-color" data-color="${colorKey}">
                  <span class="info-card-title">${escapeHtml(info.name)}</span>
                  <span class="info-card-body">${escapeHtml(info.theme)}</span>
                  <span class="info-card-tag">Elemental focus</span>
                </button>
              `,
            )
            .join('')}
        </div>
        <div class="hero-actions">
          <button class="ghost large" data-action="back-menu">Back</button>
        </div>
      </div>
    </div>
  `;
}

export function renderGameOver() {
  const { game } = state;
  if (!game) return '';
  const winnerIndex = game.winner;
  const players = game.players || [];
  const stats = game.stats?.players || [];
  const totalTurns = game.stats?.totalTurns ?? game.turn ?? 0;
  const playerName = players[0]?.name ?? 'You';
  const opponentName = players[1]?.name ?? 'Opponent';
  const winnerText =
    winnerIndex === 0
      ? 'Victory!'
      : winnerIndex === 1
      ? 'Defeat'
      : 'Battle Complete';
  const winnerDetail =
    winnerIndex === 0
      ? `${playerName} outlasted ${opponentName}.`
      : winnerIndex === 1
      ? `${opponentName} claimed the win.`
      : 'No victor emerged this time.';
  const statTemplate = {
    cardsPlayed: 0,
    spellsCast: 0,
    creaturesSummoned: 0,
    creaturesDestroyed: 0,
    damageDealt: 0,
    turnsTaken: 0,
  };
  const ensureStats = (index) => ({ ...statTemplate, ...(stats[index] || {}) });
  const playerStats = ensureStats(0);
  const opponentStats = ensureStats(1);
  const statRows = [
    { label: 'Spells Played', player: playerStats.spellsCast ?? 0, opponent: opponentStats.spellsCast ?? 0 },
    { label: 'Creatures Summoned', player: playerStats.creaturesSummoned, opponent: opponentStats.creaturesSummoned },
    { label: 'Creatures Destroyed', player: playerStats.creaturesDestroyed, opponent: opponentStats.creaturesDestroyed },
    { label: 'Damage Dealt', player: playerStats.damageDealt, opponent: opponentStats.damageDealt },
    { label: 'Turns Taken', player: playerStats.turnsTaken, opponent: opponentStats.turnsTaken },
  ];
  const summaries = players
    .map((player, idx) => {
      const colorInfo = COLORS[player?.color] || { name: 'Unknown', theme: '' };
      const resultLabel = winnerIndex == null ? 'Finalist' : winnerIndex === idx ? 'Winner' : 'Challenger';
      return `
        <div class="player-summary ${winnerIndex === idx ? 'winner' : ''}">
          <div class="player-summary-header">
            <h3>${escapeHtml(player?.name ?? `Player ${idx + 1}`)}</h3>
            <span class="player-result">${escapeHtml(resultLabel)}</span>
          </div>
          <div class="player-summary-meta">
            <span class="player-deck">${escapeHtml(colorInfo.name)} Deck</span>
            <span class="player-life">Life ${escapeHtml(player?.life ?? 0)}</span>
          </div>
          <p class="player-theme">${escapeHtml(colorInfo.theme)}</p>
        </div>
      `;
    })
    .join('');
  return `
    <div class="view hero-view">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel gameover">
        <div class="hero-header">
          <span class="hero-kicker">Battle Report</span>
          <h2>${escapeHtml(winnerText)}</h2>
          <p>${escapeHtml(winnerDetail)} After ${escapeHtml(totalTurns)} turn${totalTurns === 1 ? '' : 's'}.</p>
        </div>
        <div class="battle-summary">${summaries}</div>
        <div class="battle-stats">
          <h3>Match Stats</h3>
          <table class="stat-table">
            <thead>
              <tr>
                <th scope="col">Stat</th>
                <th scope="col">${escapeHtml(playerName)}</th>
                <th scope="col">${escapeHtml(opponentName)}</th>
              </tr>
            </thead>
            <tbody>
              ${statRows
                .map(
                  (row) => `
                    <tr>
                      <th scope="row">${escapeHtml(row.label)}</th>
                      <td>${escapeHtml(row.player)}</td>
                      <td>${escapeHtml(row.opponent)}</td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="hero-actions">
          ${state.multiplayer?.currentMatchId ? '' : '<button class="primary large" data-action="restart">Play Again</button>'}
          <button class="${state.multiplayer?.currentMatchId ? 'primary' : 'ghost'} large" data-action="back-menu-from-game-over">Main Menu</button>
        </div>
      </div>
    </div>
  `;
}
