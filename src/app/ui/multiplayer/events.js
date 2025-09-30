import { db, state, requestRender } from '../../state.js';
import { COLORS } from '../../../game/cards/index.js';
import { subscribeToMatch, clearMatch, MULTIPLAYER_EVENT_TYPES } from '../../multiplayer/runtime.js';
import { generateId } from '../../utils/id.js';
import {
  MULTIPLAYER_RULE_PARAMS,
  applyMultiplayerRuleParams,
} from '../../multiplayer/rules.js';

const LOBBY_QUERY_LIMIT = 10;
const STALE_LOBBY_TIMEOUT_MS = 60_000;
const LOBBY_CLEANUP_THROTTLE_MS = 5_000;
const ACTIVE_LOBBY_TTL_MS = 60_000;
const LOBBY_STORAGE_KEY = 'fightcards:lastLobbyId';
const VISIBLE_LOBBY_STATUSES = ['open', 'ready', 'starting', 'playing'];

let lastLobbyCleanupCheck = 0;
let activeLobbyExpiryTimer = null;
let searchDebounceTimer = null;

function ensureString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeLobbyRecord(raw) {
  if (!raw) return null;
  const lobby = { ...raw };
  lobby.id = ensureString(lobby.id);
  lobby.status = ensureString(lobby.status) || 'open';
  lobby.hostUserId = ensureString(lobby.hostUserId);
  lobby.hostDisplayName = ensureString(lobby.hostDisplayName);
  lobby.hostColor = ensureString(lobby.hostColor);
  lobby.hostReady = Boolean(lobby.hostReady);
  lobby.guestUserId = ensureString(lobby.guestUserId);
  lobby.guestDisplayName = ensureString(lobby.guestDisplayName);
  lobby.guestColor = ensureString(lobby.guestColor);
  lobby.guestReady = Boolean(lobby.guestReady);
  lobby.searchKey = ensureString(lobby.searchKey) || lobby.hostDisplayName.toLowerCase();
  lobby.matchId = ensureString(lobby.matchId);
  lobby.createdAt = typeof lobby.createdAt === 'number' ? lobby.createdAt : 0;
  lobby.updatedAt = typeof lobby.updatedAt === 'number' ? lobby.updatedAt : lobby.createdAt;
  return lobby;
}

export async function runTransactions(chunks, { onError, withRuleParams = false } = {}) {
  const operations = Array.isArray(chunks) ? chunks : [chunks];
  const prepared = operations
    .map((chunk) => {
      if (!chunk) return null;
      return withRuleParams ? applyMultiplayerRuleParams(chunk) : chunk;
    })
    .filter(Boolean);
  try {
    if (!prepared.length) {
      return true;
    }
    await db.transact(prepared);
    return true;
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    } else {
      console.error('InstantDB transaction failed', error);
    }
    return false;
  }
}

function rememberOwnedLobby(lobbyId) {
  if (!lobbyId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOBBY_STORAGE_KEY, lobbyId);
  } catch (error) {
    console.warn('Could not persist active lobby id', error);
  }
}

