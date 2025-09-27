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

export function renderMultiplayerLobby() {
  const { lobbyList } = state.multiplayer;
  const { loading, error, lobbies, searchTerm } = lobbyList;
  const lobbyItems = lobbies
    .map((lobby) => {
      const isFull = lobby.status && lobby.status !== 'open';
      const displayName = escapeHtml(lobby.hostDisplayName || 'Unknown');
      const opponentName = lobby.guestDisplayName ? escapeHtml(lobby.guestDisplayName) : 'Waiting...';
      const statusLabel = lobby.status ? lobby.status.replace(/-/g, ' ') : 'open';
      const colorLabel = lobby.hostColor ? `Deck: ${escapeHtml(COLORS[lobby.hostColor]?.name || lobby.hostColor)}` : 'Deck: TBD';
      const joinLabel = isFull ? 'In Progress' : 'Join Lobby';
      return `
        <li class="lobby-item ${isFull ? 'locked' : ''}" data-lobby="${lobby.id}">
          <div class="lobby-item-header">
            <span class="lobby-host-name">${displayName}</span>
            <span class="lobby-status">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="lobby-item-body">
            <span class="lobby-color">${colorLabel}</span>
            <span class="lobby-opponent">Opponent: ${escapeHtml(opponentName)}</span>
          </div>
          <div class="lobby-item-footer">
            <span class="lobby-id">#${lobby.id.slice(-5)}</span>
            <button class="mini" data-action="view-lobby" data-lobby="${lobby.id}" ${isFull ? 'disabled' : ''}>${joinLabel}</button>
          </div>
        </li>
      `;
    })
    .join('');

  return `
    <div class="view hero-view multiplayer-view">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide lobby-panel">
        <div class="hero-header">
          <span class="hero-kicker">Find Your Opponent</span>
          <h2>Multiplayer Lobbies</h2>
          <p>Browse open rooms or create your own duel. Pick a deck, ready up, and the arena will sync automatically.</p>
        </div>
        <div class="lobby-toolbar">
          <div class="search-field">
            <label class="sr-only" for="lobby-search">Search by player name</label>
            <input id="lobby-search" type="search" data-action="search-lobbies" placeholder="Search by player name" value="${escapeHtml(searchTerm)}" />
            <button class="ghost mini" data-action="clear-search" ${searchTerm ? '' : 'disabled'}>Clear</button>
          </div>
          <button class="primary" data-action="create-lobby">Create Lobby</button>
        </div>
        <div class="lobby-content">
          ${loading ? '<p class="info">Loading lobbies...</p>' : ''}
          ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <ul class="lobby-list">
          ${lobbies.length ? lobbyItems : '<li class="empty">No lobbies found. Try a different search or create one!</li>'}
        </ul>
        </div>
        <div class="hero-actions">
          <button class="ghost large" data-action="back-mode-select">Back</button>
        </div>
      </div>
    </div>
  `;
}

