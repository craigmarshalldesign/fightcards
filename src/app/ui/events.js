import { db, state, resetToMenu, requestRender } from '../state.js';
import {
  startGame,
  advancePhase,
  confirmAttackers,
  skipCombat,
  finalizeCurrentRequirement,
  confirmPendingAction,
  cancelPendingAction,
  resolveCombat,
} from '../game/core/index.js';
import {
  handleHandCardClick,
  handleCreatureClick,
  activateCreatureAbility,
  handleLifeOrbClick,
} from '../game/interactions.js';
import { COLORS } from '../../game/cards/index.js';
import {
  addMultiplayerLogEvent,
  isMultiplayerMatchActive,
  seedMultiplayerMatch,
  subscribeToMatch,
  clearMatch,
  MULTIPLAYER_EVENT_TYPES,
} from '../multiplayer/runtime.js';
import { generateId } from '../utils/id.js';

const LOBBY_QUERY_LIMIT = 20;
const STALE_LOBBY_TIMEOUT_MS = 60_000;
const LOBBY_CLEANUP_THROTTLE_MS = 5_000;

let lastLobbyCleanupCheck = 0;

function ensureMultiplayerScreenSubscriptions() {
  if (state.screen === 'multiplayer-lobbies' && !state.multiplayer.lobbySubscription) {
    refreshLobbySubscription();
  }
  if (state.screen === 'multiplayer-lobby-detail' && state.multiplayer.activeLobby?.id) {
    ensureActiveLobbySubscription(state.multiplayer.activeLobby.id);
  }
}

function ensureActiveLobbySubscription(lobbyId) {
  if (!lobbyId) return;
  if (state.multiplayer.activeLobbySubscription) {
    state.multiplayer.activeLobbySubscription();
    state.multiplayer.activeLobbySubscription = null;
  }

  const query = {
    lobbies: {
      $: {
        where: { id: lobbyId },
        limit: 1,
      },
    },
  };

  const unsubscribe = db.subscribeQuery(query, (snapshot) => {
    if (snapshot.error) {
      state.multiplayer.activeLobby = null;
      state.multiplayer.activeLobbySubscription = null;
      clearMatch();
      requestRender();
      return;
    }
    const previousLobby = state.multiplayer.activeLobby;
    const lobby = snapshot.data?.lobbies?.[0] ?? null;
    state.multiplayer.activeLobby = lobby;
    if (!lobby) {
      state.multiplayer.activeLobbySubscription = null;
      clearMatch();
      if (state.screen === 'multiplayer-lobby-detail') {
        state.screen = 'multiplayer-lobbies';
      }
      requestRender();
      return;
    }

    const matchId = lobby.matchId ?? null;
    if (matchId && matchId !== state.multiplayer.currentMatchId) {
      subscribeToMatch(matchId);
    } else if (!matchId && state.multiplayer.currentMatchId) {
      clearMatch();
    }

    const userId = state.auth.user?.id;
    const userInLobby = Boolean(userId && (lobby.hostUserId === userId || lobby.guestUserId === userId));
    if (matchId && userInLobby) {
      state.screen = 'game';
    } else if (!matchId && previousLobby?.matchId && userInLobby && state.screen === 'game') {
      state.screen = 'multiplayer-lobby-detail';
    }
    requestRender();
  });

  state.multiplayer.activeLobbySubscription = unsubscribe;
}

function cleanupActiveLobbySubscription() {
  if (typeof state.multiplayer.activeLobbySubscription === 'function') {
    state.multiplayer.activeLobbySubscription();
  }
  state.multiplayer.activeLobbySubscription = null;
}

function cleanupLobbyListSubscription() {
  if (typeof state.multiplayer.lobbySubscription === 'function') {
    state.multiplayer.lobbySubscription();
  }
  state.multiplayer.lobbySubscription = null;
}

function returnToModeSelectFromLobbies() {
  cleanupActiveLobbySubscription();
  clearMatch();
  cleanupLobbyListSubscription();
  state.multiplayer.activeLobby = null;
  state.multiplayer.lobbyList.lobbies = [];
  state.multiplayer.lobbyList.loading = false;
  state.multiplayer.lobbyList.error = null;
  state.multiplayer.lobbyList.searchTerm = '';
  state.screen = 'mode-select';
  requestRender();
}