function clearRememberedLobby(lobbyId) {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(LOBBY_STORAGE_KEY);
    if (!lobbyId || stored === lobbyId) {
      window.localStorage.removeItem(LOBBY_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Could not clear active lobby id', error);
  }
}

export async function cleanupRememberedLobbyForUser(userId) {
  if (!userId || typeof window === 'undefined') return;
  let storedId = null;
  try {
    storedId = window.localStorage.getItem(LOBBY_STORAGE_KEY);
  } catch (error) {
    console.warn('Could not read remembered lobby id', error);
    return;
  }
  if (!storedId) return;

  await runTransactions(db.tx.lobbies[storedId].delete(), {
    onError(error) {
      console.warn('Failed to cleanup remembered lobby', error);
    },
    withRuleParams: true,
  });
  clearRememberedLobby(storedId);
}

async function deleteUserStaleLobbies(userId) {
  if (!userId) return;
  const now = Date.now();
  const staleLobbies = state.multiplayer.lobbyList.lobbies
    .map((lobby) => normalizeLobbyRecord(lobby))
    .filter((lobby) => {
      if (!lobby) return false;
      if (!lobby.id) return false;
      if (lobby.hostUserId !== userId) return false;
      if (lobby.matchId) return false;
      if (lobby.guestUserId) return false;
      const lastUpdated = lobby.updatedAt || lobby.createdAt || 0;
      if (!lastUpdated) return true;
      return now - lastUpdated >= STALE_LOBBY_TIMEOUT_MS;
    });

  if (!staleLobbies.length) return;

  const tx = staleLobbies.map((lobby) => db.tx.lobbies[lobby.id].delete());
  await runTransactions(tx, {
    onError(error) {
      console.error('Failed to delete stale lobbies for host', error);
    },
    withRuleParams: true,
  });
}

export function ensureMultiplayerScreenSubscriptions() {
  if (state.screen === 'multiplayer-lobbies') {
    // Only create subscription if it doesn't exist - don't recreate on every render
    if (!state.multiplayer.lobbySubscription) {
      refreshLobbySubscription();
    }
  } else {
    // Clean up lobby subscription when not on lobbies screen
    if (state.multiplayer.lobbySubscription && state.screen !== 'multiplayer-lobby-detail') {
      cleanupLobbyListSubscription();
    }
  }
  if (state.screen === 'multiplayer-lobby-detail' && state.multiplayer.activeLobby?.id) {
    ensureActiveLobbySubscription(state.multiplayer.activeLobby.id);
  }
}

function clearActiveLobbyExpiryTimer() {
  if (activeLobbyExpiryTimer) {
    clearTimeout(activeLobbyExpiryTimer);
    activeLobbyExpiryTimer = null;
  }
  stopLobbyCountdown();
}

async function deleteLobby(lobbyId, { silent = false } = {}) {
  if (!lobbyId) return false;
  const success = await runTransactions(db.tx.lobbies[lobbyId].delete(), {
    onError(error) {
      console.error('Failed to delete lobby', lobbyId, error);
    },
    withRuleParams: true,
  });
  if (!success) return false;

  if (state.multiplayer.activeLobby?.id === lobbyId) {
    if (state.multiplayer.activeLobbySubscriptionId === lobbyId) {
      cleanupActiveLobbySubscription();
    } else {
      clearActiveLobbyExpiryTimer();
      state.multiplayer.autoJoinInFlight = null;
    }
    state.multiplayer.activeLobby = null;
    if (!state.multiplayer.currentMatchId) {
      state.screen = 'multiplayer-lobbies';
    }
  }
  if (!state.multiplayer.currentMatchId) {
    clearMatch();
  }
  clearRememberedLobby(lobbyId);
  if (!silent) {
    requestRender();
  }
  return true;
}

function scheduleActiveLobbyExpiry(lobby) {
  clearActiveLobbyExpiryTimer();
  if (!lobby?.id) return;
  const userId = state.auth.user?.id;
  if (!userId || lobby.hostUserId !== userId) return;

  const lastActivity = lobby.updatedAt || lobby.createdAt || 0;
  if (!lastActivity) return;

  const elapsed = Date.now() - lastActivity;
  const remaining = ACTIVE_LOBBY_TTL_MS - elapsed;
  if (remaining <= 0) {
    deleteLobby(lobby.id);
    return;
  }

  activeLobbyExpiryTimer = setTimeout(() => {
    deleteLobby(lobby.id);
  }, remaining);
  
  // Start countdown timer for UI display
  startLobbyCountdown(lobby);
}

function startLobbyCountdown(lobby) {
  stopLobbyCountdown();
  
  if (!lobby?.id) return;
  const userId = state.auth.user?.id;
  // Only show countdown for host's lobby
  if (!userId || lobby.hostUserId !== userId) return;
  
  const updateCountdown = () => {
    if (!state.multiplayer.activeLobby || state.multiplayer.activeLobby.id !== lobby.id) {
      stopLobbyCountdown();
      return;
    }
    
    const lastActivity = state.multiplayer.activeLobby.updatedAt || state.multiplayer.activeLobby.createdAt || 0;
    if (!lastActivity) {
      state.multiplayer.lobbyCountdown = null;
      requestRender();
      return;
    }
    
    const elapsed = Date.now() - lastActivity;
    const remaining = ACTIVE_LOBBY_TTL_MS - elapsed;
    
    if (remaining <= 0) {
      state.multiplayer.lobbyCountdown = 0;
      stopLobbyCountdown();
      requestRender();
      return;
    }
    
    state.multiplayer.lobbyCountdown = Math.ceil(remaining / 1000);
    requestRender();
  };
  
  updateCountdown();
  state.multiplayer.lobbyCountdownInterval = setInterval(updateCountdown, 1000);
}

function stopLobbyCountdown() {
  if (state.multiplayer.lobbyCountdownInterval) {
    clearInterval(state.multiplayer.lobbyCountdownInterval);
    state.multiplayer.lobbyCountdownInterval = null;
  }
  state.multiplayer.lobbyCountdown = null;
}

function ensureActiveLobbySubscription(lobbyId) {
  if (!lobbyId) return;
  if (
    state.multiplayer.activeLobbySubscriptionId === lobbyId &&
    typeof state.multiplayer.activeLobbySubscription === 'function'
  ) {
    return;
  }

  cleanupActiveLobbySubscription();

  const query = {
    lobbies: {
      $: {
        where: { id: lobbyId },
        limit: 1,
      },
    },
  };

  const unsubscribe = db.subscribeQuery(
    query,
    (snapshot) => {
    if (snapshot.error) {
      state.multiplayer.activeLobby = null;
      state.multiplayer.activeLobbySubscription = null;
      state.multiplayer.activeLobbySubscriptionId = null;
      state.multiplayer.autoJoinInFlight = null;
      if (!state.multiplayer.currentMatchId) {
        clearMatch();
      }
      requestRender();
      return;
    }
    const previousLobby = state.multiplayer.activeLobby;
    const lobby = snapshot.data?.lobbies?.[0] ?? null;
    const normalizedLobby = normalizeLobbyRecord(lobby);
    state.multiplayer.activeLobby = normalizedLobby;
    if (!normalizedLobby) {
      state.multiplayer.activeLobbySubscription = null;
      state.multiplayer.activeLobbySubscriptionId = null;
      state.multiplayer.autoJoinInFlight = null;
      clearActiveLobbyExpiryTimer();
      if (!state.multiplayer.currentMatchId) {
        clearMatch();
        if (state.screen === 'multiplayer-lobby-detail') {
          state.screen = 'multiplayer-lobbies';
        }
      }
      requestRender();
      return;
    }

    scheduleActiveLobbyExpiry(normalizedLobby);

    maybeAutoJoinSeat(normalizedLobby).catch((error) => {
      console.error('Failed to auto-join lobby', error);
    });

    const matchId = normalizedLobby.matchId || null;
    if (matchId && matchId !== state.multiplayer.currentMatchId) {
      subscribeToMatch(matchId);
    } else if (!matchId && state.multiplayer.currentMatchId) {
      clearMatch();
    }

    const userId = state.auth.user?.id;
    const userInLobby = Boolean(
      userId && (normalizedLobby.hostUserId === userId || normalizedLobby.guestUserId === userId),
    );
    if (matchId && userInLobby) {
      state.screen = 'game';
    } else if (!matchId && previousLobby?.matchId && userInLobby && state.screen === 'game') {
      state.screen = 'multiplayer-lobby-detail';
    }
    requestRender();
    },
    { ruleParams: MULTIPLAYER_RULE_PARAMS },
  );

  state.multiplayer.activeLobbySubscription = unsubscribe;
  state.multiplayer.activeLobbySubscriptionId = lobbyId;
}

function cleanupActiveLobbySubscription() {
  if (typeof state.multiplayer.activeLobbySubscription === 'function') {
    state.multiplayer.activeLobbySubscription();
  }
  state.multiplayer.activeLobbySubscription = null;
  state.multiplayer.activeLobbySubscriptionId = null;
  state.multiplayer.autoJoinInFlight = null;
  clearActiveLobbyExpiryTimer();
  stopLobbyCountdown();
}

async function maybeAutoJoinSeat(lobby) {
  if (!lobby || lobby.matchId) {
    state.multiplayer.autoJoinInFlight = null;
    return;
  }

  if (state.screen !== 'multiplayer-lobby-detail') {
    return;
  }

  const userId = state.auth.user?.id;
  if (!userId) {
    state.multiplayer.autoJoinInFlight = null;
    return;
  }

  if (lobby.hostUserId === userId || lobby.guestUserId === userId) {
    if (state.multiplayer.autoJoinInFlight === lobby.id) {
      state.multiplayer.autoJoinInFlight = null;
    }
    return;
  }

  if (lobby.guestUserId) {
    state.multiplayer.autoJoinInFlight = null;
    return;
  }

  if (state.multiplayer.autoJoinInFlight === lobby.id) {
    return;
  }

  state.multiplayer.autoJoinInFlight = lobby.id;
  try {
    await claimSeat('guest');
  } finally {
    if (state.multiplayer.autoJoinInFlight === lobby.id) {
      state.multiplayer.autoJoinInFlight = null;
    }
  }
}

function cleanupLobbyListSubscription() {
  if (typeof state.multiplayer.lobbySubscription === 'function') {
    state.multiplayer.lobbySubscription();
  }
  state.multiplayer.lobbySubscription = null;
}

async function returnToModeSelectFromLobbies() {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (lobby && userId && lobby.hostUserId === userId && !state.multiplayer.currentMatchId) {
    await deleteLobby(lobby.id, { silent: true });
  }
  cleanupActiveLobbySubscription();
  if (!state.multiplayer.currentMatchId) {
    clearMatch();
  }
  cleanupLobbyListSubscription();
  state.multiplayer.activeLobby = null;
  state.multiplayer.lobbyList.lobbies = [];
  state.multiplayer.lobbyList.loading = false;
  state.multiplayer.lobbyList.error = null;
  state.multiplayer.lobbyList.searchTerm = '';
  
  // Clear any pending search debounce
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  
  state.screen = 'mode-select';
  requestRender();
}

export function attachMultiplayerEventHandlers(root) {
  if (root.__multiplayerLobbyHandlers) return;

  const handleClick = async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;

    const action = target.getAttribute('data-action');

    if (action === 'back-mode-select' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      await returnToModeSelectFromLobbies();
      return;
    }

    if (action === 'clear-search' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      // Clear any pending search debounce
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }
      state.multiplayer.lobbyList.searchTerm = '';
      // Refresh subscription when clearing search
      if (state.multiplayer.lobbySubscription) {
        refreshLobbySubscription();
      } else {
        requestRender();
      }
      return;
    }

    if (action === 'refresh-lobbies' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      // Only refresh if we're explicitly clicking the refresh button
      if (state.multiplayer.lobbySubscription) {
        refreshLobbySubscription();
      } else {
        ensureMultiplayerScreenSubscriptions();
      }
      return;
    }

    if (action === 'create-lobby' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      await createLobby();
      return;
    }

    if (action === 'view-lobby' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      const lobbyId = target.getAttribute('data-lobby');
      if (!lobbyId) return;
      const lobby = state.multiplayer.lobbyList.lobbies.find((l) => l.id === lobbyId);
      state.multiplayer.activeLobby = lobby ? normalizeLobbyRecord(lobby) : null;
      state.screen = 'multiplayer-lobby-detail';
      ensureActiveLobbySubscription(lobbyId);
      if (state.multiplayer.activeLobby) {
        maybeAutoJoinSeat(state.multiplayer.activeLobby).catch((error) => {
          console.error('Failed to auto-join lobby', error);
        });
      }
      if (lobby?.matchId) {
        subscribeToMatch(lobby.matchId);
      }
      requestRender();
      return;
    }

    if (action === 'back-lobbies' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      const lobby = state.multiplayer.activeLobby;
      const userId = state.auth.user?.id;
      if (lobby && userId) {
        if (lobby.hostUserId === userId && !state.multiplayer.currentMatchId) {
          await deleteLobby(lobby.id);
          return;
        }
        if (lobby.guestUserId === userId) {
          await leaveSeat('guest');
        }
      }
      cleanupActiveLobbySubscription();
      if (!state.multiplayer.currentMatchId) {
        clearMatch();
      }
      state.multiplayer.activeLobby = null;
      state.screen = 'multiplayer-lobbies';
      requestRender();
      // Re-establish lobby list subscription when returning to lobbies screen
      ensureMultiplayerScreenSubscriptions();
      return;
    }

    if (action === 'claim-seat' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      const seat = target.getAttribute('data-seat');
      if (!seat) return;
      await claimSeat(seat);
      return;
    }

    if (action === 'leave-seat' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      const seat = target.getAttribute('data-seat');
      if (!seat) return;
      await leaveSeat(seat);
      return;
    }

    if (action === 'choose-deck' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      const seat = target.getAttribute('data-seat');
      const color = target.getAttribute('data-color');
      if (!seat || !color) return;
      await chooseDeck(seat, color);
      return;
    }

    if (action === 'toggle-ready' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      const seat = target.getAttribute('data-seat');
      if (!seat) return;
      await toggleReady(seat);
      return;
    }

    if (action === 'start-match' && state.screen === 'multiplayer-lobby-detail') {
      event.preventDefault();
      await startMatch();
      return;
    }
  };

  const handleInput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-action') === 'search-lobbies' && state.screen === 'multiplayer-lobbies') {
      // Update the search term immediately (for UI feedback)
      state.multiplayer.lobbyList.searchTerm = target.value ?? '';
      
      // Clear any existing debounce timer
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
      
      // Debounce the actual search/refresh - wait 400ms after user stops typing
      searchDebounceTimer = setTimeout(() => {
        if (state.multiplayer.lobbySubscription) {
          refreshLobbySubscription();
        }
      }, 400);
    }
  };

  const handleChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-action') === 'search-lobbies' && state.screen === 'multiplayer-lobbies') {
      // The input handler already handles debouncing, so we don't need to do anything here
      // This event fires after input loses focus, so we'll just ensure the search is refreshed
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
      if (state.multiplayer.lobbySubscription) {
        refreshLobbySubscription();
      }
    }
  };

  const handleKeydown = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-action') === 'search-lobbies' && state.screen === 'multiplayer-lobbies') {
      if (event.key === 'Enter') {
        event.preventDefault();
        // Clear debounce and search immediately when Enter is pressed
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = null;
        }
        if (state.multiplayer.lobbySubscription) {
          refreshLobbySubscription();
        }
      }
    }
  };

  root.addEventListener('click', handleClick);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  root.addEventListener('keydown', handleKeydown);

  root.__multiplayerLobbyHandlers = {
    handleClick,
    handleInput,
    handleChange,
    handleKeydown,
  };
}

