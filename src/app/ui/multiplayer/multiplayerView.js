import { state } from '../../state.js';
import { COLORS } from '../../../game/cards/index.js';
import { escapeHtml } from '../views/game/shared.js';
import '../views/basicViews.css';

export function renderMultiplayerLobby() {
  const { lobbyList } = state.multiplayer;
  const { loading, error, lobbies, searchTerm } = lobbyList;
  const refreshAttrs = loading ? 'data-busy="true" aria-busy="true"' : '';
  const refreshLabel = loading ? 'Refreshing…' : 'Refresh';
  const lobbyItems = lobbies
    .map((lobby) => {
      const hostName = escapeHtml(lobby.hostDisplayName || 'Unknown');
      const opponentName = lobby.guestDisplayName ? escapeHtml(lobby.guestDisplayName) : 'Waiting...';
      const statusLabel = escapeHtml((lobby.status || 'open').replace(/-/g, ' '));
      const hostDeck = lobby.hostColor
        ? `Deck: ${escapeHtml(COLORS[lobby.hostColor]?.name || lobby.hostColor)}`
        : 'Deck: TBD';
      const isJoinable = !lobby.guestUserId && !lobby.matchId;
      const joinLabel = isJoinable ? 'Join Lobby' : 'In Progress';
      return `
        <li class="lobby-item ${isJoinable ? '' : 'locked'}" data-lobby="${lobby.id}">
          <div class="lobby-item-header">
            <span class="lobby-host-name">${hostName}</span>
            <span class="lobby-status">${statusLabel}</span>
          </div>
          <div class="lobby-item-body">
            <span class="lobby-color">${hostDeck}</span>
            <span class="lobby-opponent">Opponent: ${opponentName}</span>
          </div>
          <div class="lobby-item-footer">
            <span class="lobby-id">#${lobby.id.slice(-5)}</span>
            <button class="mini" data-action="view-lobby" data-lobby="${lobby.id}" ${isJoinable ? '' : 'disabled'}>${joinLabel}</button>
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
            <input
              id="lobby-search"
              type="search"
              data-action="search-lobbies"
              placeholder="Search by player name"
              value="${escapeHtml(searchTerm)}"
            />
            <button class="ghost mini" data-action="clear-search" ${searchTerm ? '' : 'disabled'}>Clear</button>
          </div>
          <div class="toolbar-actions">
            <button class="ghost mini" data-action="refresh-lobbies" ${refreshAttrs}>${refreshLabel}</button>
            <button class="primary" data-action="create-lobby">Create Lobby</button>
          </div>
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

  const lobbyTitle = activeLobby.name
    ? escapeHtml(activeLobby.name)
    : escapeHtml(`${activeLobby.hostDisplayName || 'Host'}'s Lobby`);
  const statusLabel = escapeHtml((activeLobby.status || 'open').replace(/-/g, ' '));
  const isHostUser = activeLobby.hostUserId === userId;
  const isGuestUser = activeLobby.guestUserId === userId;

  if (isHostUser) {
    return renderHostLobbyDetail(activeLobby, lobbyTitle, statusLabel);
  }
  if (!activeLobby.guestUserId || isGuestUser) {
    return renderGuestLobbyDetail(activeLobby, lobbyTitle, statusLabel, isGuestUser);
  }
  return renderLockedLobbyDetail(activeLobby, lobbyTitle, statusLabel);
}

function renderHostLobbyDetail(lobby, lobbyTitle, statusLabel) {
  const canStart = Boolean(
    lobby.hostUserId &&
      lobby.guestUserId &&
      lobby.hostColor &&
      lobby.guestColor &&
      lobby.hostReady &&
      lobby.guestReady,
  );
  const startDisabled = canStart ? '' : 'disabled';
  const readyLabel = lobby.hostReady ? 'Unready' : 'Ready Up';
  const readyDisabled = lobby.hostColor ? '' : 'disabled';
  const hostColorInfo = lobby.hostColor ? COLORS[lobby.hostColor] : null;
  const hostStyle = hostColorInfo
    ? ` style="--deck-accent:${hostColorInfo.accent}; --deck-accent-soft:${hostColorInfo.accentSoft};"`
    : '';
  const opponentColorInfo = lobby.guestColor ? COLORS[lobby.guestColor] : null;
  const opponentStyle = opponentColorInfo
    ? ` style="--deck-accent:${opponentColorInfo.accent}; --deck-accent-soft:${opponentColorInfo.accentSoft};"`
    : '';
  const hostDeckTheme = lobby.hostColor
    ? escapeHtml(COLORS[lobby.hostColor]?.theme || 'Locked in and ready.')
    : 'Choose a deck to prepare for battle.';
  const opponentName = escapeHtml(lobby.guestDisplayName || 'Waiting for challenger');
  const opponentDeck = lobby.guestColor
    ? escapeHtml(COLORS[lobby.guestColor]?.name || lobby.guestColor)
    : 'Not selected';
  const opponentReadyClass = lobby.guestUserId
    ? lobby.guestReady
      ? 'ready'
      : 'waiting'
    : 'open';
  const opponentReadyText = lobby.guestUserId
    ? lobby.guestReady
      ? 'Ready'
      : 'Not ready'
    : 'Empty seat';
  const opponentMessage = lobby.guestUserId
    ? lobby.guestReady
      ? 'Your opponent is locked in and ready to go.'
      : 'Opponent is choosing a deck or readying up.'
    : 'Share this lobby with a friend and wait for them to join.';

  return `
    <div class="view hero-view lobby-detail">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide lobby-panel">
        <div class="hero-header">
          <span class="hero-kicker">Lobby Control</span>
          <h2>${lobbyTitle}</h2>
          <p>Status: ${statusLabel}</p>
        </div>
        <div class="lobby-detail-columns">
          <section class="lobby-card host-card ${lobby.hostColor ? `deck-${lobby.hostColor}` : ''}"${hostStyle}>
            <header>
              <h3>Your Deck</h3>
              <span class="ready-state ${lobby.hostReady ? 'ready' : 'waiting'}">${
                lobby.hostReady ? 'Ready' : 'Waiting'
              }</span>
            </header>
            <p class="lobby-card-label">${
              lobby.hostColor ? escapeHtml(COLORS[lobby.hostColor]?.name || lobby.hostColor) : 'No deck selected'
            }</p>
            <p class="lobby-card-subtitle">${hostDeckTheme}</p>
            ${renderDeckPills('host', lobby.hostColor, lobby.guestColor)}
            <div class="ready-controls">
              <button class="primary large" data-action="toggle-ready" data-seat="host" ${readyDisabled}>
                ${readyLabel}
              </button>
              ${lobby.hostColor ? '' : '<p class="ready-hint">Select a deck to enable ready.</p>'}
            </div>
          </section>
          <section class="lobby-card opponent-card ${opponentReadyClass}"${opponentStyle}>
            <header>
              <h3>Opponent</h3>
              <span class="ready-state ${opponentReadyClass}">${opponentReadyText}</span>
            </header>
            <p class="lobby-card-label">${opponentName}</p>
            <p class="lobby-card-subtitle">Deck: ${opponentDeck}</p>
            <p class="opponent-message">${opponentMessage}</p>
          </section>
        </div>
        <div class="lobby-detail-actions">
          <button class="ghost large" data-action="back-lobbies">Back to Lobbies</button>
          <button class="primary large" data-action="start-match" ${startDisabled}>Start Game</button>
        </div>
        <div class="lobby-detail-footer">
          <span class="ready-icon" aria-hidden="true">⚔️</span>
          <span class="ready-text">Both players must pick distinct decks and ready up before battle begins.</span>
        </div>
      </div>
    </div>
  `;
}

function renderGuestLobbyDetail(lobby, lobbyTitle, statusLabel, isGuestUser) {
  const guestReadyClass = lobby.guestUserId
    ? lobby.guestReady
      ? 'ready'
      : 'waiting'
    : 'open';
  const guestReadyLabel = lobby.guestReady ? 'Unready' : 'Ready Up';
  const guestHasDeck = Boolean(lobby.guestColor);
  const guestDeckName = lobby.guestColor
    ? escapeHtml(COLORS[lobby.guestColor]?.name || lobby.guestColor)
    : 'Choose your deck';
  const hostReadyClass = lobby.hostReady ? 'ready' : 'waiting';
  const hostDeckName = lobby.hostColor
    ? escapeHtml(COLORS[lobby.hostColor]?.name || lobby.hostColor)
    : 'Not selected';
  const hostStatus = lobby.hostReady ? 'Ready' : 'Waiting';
  const hostMessage = lobby.hostReady
    ? 'Host is ready to start the match.'
    : 'Host is picking a deck or preparing to ready up.';
  const hostColorInfo = lobby.hostColor ? COLORS[lobby.hostColor] : null;
  const hostStyle = hostColorInfo
    ? ` style="--deck-accent:${hostColorInfo.accent}; --deck-accent-soft:${hostColorInfo.accentSoft};"`
    : '';
  const guestColorInfo = lobby.guestColor ? COLORS[lobby.guestColor] : null;
  const guestStyle = guestColorInfo
    ? ` style="--deck-accent:${guestColorInfo.accent}; --deck-accent-soft:${guestColorInfo.accentSoft};"`
    : '';

  let guestControls = '';
  if (!lobby.guestUserId) {
    guestControls = `
      <div class="guest-actions">
        <button class="primary large" data-action="claim-seat" data-seat="guest">Join Lobby</button>
      </div>
    `;
  } else if (isGuestUser) {
    guestControls = `
      <div class="guest-controls">
        ${renderDeckPills('guest', lobby.guestColor, lobby.hostColor)}
        <div class="ready-controls">
          <button class="primary large" data-action="toggle-ready" data-seat="guest" ${
            guestHasDeck ? '' : 'disabled'
          }>${guestReadyLabel}</button>
          ${guestHasDeck ? '' : '<p class="ready-hint">Pick a deck to enable ready.</p>'}
        </div>
      </div>
    `;
  } else {
    guestControls = '<p class="lobby-card-subtitle">Guest seat is taken.</p>';
  }

  const actionHint = lobby.hostReady && lobby.guestReady ? 'Waiting for the host to launch the match.' : 'Ready up when you are set.';

  return `
    <div class="view hero-view lobby-detail">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide lobby-panel">
        <div class="hero-header">
          <span class="hero-kicker">Prepare for Battle</span>
          <h2>${lobbyTitle}</h2>
          <p>Status: ${statusLabel}</p>
        </div>
        <div class="lobby-detail-columns">
          <section class="lobby-card opponent-card ${hostReadyClass}"${hostStyle}>
            <header>
              <h3>Host</h3>
              <span class="ready-state ${hostReadyClass}">${hostStatus}</span>
            </header>
            <p class="lobby-card-label">${escapeHtml(lobby.hostDisplayName || 'Host')}</p>
            <p class="lobby-card-subtitle">Deck: ${hostDeckName}</p>
            <p class="opponent-message">${hostMessage}</p>
          </section>
          <section class="lobby-card guest-card ${guestReadyClass}"${guestStyle}>
            <header>
              <h3>Your Seat</h3>
              <span class="ready-state ${guestReadyClass}">${
                lobby.guestUserId ? (lobby.guestReady ? 'Ready' : 'Waiting') : 'Open'
              }</span>
            </header>
            <p class="lobby-card-label">${guestDeckName}</p>
            <p class="lobby-card-subtitle">${actionHint}</p>
            ${guestControls}
          </section>
        </div>
        <div class="lobby-detail-actions">
          <button class="ghost large" data-action="back-lobbies">Back to Lobbies</button>
          <button class="primary large" disabled>${
            lobby.hostReady && lobby.guestReady ? 'Waiting for Host' : 'Awaiting Ready States'
          }</button>
        </div>
        <div class="lobby-detail-footer">
          <span class="ready-icon" aria-hidden="true">⚔️</span>
          <span class="ready-text">Ready up once you have selected a deck. The host will launch the match.</span>
        </div>
      </div>
    </div>
  `;
}

function renderLockedLobbyDetail(lobby, lobbyTitle, statusLabel) {
  const hostDeck = lobby.hostColor
    ? escapeHtml(COLORS[lobby.hostColor]?.name || lobby.hostColor)
    : 'Not selected';
  const guestDeck = lobby.guestColor
    ? escapeHtml(COLORS[lobby.guestColor]?.name || lobby.guestColor)
    : 'Not selected';

  return `
    <div class="view hero-view lobby-detail">
      <div class="hero-background" data-particle-field>
        <canvas class="particle-canvas" aria-hidden="true"></canvas>
        <div class="hero-gradient"></div>
      </div>
      <div class="hero-panel wide lobby-panel">
        <div class="hero-header">
          <span class="hero-kicker">Lobby Locked</span>
          <h2>${lobbyTitle}</h2>
          <p>Status: ${statusLabel}</p>
          <p>Both seats are filled. Join another lobby or create your own duel.</p>
        </div>
        <div class="lobby-detail-columns">
          <section class="lobby-card opponent-card ready">
            <header>
              <h3>Host</h3>
            </header>
            <p class="lobby-card-label">${escapeHtml(lobby.hostDisplayName || 'Host')}</p>
            <p class="lobby-card-subtitle">Deck: ${hostDeck}</p>
          </section>
          <section class="lobby-card opponent-card ready">
            <header>
              <h3>Challenger</h3>
            </header>
            <p class="lobby-card-label">${escapeHtml(lobby.guestDisplayName || 'Guest')}</p>
            <p class="lobby-card-subtitle">Deck: ${guestDeck}</p>
          </section>
        </div>
        <div class="lobby-detail-actions">
          <button class="ghost large" data-action="back-lobbies">Back to Lobbies</button>
        </div>
        <div class="lobby-detail-footer">
          <span class="ready-icon" aria-hidden="true">⚔️</span>
          <span class="ready-text">This lobby is full. Browse the list for another match or host your own.</span>
        </div>
      </div>
    </div>
  `;
}

function renderDeckPills(seat, seatColor, opponentColor) {
  return `
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
}