function bindMultiplayerLobbyEvents(root) {
  if (root.__multiplayerLobbyHandlers) return;

  const handleClick = async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;

    const action = target.getAttribute('data-action');

    if (action === 'back-mode-select' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      returnToModeSelectFromLobbies();
      return;
    }

    if (action === 'clear-search' && state.screen === 'multiplayer-lobbies') {
      event.preventDefault();
      state.multiplayer.lobbyList.searchTerm = '';
      refreshLobbySubscription();
      requestRender();
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
      state.multiplayer.activeLobby = lobby || null;
      state.screen = 'multiplayer-lobby-detail';
      ensureActiveLobbySubscription(lobbyId);
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
        if (lobby.guestUserId === userId) {
          await leaveSeat('guest');
        }
      }
      cleanupActiveLobbySubscription();
      clearMatch();
      state.multiplayer.activeLobby = null;
      state.screen = 'multiplayer-lobbies';
      requestRender();
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
      state.multiplayer.lobbyList.searchTerm = target.value ?? '';
      requestRender();
    }
  };

  const handleChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-action') === 'search-lobbies' && state.screen === 'multiplayer-lobbies') {
      refreshLobbySubscription();
    }
  };

  const handleKeydown = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.getAttribute('data-action') === 'search-lobbies' && state.screen === 'multiplayer-lobbies') {
      if (event.key === 'Enter') {
        event.preventDefault();
        refreshLobbySubscription();
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

export function attachEventHandlers(root) {
  bindMultiplayerLobbyEvents(root);
  ensureMultiplayerScreenSubscriptions();
  root.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.screen = 'mode-select';
      requestRender();
    });
  });

  root.querySelectorAll('[data-action="signout"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await db.auth.signOut();
        state.screen = 'login';
        requestRender();
      } catch (err) {
        console.error(err);
      }
    });
  });

  root.querySelectorAll('[data-action="back-menu"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      resetToMenu();
    });
  });

  root.querySelectorAll('[data-action="choose-mode"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const mode = event.currentTarget.getAttribute('data-mode');
      if (mode === 'ai') {
        state.screen = 'color-select';
        requestRender();
      } else if (mode === 'multiplayer') {
        state.screen = 'multiplayer-lobbies';
        requestRender();
      }
    });
  });

  root.querySelectorAll('[data-action="select-color"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color');
      startGame(color);
    });
  });

  const restartBtn = root.querySelector('[data-action="restart"]');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      state.screen = 'color-select';
      requestRender();
    });
  }

  if (state.multiplayer.match && state.screen !== 'game' && state.screen !== 'game-over') {
    convertMatchToGame();
  }

  root.querySelectorAll('[data-action="toggle-battle-log"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.battleLogExpanded = !state.ui.battleLogExpanded;
      requestRender();
    });
  });

  root.querySelectorAll('[data-action="toggle-spell-log"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.ui.spellLogExpanded = !state.ui.spellLogExpanded;
      requestRender();
    });
  });

  const emailForm = root.querySelector('#email-form');
  if (emailForm) {
    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(emailForm);
      const email = formData.get('email');
      state.emailLogin.email = email;
      try {
        await db.auth.sendMagicCode({ email });
        state.emailLogin.codeSent = true;
        state.emailLogin.message = 'Magic code sent! Check your inbox.';
      } catch (error) {
        state.emailLogin.message = error.body?.message || 'Failed to send code.';
      }
      requestRender();
    });
  }

  const verifyForm = root.querySelector('#verify-form');
  if (verifyForm) {
    verifyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(verifyForm);
      const code = formData.get('code');
      state.emailLogin.code = code;
      try {
        await db.auth.signInWithMagicCode({ email: state.emailLogin.email, code });
        state.emailLogin.message = 'Signed in!';
      } catch (error) {
        state.emailLogin.message = error.body?.message || 'Could not verify code.';
      }
      requestRender();
    });
  }

  if (state.screen === 'game' && state.game) {
    bindGameEvents(root);
  }
}