async function claimSeat(seat) {
  const user = state.auth.user;
  const lobby = state.multiplayer.activeLobby;
  if (!user || !lobby) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  const seatNameKey = seat === 'host' ? 'hostDisplayName' : 'guestDisplayName';
  const seatReadyKey = seat === 'host' ? 'hostReady' : 'guestReady';
  const seatColorKey = seat === 'host' ? 'hostColor' : 'guestColor';

  if (lobby[seatUserKey] && lobby[seatUserKey] !== user.id) {
    return;
  }

  const updates = {
    updatedAt: Date.now(),
    [seatUserKey]: user.id,
    [seatNameKey]: deriveDisplayName(user).trim() || 'Player',
    [seatReadyKey]: false,
    [seatColorKey]: typeof lobby[seatColorKey] === 'string' ? lobby[seatColorKey] : '',
  };
  updates.status = computeLobbyStatus({ ...lobby, ...updates });

  const success = await runTransactions(db.tx.lobbies[lobby.id].update(updates), {
    withRuleParams: true,
  });
  if (success) {
    state.multiplayer.activeLobby = normalizeLobbyRecord({ ...lobby, ...updates });
    state.multiplayer.autoJoinInFlight = null;
    requestRender();
  }
}

async function leaveSeat(seat) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  if (lobby[seatUserKey] !== userId) return;

  if (seat === 'host') {
    await deleteLobby(lobby.id);
    return;
  }

  const updates = {
    updatedAt: Date.now(),
    [seatUserKey]: '',
    [seat === 'host' ? 'hostDisplayName' : 'guestDisplayName']: '',
    [seat === 'host' ? 'hostColor' : 'guestColor']: '',
    [seat === 'host' ? 'hostReady' : 'guestReady']: false,
  };
  updates.status = computeLobbyStatus({ ...lobby, ...updates });

  const success = await runTransactions(db.tx.lobbies[lobby.id].update(updates), {
    withRuleParams: true,
  });
  if (success) {
    state.multiplayer.activeLobby = normalizeLobbyRecord({ ...lobby, ...updates });
    state.multiplayer.autoJoinInFlight = null;
    requestRender();
  }
}

