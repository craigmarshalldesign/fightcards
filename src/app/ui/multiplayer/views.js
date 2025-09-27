import { state } from '../../state.js';
import { COLORS } from '../../../game/cards/index.js';
import { escapeHtml } from '../views/game/shared.js';
import '../views/basicViews.css';

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