function bindGameEvents(root) {
  root.querySelectorAll('[data-location="hand"]').forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      if (!canCurrentUserAct()) return;
      if (state.multiplayer.replayingEvents) return;
      if (state.game?.pendingAction) return;
      const cardId = cardEl.getAttribute('data-card');
      handleHandCardClick(cardId);
    });
  });

  root.querySelectorAll('.creature-card').forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      // Allow creature clicks only for targeting or combat/blocking interactions
      const cardId = cardEl.getAttribute('data-card');
      const controller = Number(cardEl.getAttribute('data-controller'));
      handleCreatureClick(cardId, controller);
    });
  });

  root.querySelectorAll('[data-action="end-phase"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canCurrentUserAct()) return;
      if (state.multiplayer.replayingEvents) return;
      advancePhase();
    });
  });

  root.querySelectorAll('[data-action="end-turn"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canCurrentUserAct()) return;
      if (state.multiplayer.replayingEvents) return;
      endTurn();
    });
  });

  const declareBtn = root.querySelector('[data-action="declare-attackers"]');
  if (declareBtn) {
    declareBtn.addEventListener('click', () => {
      confirmAttackers();
    });
  }

  const skipBtn = root.querySelector('[data-action="skip-combat"]');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      skipCombat();
    });
  }

  root.querySelectorAll('[data-action="confirm-targets"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      finalizeCurrentRequirement();
    });
  });

  root.querySelectorAll('[data-action="confirm-pending"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      confirmPendingAction();
    });
  });

  const cancelAction = root.querySelector('[data-action="cancel-action"]');
  if (cancelAction) {
    cancelAction.addEventListener('click', () => {
      cancelPendingAction();
    });
  }

  root.querySelectorAll('[data-action="declare-blockers"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!canCurrentUserAct()) return;
      if (state.multiplayer.replayingEvents) return;
      resolveCombat();
    });
  });

  root.querySelectorAll('[data-action="activate"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const creatureId = event.currentTarget.getAttribute('data-creature');
      activateCreatureAbility(creatureId);
    });
  });

  root.querySelectorAll('[data-player-target]').forEach((orb) => {
    orb.addEventListener('click', () => {
      const controller = Number.parseInt(orb.getAttribute('data-player-target') ?? '', 10);
      if (Number.isNaN(controller)) return;
      handleLifeOrbClick(controller);
    });
  });

  root.querySelectorAll('.log-card-ref').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const instanceId = btn.getAttribute('data-card-ref');
      const snapshotAttr = btn.getAttribute('data-card-snapshot');
      let snapshot = null;
      if (snapshotAttr) {
        try {
          snapshot = JSON.parse(decodeURIComponent(snapshotAttr));
        } catch (error) {
          console.warn('Failed to parse card snapshot', error);
        }
      }
      state.ui.previewCard = { instanceId: instanceId || null, snapshot };
      requestRender();
    });
  });

  // Open graveyard modal when clicking the grave count (for either player)
  root.querySelectorAll('[data-open-grave]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      const controllerRaw = el.getAttribute('data-open-grave');
      const controller = Number.parseInt(controllerRaw ?? '', 10);
      if (Number.isNaN(controller)) return;
      state.ui.openGraveFor = controller;
      requestRender();
    });
  });

  const previewOverlay = root.querySelector('.card-preview-overlay');
  if (previewOverlay) {
    previewOverlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-preview-dialog]')) {
        return;
      }
      state.ui.previewCard = null;
      requestRender();
    });
  }

  const graveOverlay = root.querySelector('.graveyard-overlay');
  if (graveOverlay) {
    graveOverlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-grave-dialog]')) {
        return;
      }
      state.ui.openGraveFor = null;
      requestRender();
    });
  }

  root.querySelectorAll('[data-action="close-graveyard"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.ui.openGraveFor = null;
      requestRender();
    });
  });

  root.querySelectorAll('[data-action="close-preview"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      state.ui.previewCard = null;
      requestRender();
    });
  });
  
  // Position attack lines after DOM is updated
  requestAnimationFrame(() => {
    positionAttackLines(root);
    positionTargetLines(root);
  });
  // Reposition lines on resize/scroll for accuracy
  window.addEventListener(
    'resize',
    () => requestAnimationFrame(() => {
      positionAttackLines(root);
      positionTargetLines(root);
    }),
    { once: true },
  );
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

  await db.transact(db.tx.lobbies[lobby.id].update(updates));
}