async function chooseDeck(seat, color) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId || !COLORS[color]) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  const seatColorKey = seat === 'host' ? 'hostColor' : 'guestColor';
  const seatReadyKey = seat === 'host' ? 'hostReady' : 'guestReady';

  if (lobby[seatUserKey] !== userId) return;

  // Allow players to choose the same color - no restriction
  // Both players can now play red vs red, blue vs blue, etc.

  const updates = {
    updatedAt: Date.now(),
    [seatColorKey]: color,
    [seatReadyKey]: false,
  };
  updates.status = computeLobbyStatus({ ...lobby, ...updates });

  const success = await runTransactions(db.tx.lobbies[lobby.id].update(updates), {
    withRuleParams: true,
  });
  if (success) {
    state.multiplayer.activeLobby = normalizeLobbyRecord({ ...lobby, ...updates });
    requestRender();
  }
}

async function toggleReady(seat) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  const seatReadyKey = seat === 'host' ? 'hostReady' : 'guestReady';
  const seatColorKey = seat === 'host' ? 'hostColor' : 'guestColor';

  if (lobby[seatUserKey] !== userId) return;
  if (!lobby[seatColorKey]) return;

  const updates = {
    updatedAt: Date.now(),
    [seatReadyKey]: !lobby[seatReadyKey],
  };
  updates.status = computeLobbyStatus({ ...lobby, ...updates });

  const success = await runTransactions(db.tx.lobbies[lobby.id].update(updates), {
    withRuleParams: true,
  });
  if (success) {
    state.multiplayer.activeLobby = normalizeLobbyRecord({ ...lobby, ...updates });
    requestRender();
  }
}