export function renderLobbyDetail() {
  const { activeLobby } = state.multiplayer;
  const userId = state.auth.user?.id;
  if (!activeLobby) {
    return `
      <div class="view hero-view">
        <div class="hero-panel">
          <div class="hero-header">
            <h2>Lobby Unavailable</h2>
            <p>The selected lobby could not be found or has been closed.</p>
          </div>
          <div class="hero-actions">
            <button class="ghost large" data-action="back-lobbies">Back to Lobbies</button>
          </div>
        </div>
      </div>
    `;
  }

  const lobbyTitle = activeLobby.name ? escapeHtml(activeLobby.name) : escapeHtml(`${activeLobby.hostDisplayName || 'Host'}'s Lobby`);
  const statusLabel = escapeHtml((activeLobby.status || 'open').replace(/-/g, ' '));
  const isHostUser = activeLobby.hostUserId === userId;

  const canStart = Boolean(
    activeLobby.hostUserId &&
      activeLobby.guestUserId &&
      activeLobby.hostColor &&
      activeLobby.guestColor &&
      activeLobby.hostReady &&
      activeLobby.guestReady,
  );
  const startDisabled = !isHostUser || !canStart;
  const startLabel = isHostUser ? 'Start Match' : 'Waiting for Host';

  const renderDeckPills = (seat, seatColor, opponentColor) => `
    <div class="deck-pill-group">
      ${Object.entries(COLORS)
        .map(([colorKey, info]) => {
          const isSelected = seatColor === colorKey;
          const isUnavailable = opponentColor === colorKey && !isSelected;
          const classes = ['deck-pill', `deck-${colorKey}`];
          if (isSelected) classes.push('selected');
          if (isUnavailable) classes.push('disabled');
          return `
            <button class="${classes.join(' ')}" data-action="choose-deck" data-seat="${seat}" data-color="${colorKey}" ${
              isUnavailable ? 'disabled' : ''
            } style="--deck-accent:${info.accent}; --deck-accent-soft:${info.accentSoft};">
              <span class="deck-pill-label">${escapeHtml(info.name)}</span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;

  const renderSeatCard = (seat) => {
    const isHostSeat = seat === 'host';
    const seatUserId = isHostSeat ? activeLobby.hostUserId : activeLobby.guestUserId;
    const seatDisplayName = isHostSeat ? activeLobby.hostDisplayName : activeLobby.guestDisplayName;
    const seatColor = isHostSeat ? activeLobby.hostColor : activeLobby.guestColor;
    const seatReady = Boolean(isHostSeat ? activeLobby.hostReady : activeLobby.guestReady);
    const isSeatOwner = seatUserId && seatUserId === userId;

    const colorInfo = seatColor ? COLORS[seatColor] : null;
    const occupantName = seatUserId
      ? escapeHtml(seatDisplayName || 'Player')
      : isHostSeat
      ? 'Host slot open'
      : 'Waiting for challenger';
    const deckName = colorInfo ? escapeHtml(colorInfo.name) : 'No deck selected';
    const deckTheme = colorInfo ? escapeHtml(colorInfo.theme) : 'Choose a deck to lock in your strategy.';
    const classNames = ['seat-card'];
    if (colorInfo) classNames.push('has-color', `deck-${seatColor}`);
    if (seatReady) classNames.push('ready');
    if (!seatUserId) classNames.push('open');
    if (isSeatOwner) classNames.push('is-owner');

    const styleAttr = colorInfo
      ? ` style="--deck-accent:${colorInfo.accent}; --deck-accent-soft:${colorInfo.accentSoft};"`
      : '';
    const statusClass = seatUserId ? (seatReady ? 'ready' : 'waiting') : 'open';
    const statusText = seatUserId ? (seatReady ? 'Ready' : 'Waiting') : 'Open';
    const opponentColor = isHostSeat ? activeLobby.guestColor : activeLobby.hostColor;

    let controls = '';
    if (!seatUserId) {
      const joinLabel = isHostSeat ? 'Claim Host Seat' : 'Join Lobby';
      controls = `
        <div class="seat-actions">
          <button class="primary large" data-action="claim-seat" data-seat="${seat}">${joinLabel}</button>
        </div>
      `;
    } else if (isSeatOwner) {
      const deckButtons = renderDeckPills(seat, seatColor, opponentColor);
      const readyDisabled = seatColor ? '' : 'disabled';
      const readyLabel = seatReady ? 'Unready' : 'Ready Up';
      const readyHint = seatColor ? '' : '<p class="seat-hint">Select a deck to enable ready.</p>';
      controls = `
        <div class="seat-controls">
          ${deckButtons}
          <div class="seat-ready-row">
            <button class="primary large ready-toggle" data-action="toggle-ready" data-seat="${seat}" ${readyDisabled}>${readyLabel}</button>
          </div>
          ${readyHint}
        </div>
      `;
    } else {
      const waitingMessage = seatReady ? 'Locked in and ready.' : 'Waiting for this player to ready up.';
      controls = `<p class="seat-note">${waitingMessage}</p>`;
    }

    const themeText = isSeatOwner && !seatColor ? 'Pick a deck below to prepare for battle.' : deckTheme;

    return `
      <article class="${classNames.join(' ')}"${styleAttr}>
        <header class="seat-header">
          <div class="seat-heading">
            <span class="seat-role">${seat === 'host' ? 'Host' : 'Challenger'}</span>
            <h3>${occupantName}</h3>
          </div>
          <span class="seat-status-pill ${statusClass}">${statusText}</span>
        </header>
        <div class="seat-body">
          <div class="seat-deck-summary">
            <span class="seat-label">Deck</span>
            <span class="seat-value">${deckName}</span>
          </div>
          <p class="seat-theme-text">${themeText}</p>
          ${controls}
        </div>
      </article>
    `;
  };

  return `
    <div class="view hero-view lobby-detail">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide">
        <div class="hero-header">
          <span class="hero-kicker">Lobby Status</span>
          <h2>${lobbyTitle}</h2>
          <p>Status: ${statusLabel}</p>
        </div>
        <div class="lobby-detail-grid">
          ${renderSeatCard('host')}
          ${renderSeatCard('guest')}
        </div>
        <div class="lobby-detail-actions">
          <button class="ghost large" data-action="back-lobbies">Back to Lobbies</button>
          <button class="primary large" data-action="start-match" ${startDisabled ? 'disabled' : ''}>${startLabel}</button>
        </div>
        <div class="lobby-detail-footer">
          <span class="ready-icon" aria-hidden="true">⚔️</span>
          <span class="ready-text">Both players must pick distinct decks and ready up before battle begins.</span>
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
          <button class="primary large" data-action="restart">Play Again</button>
          <button class="ghost large" data-action="back-menu">Main Menu</button>
        </div>
      </div>
    </div>
  `;
}