async function leaveSeat(seat) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  if (lobby[seatUserKey] !== userId) return;

  const updates = {
    updatedAt: Date.now(),
    [seatUserKey]: '',
    [seat === 'host' ? 'hostDisplayName' : 'guestDisplayName']: '',
    [seat === 'host' ? 'hostColor' : 'guestColor']: '',
    [seat === 'host' ? 'hostReady' : 'guestReady']: false,
  };

  await db.transact(db.tx.lobbies[lobby.id].update(updates));
}

async function chooseDeck(seat, color) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId || !COLORS[color]) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  const seatColorKey = seat === 'host' ? 'hostColor' : 'guestColor';
  const seatReadyKey = seat === 'host' ? 'hostReady' : 'guestReady';

  if (lobby[seatUserKey] !== userId) return;

  const opponentColorKey = seat === 'host' ? lobby.guestColor : lobby.hostColor;
  if (opponentColorKey === color) {
    return;
  }

  const updates = {
    updatedAt: Date.now(),
    [seatColorKey]: color,
    [seatReadyKey]: false,
  };

  await db.transact(db.tx.lobbies[lobby.id].update(updates));
}

async function toggleReady(seat) {
  const lobby = state.multiplayer.activeLobby;
  const userId = state.auth.user?.id;
  if (!lobby || !userId) return;

  const seatUserKey = seat === 'host' ? 'hostUserId' : 'guestUserId';
  const seatReadyKey = seat === 'host' ? 'hostReady' : 'guestReady';
  const seatColorKey = seat === 'host' ? 'hostColor' : 'guestColor';

  if (lobby[seatUserKey] !== userId) return;
  if (!lobby[seatColorKey]) return; // must choose a deck first

  const updates = {
    updatedAt: Date.now(),
    [seatReadyKey]: !lobby[seatReadyKey],
  };

  await db.transact(db.tx.lobbies[lobby.id].update(updates));
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

  const matchId = generateId('match');
  const eventId = generateId('matchEvent');
  const now = Date.now();
  const diceRolls = {
    host: 1 + Math.floor(Math.random() * 6),
    guest: 1 + Math.floor(Math.random() * 6),
  };
  let winner = null;
  if (diceRolls.host !== diceRolls.guest) {
    winner = diceRolls.host > diceRolls.guest ? 0 : 1;
  }

  const activePlayer = winner ?? 0;
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
    await db.transact([
      db.tx.matches[matchId].update(match),
      db.tx.matchEvents[eventId].update(matchStartedEvent),
      db.tx.lobbies[lobby.id].update({
        matchId,
        status: 'starting',
        updatedAt: now,
      }),
    ]);

    state.multiplayer.activeLobby = {
      ...lobby,
      matchId,
      status: 'starting',
      updatedAt: now,
    };
    subscribeToMatch(matchId);
    requestRender();
  } catch (error) {
    console.error('Failed to start match', error);
    state.multiplayer.lobbyList.error = 'Could not start the match. Please try again.';
    requestRender();
  }
}