async function startMatch() {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || lobby.hostUserId !== userId) return;

  const ready =
    lobby.hostUserId &&
    lobby.guestUserId &&
    lobby.hostColor &&
    lobby.guestColor &&
    lobby.hostReady &&
    lobby.guestReady;

  if (!ready) return;

  const matchId = generateId();
  const eventId = generateId();
  const now = Date.now();
  
  // Roll dice until there's no tie (like single-player rollForInitiative)
  let diceRolls;
  let winner;
  do {
    diceRolls = {
      host: 1 + Math.floor(Math.random() * 6),
      guest: 1 + Math.floor(Math.random() * 6),
    };
    if (diceRolls.host > diceRolls.guest) {
      winner = 0;
    } else if (diceRolls.guest > diceRolls.host) {
      winner = 1;
    }
  } while (diceRolls.host === diceRolls.guest);

  const activePlayer = winner;
  const match = {
    id: matchId,
    lobbyId: lobby.id,
    status: 'starting',
    activePlayer,
    turn: 1,
    phase: 'main1',
    dice: {
      host: diceRolls.host,
      guest: diceRolls.guest,
      winner,
    },
    state: null,
    pendingAction: null,
    winner: null,
    nextSequence: 2,
    createdAt: now,
    updatedAt: now,
    hostUserId: lobby.hostUserId,
    hostDisplayName: lobby.hostDisplayName,
    hostColor: lobby.hostColor,
    guestUserId: lobby.guestUserId,
    guestDisplayName: lobby.guestDisplayName,
    guestColor: lobby.guestColor,
  };

  const matchStartedEvent = {
    id: eventId,
    matchId,
    sequence: 1,
    type: MULTIPLAYER_EVENT_TYPES.MATCH_STARTED,
    payload: {
      turn: 1,
      activePlayer,
      phase: 'main1',
      dice: { ...match.dice },
    },
    createdAt: now,
  };

  try {
    state.multiplayer.lobbyList.error = null;
    const success = await runTransactions(
      [
        db.tx.matches[matchId].update(match),
        db.tx.matchEvents[eventId].update(matchStartedEvent),
        db.tx.lobbies[lobby.id].update({
          matchId,
          status: 'starting',
          updatedAt: now,
        }),
      ],
      {
        onError(error) {
          console.error('Failed to start match', error);
        },
        withRuleParams: true,
      },
    );
    if (!success) {
      state.multiplayer.lobbyList.error = 'Could not start the match. Please try again.';
      requestRender();
      return;
    }

    state.multiplayer.activeLobby = {
      ...lobby,
      matchId,
      status: 'starting',
      updatedAt: now,
    };
    subscribeToMatch(matchId);
    state.multiplayer.currentMatchId = matchId;
    setTimeout(() => {
      deleteLobby(lobby.id, { silent: true });
    }, 1_000);
    requestRender();
  } catch (error) {
    console.error('Failed to start match', error);
    state.multiplayer.lobbyList.error = 'Could not start the match. Please try again.';
    requestRender();
  }
}

async function maybeCleanupStaleLobbies(lobbies) {
  const now = Date.now();
  if (now - lastLobbyCleanupCheck < LOBBY_CLEANUP_THROTTLE_MS) {
    return;
  }

  const userId = state.auth.user?.id ?? null;
  let deletedAny = false;

  for (const rawLobby of lobbies) {
    const lobby = normalizeLobbyRecord(rawLobby);
    if (!lobby) continue;
    if (lobby.matchId) continue;

    const status = lobby.status || 'open';
    if (status !== 'open' && status !== 'ready') continue;

    const hasGuest = Boolean(lobby.guestUserId);
    if (hasGuest) continue;

    const lastUpdated = lobby.updatedAt ?? lobby.createdAt ?? 0;
    if (!lastUpdated) continue;

    if (now - lastUpdated < STALE_LOBBY_TIMEOUT_MS) continue;

    const canDelete = Boolean(!lobby.hostUserId || (userId && lobby.hostUserId === userId));
    if (!canDelete) continue;

    await runTransactions(db.tx.lobbies[lobby.id].delete(), {
      onError(error) {
        console.error('Failed to delete stale lobby', lobby.id, error);
      },
      withRuleParams: true,
    });
    deletedAny = true;
  }

  if (deletedAny) {
    lastLobbyCleanupCheck = now;
  }
}