function positionAttackLines(root) {
  const attackLines = root.querySelectorAll('.attack-lines-svg .attack-line');
  if (!attackLines.length) return;
  
  // Get the container for relative positioning
  const gameView = root.querySelector('.game-view');
  if (!gameView) return;
  
  attackLines.forEach((line) => {
    const attackerId = line.dataset.attacker;
    const attackerController = Number.parseInt(line.dataset.attackerController ?? '', 10);
    const targetId = line.dataset.target;
    const targetControllerRaw = line.dataset.targetController;

    const attackerSelectorBase = `[data-card="${attackerId}"]`;
    const attackerControllerSelector = Number.isNaN(attackerController)
      ? ''
      : `[data-controller="${attackerController}"]`;
    const attackerElement =
      root.querySelector(`${attackerSelectorBase}${attackerControllerSelector}`) ||
      root.querySelector(attackerSelectorBase);
    if (!attackerElement) return;

    let targetElement;
    if (targetId === 'opponent-life-orb' || targetId === 'player-life-orb') {
      targetElement = root.querySelector(`#${targetId}`);
    } else {
      const targetController = Number.parseInt(targetControllerRaw ?? '', 10);
      const targetSelectorBase = `[data-card="${targetId}"]`;
      const targetControllerSelector = Number.isNaN(targetController)
        ? ''
        : `[data-controller="${targetController}"]`;
      targetElement =
        root.querySelector(`${targetSelectorBase}${targetControllerSelector}`) ||
        root.querySelector(targetSelectorBase);
    }
    if (!targetElement) return;
    
    // Calculate positions relative to the game view
    const attackerRect = attackerElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const containerRect = gameView.getBoundingClientRect();
    
    // Position from top center of attacker card
    const startX = attackerRect.left + (attackerRect.width / 2) - containerRect.left;
    const startY = attackerRect.top - containerRect.top;
    
    // Position to center of target
    const endX = targetRect.left + (targetRect.width / 2) - containerRect.left;
    const endY = targetRect.top + (targetRect.height / 2) - containerRect.top;
    
    // Calculate line properties
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    
    // Apply to SVG line
    line.setAttribute('x1', `${startX}`);
    line.setAttribute('y1', `${startY}`);
    line.setAttribute('x2', `${endX}`);
    line.setAttribute('y2', `${endY}`);
  });
}

function positionTargetLines(root) {
  const targetLines = root.querySelectorAll('.target-lines-svg .target-line');
  if (!targetLines.length) return;
  const gameView = root.querySelector('.game-view');
  if (!gameView) return;

  const containerRect = gameView.getBoundingClientRect();
  
  // Check if this is an ability - if so, find the source creature
  const isAbility = targetLines[0]?.classList.contains('ability');
  let startX, startY;
  
  if (isAbility && state.game?.pendingAction?.card?.instanceId) {
    // Find the creature card that owns this ability
    const creatureId = state.game.pendingAction.card.instanceId;
    const sourceCreature = root.querySelector(`[data-card="${creatureId}"][data-controller="0"]`);
    if (sourceCreature) {
      const sourceRect = sourceCreature.getBoundingClientRect();
      startX = sourceRect.left + sourceRect.width / 2 - containerRect.left;
      startY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
    } else {
      return; // Can't find source creature, skip positioning
    }
  } else {
    // Default to active spell panel for spells
    const activePanel = root.querySelector('.active-spell-panel');
    if (!activePanel) return;
    const sourceRect = activePanel.getBoundingClientRect();
    startX = sourceRect.left + sourceRect.width / 2 - containerRect.left;
    startY = sourceRect.bottom - containerRect.top;
  }

  targetLines.forEach((line) => {
    const targetId = line.dataset.target;
    const controllerRaw = line.dataset.targetController;
    let targetElement = null;
    if (targetId === 'opponent-life-orb' || targetId === 'player-life-orb') {
      targetElement = root.querySelector(`#${targetId}`);
    } else if (targetId) {
      const controller = Number.parseInt(controllerRaw ?? '', 10);
      const baseSelector = `[data-card="${targetId}"]`;
      const controllerSelector = Number.isNaN(controller) ? '' : `[data-controller="${controller}"]`;
      targetElement =
        root.querySelector(`${baseSelector}${controllerSelector}`) ||
        root.querySelector(baseSelector);
    }
    if (!targetElement) return;

    const targetRect = targetElement.getBoundingClientRect();
    const endX = targetRect.left + targetRect.width / 2 - containerRect.left;
    const endY = targetRect.top + targetRect.height / 2 - containerRect.top;

    line.setAttribute('x1', `${startX}`);
    line.setAttribute('y1', `${startY}`);
    line.setAttribute('x2', `${endX}`);
    line.setAttribute('y2', `${endY}`);
  });
}