function buildLobbyQuery() {
  const config = { limit: LOBBY_QUERY_LIMIT };
  return {
    lobbies: {
      $: config,
    },
  };
}

function refreshLobbySubscription() {
  // Clean up existing subscription first
  cleanupLobbyListSubscription();

  const query = buildLobbyQuery();
  
  // Set loading state BEFORE creating subscription
  state.multiplayer.lobbyList.loading = true;
  state.multiplayer.lobbyList.error = null;

  let unsubscribe;
  try {
    unsubscribe = db.subscribeQuery(
      query,
      async (snapshot) => {
        // Don't render if we've already moved away from the lobbies screen
        if (state.screen !== 'multiplayer-lobbies') {
          return;
        }

        if (snapshot.error) {
          state.multiplayer.lobbyList.loading = false;
          state.multiplayer.lobbyList.error = snapshot.error.message || 'Failed to load lobbies.';
          state.multiplayer.lobbyList.lobbies = [];
          requestRender();
          return;
        }

        updateLobbyListFromSnapshot(snapshot.data?.lobbies ?? []);
      },
      { ruleParams: MULTIPLAYER_RULE_PARAMS },
    );
  } catch (error) {
    console.error('Failed to subscribe to lobbies', error);
    state.multiplayer.lobbyList.loading = false;
    state.multiplayer.lobbyList.error = 'Failed to subscribe to lobbies. Please try again.';
    state.multiplayer.lobbySubscription = null;
    requestRender();
    return;
  }

  // Set subscription handle IMMEDIATELY to prevent re-creation
  if (typeof unsubscribe === 'function') {
    state.multiplayer.lobbySubscription = unsubscribe;
  } else {
    console.warn('Unexpected lobby subscription handle; falling back to no-op close.');
    state.multiplayer.lobbySubscription = () => {};
  }
  
  // Don't call requestRender here - the subscription callback or primeLobbyListing will handle it
  primeLobbyListing(query);
}