function canCurrentUserAct() {
  const match = state.multiplayer.match;
  if (!match) return true;
  const userId = state.auth.user?.id;
  if (!userId) return false;
  const localSeat = state.multiplayer.localSeat;
  const localIndex = localSeat === 'guest' ? 1 : 0;
  const isPendingTarget = Boolean(state.game?.pendingAction && state.game.pendingAction.controller === localIndex);
  const isActiveTurn = match.activePlayer === localIndex;
  const game = state.game;
  const isBlockingTurn = Boolean(
    game?.combat &&
      game.combat.stage === 'blockers' &&
      game.blocking?.awaitingDefender &&
      localIndex === (game.currentPlayer === 0 ? 1 : 0),
  );
  return isActiveTurn || isPendingTarget || isBlockingTurn;
}

function maybeCleanupStaleLobbies(lobbies) {
  const now = Date.now();
  if (now - lastLobbyCleanupCheck < LOBBY_CLEANUP_THROTTLE_MS) {
    return;
  }

  const userId = state.auth.user?.id ?? null;
  let deletedAny = false;

  for (const lobby of lobbies) {
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

    db
      .transact(db.tx.lobbies[lobby.id].delete())
      .catch((error) => console.error('Failed to delete stale lobby', lobby.id, error));
    deletedAny = true;
  }

  if (deletedAny) {
    lastLobbyCleanupCheck = now;
  }
}

function refreshLobbySubscription() {
  cleanupLobbyListSubscription();

  state.multiplayer.lobbyList.loading = true;
  state.multiplayer.lobbyList.error = null;
  requestRender();

  const query = {
    lobbies: {
      $: {
        where: {
          status: { $in: ['open', 'ready', 'starting', 'playing'] },
        },
        orderBy: [
          { field: 'status', direction: 'asc' },
          { field: 'updatedAt', direction: 'desc' },
        ],
        limit: LOBBY_QUERY_LIMIT,
      },
    },
  };

  const unsubscribe = db.subscribeQuery(query, (snapshot) => {
    if (snapshot.error) {
      state.multiplayer.lobbyList.loading = false;
      state.multiplayer.lobbyList.error = snapshot.error.message || 'Failed to load lobbies.';
      state.multiplayer.lobbyList.lobbies = [];
      requestRender();
      return;
    }

    const searchTerm = state.multiplayer.lobbyList.searchTerm.trim().toLowerCase();
    const snapshotLobbies = snapshot.data?.lobbies ?? [];
    maybeCleanupStaleLobbies(snapshotLobbies);

    let lobbies = snapshotLobbies;
    if (searchTerm) {
      lobbies = lobbies.filter((lobby) => {
        const host = (lobby.hostDisplayName || '').toLowerCase();
        const guest = (lobby.guestDisplayName || '').toLowerCase();
        return host.includes(searchTerm) || guest.includes(searchTerm);
      });
    }

    state.multiplayer.lobbyList.lobbies = lobbies;
    state.multiplayer.lobbyList.loading = false;
    requestRender();
  });

  state.multiplayer.lobbySubscription = unsubscribe;
}

async function createLobby() {
  const user = state.auth.user;
  if (!user) {
    state.multiplayer.lobbyList.error = 'You must be signed in to create a lobby.';
    requestRender();
    return;
  }

  try {
    const lobbyId = generateId('lobby');
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

    await db.transact(db.tx.lobbies[lobbyId].update(lobby));
    cleanupActiveLobbySubscription();
    state.multiplayer.activeLobby = lobby;
    state.screen = 'multiplayer-lobby-detail';
    ensureActiveLobbySubscription(lobbyId);
    requestRender();
  } catch (error) {
    console.error('Failed to create lobby', error);
    state.multiplayer.lobbyList.error = 'Could not create lobby. Please try again.';
    requestRender();
  }
}

function convertMatchToGame() {
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