function updateLobbyListFromSnapshot(rawLobbies) {
  let normalizedLobbies = [];
  try {
    normalizedLobbies = rawLobbies.map((lobby) => normalizeLobbyRecord(lobby)).filter(Boolean);
  } catch (error) {
    console.error('Failed to normalize lobby snapshot', error);
    state.multiplayer.lobbyList.loading = false;
    state.multiplayer.lobbyList.error = 'Unable to load lobbies. Please try again.';
    state.multiplayer.lobbyList.lobbies = [];
    requestRender();
    return;
  }

  if (normalizedLobbies.length) {
    maybeCleanupStaleLobbies(normalizedLobbies).catch((error) => {
      console.error('Failed to cleanup stale lobbies', error);
    });
  }

  let lobbies = normalizedLobbies.filter((lobby) => VISIBLE_LOBBY_STATUSES.includes(lobby.status));
  const statusOrder = {
    open: 0,
    ready: 1,
    starting: 2,
    playing: 3,
  };
  lobbies.sort((a, b) => {
    const statusDelta = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (statusDelta !== 0) return statusDelta;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  const searchTerm = state.multiplayer.lobbyList.searchTerm.trim().toLowerCase();
  if (searchTerm) {
    lobbies = lobbies.filter((lobby) => {
      const host = (lobby.hostDisplayName || '').toLowerCase();
      const guest = (lobby.guestDisplayName || '').toLowerCase();
      return host.includes(searchTerm) || guest.includes(searchTerm);
    });
  }

  state.multiplayer.lobbyList.lobbies = lobbies;
  state.multiplayer.lobbyList.loading = false;
  state.multiplayer.lobbyList.error = null;
  requestRender();
}

async function primeLobbyListing(query) {
  try {
    const snapshot = await db.queryOnce(query, { ruleParams: MULTIPLAYER_RULE_PARAMS });
    if (snapshot?.error) {
      throw snapshot.error;
    }
    updateLobbyListFromSnapshot(snapshot?.data?.lobbies ?? []);
  } catch (error) {
    console.error('Failed to load latest lobbies', error);
    state.multiplayer.lobbyList.loading = false;
    if (!state.multiplayer.lobbyList.lobbies.length) {
      state.multiplayer.lobbyList.error = 'Unable to load lobbies. Please try again.';
    }
    requestRender();
  }
}

async function createLobby() {
  const user = state.auth.user;
  if (!user) {
    state.multiplayer.lobbyList.error = 'You must be signed in to create a lobby.';
    requestRender();
    return;
  }

  try {
    await deleteUserStaleLobbies(user.id);
    const lobbyId = generateId();
    const now = Date.now();
    const displayName = deriveDisplayName(user);
    const normalizedName = displayName.trim() || 'Player';
    state.multiplayer.lobbyList.error = null;
    const lobby = {
      id: lobbyId,
      status: 'open',
      hostUserId: user.id,
      hostDisplayName: normalizedName,
      hostColor: '',
      hostReady: false,
      guestUserId: '',
      guestDisplayName: '',
      guestColor: '',
      guestReady: false,
      searchKey: normalizedName.toLowerCase(),
      matchId: '',
      createdAt: now,
      updatedAt: now,
    };

    const success = await runTransactions(db.tx.lobbies[lobbyId].update(lobby), {
      onError(error) {
        console.error('Failed to create lobby', error);
      },
      withRuleParams: true,
    });
    if (!success) {
      state.multiplayer.lobbyList.error = 'Could not create lobby. Please try again.';
      requestRender();
      return;
    }
    cleanupActiveLobbySubscription();
    state.multiplayer.activeLobby = normalizeLobbyRecord(lobby);
    state.screen = 'multiplayer-lobby-detail';
    ensureActiveLobbySubscription(lobbyId);
    rememberOwnedLobby(lobbyId);
    requestRender();
  } catch (error) {
    console.error('Failed to create lobby', error);
    state.multiplayer.lobbyList.error = 'Could not create lobby. Please try again.';
    requestRender();
  }
}

export function convertMatchToGame() {
  if (!state.multiplayer.match) return;
  state.game = null;
  state.screen = 'game';
  requestRender();
}

function deriveDisplayName(user) {
  if (!user) return 'Player';
  if (typeof user.displayName === 'string' && user.displayName.trim()) {
    return user.displayName.trim();
  }
  if (typeof user.username === 'string' && user.username.trim()) {
    return user.username.trim();
  }
  if (typeof user.name === 'string' && user.name.trim()) {
    return user.name.trim();
  }
  if (typeof user.email === 'string' && user.email.includes('@')) {
    return user.email.split('@')[0];
  }
  return 'Player';
}

export function canCurrentUserAct() {
  const match = state.multiplayer.match;
  if (!match) return true;
  const userId = state.auth.user?.id;
  if (!userId) return false;
  const localSeat = state.multiplayer.localSeat;
  const localIndex = localSeat === 'guest' ? 1 : 0;
  const game = state.game;
  
  // Use game.currentPlayer as single source of truth
  const isPendingTarget = Boolean(game?.pendingAction && game.pendingAction.controller === localIndex);
  const isActiveTurn = game?.currentPlayer === localIndex;
  const isBlockingTurn = Boolean(
    game?.combat &&
      game.combat.stage === 'blockers' &&
      game.blocking?.awaitingDefender &&
      localIndex === (game.currentPlayer === 0 ? 1 : 0),
  );
  return isActiveTurn || isPendingTarget || isBlockingTurn;
}

function computeLobbyStatus(lobby) {
  if (!lobby) return 'open';
  if (lobby.matchId) return lobby.status || 'starting';
  const hostReady = Boolean(lobby.hostUserId && lobby.hostColor && lobby.hostReady);
  const guestReady = Boolean(lobby.guestUserId && lobby.guestColor && lobby.guestReady);
  if (hostReady && guestReady) return 'ready';
  return 'open';
}
