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
} from '../multiplayer/runtime.js';

const LOBBY_QUERY_LIMIT = 20;

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
      requestRender();
      return;
    }
    const lobby = snapshot.data?.lobbies?.[0] ?? null;
    state.multiplayer.activeLobby = lobby;
    if (!lobby) {
      state.multiplayer.activeLobbySubscription = null;
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

export function attachEventHandlers(root) {
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

  const backModeSelectBtn = root.querySelector('[data-action="back-mode-select"]');
  if (backModeSelectBtn) {
    backModeSelectBtn.addEventListener('click', () => {
      state.screen = 'mode-select';
      requestRender();
    });
  }

  const lobbySearchInput = root.querySelector('[data-action="search-lobbies"]');
  if (lobbySearchInput) {
    lobbySearchInput.addEventListener('input', (event) => {
      const value = event.target.value ?? '';
      state.multiplayer.lobbyList.searchTerm = value;
      requestRender();
    });
    lobbySearchInput.addEventListener('change', () => {
      refreshLobbySubscription();
    });
    lobbySearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        refreshLobbySubscription();
      }
    });
  }

  const clearSearchBtn = root.querySelector('[data-action="clear-search"]');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      state.multiplayer.lobbyList.searchTerm = '';
      refreshLobbySubscription();
      const input = root.querySelector('[data-action="search-lobbies"]');
      if (input) {
        input.value = '';
      }
      requestRender();
    });
  }

  root.querySelectorAll('[data-action="create-lobby"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await createLobby();
    });
  });

  root.querySelectorAll('[data-action="view-lobby"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const lobbyId = event.currentTarget.getAttribute('data-lobby');
      if (!lobbyId) return;
      const lobby = state.multiplayer.lobbyList.lobbies.find((l) => l.id === lobbyId);
      state.multiplayer.activeLobby = lobby || null;
      state.screen = 'multiplayer-lobby-detail';
      ensureActiveLobbySubscription(lobbyId);
      if (lobby?.matchId) {
        subscribeToMatch(lobby.matchId);
      }
      requestRender();
    });
  });

  const backLobbiesBtn = root.querySelector('[data-action="back-lobbies"]');
  if (backLobbiesBtn) {
    backLobbiesBtn.addEventListener('click', () => {
      cleanupActiveLobbySubscription();
      clearMatch();
      state.multiplayer.activeLobby = null;
      state.screen = 'multiplayer-lobbies';
      requestRender();
    });
  }

  root.querySelectorAll('[data-action="claim-seat"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const seat = event.currentTarget.getAttribute('data-seat');
      if (!seat) return;
      await claimSeat(seat);
    });
  });

  root.querySelectorAll('[data-action="leave-seat"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const seat = event.currentTarget.getAttribute('data-seat');
      if (!seat) return;
      await leaveSeat(seat);
    });
  });

  root.querySelectorAll('[data-action="choose-deck"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const seat = event.currentTarget.getAttribute('data-seat');
      const color = event.currentTarget.getAttribute('data-color');
      if (!seat || !color) return;
      await chooseDeck(seat, color);
    });
  });

  root.querySelectorAll('[data-action="toggle-ready"]').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const seat = event.currentTarget.getAttribute('data-seat');
      if (!seat) return;
      await toggleReady(seat);
    });
  });

  const startMatchBtn = root.querySelector('[data-action="start-match"]');
  if (startMatchBtn) {
    startMatchBtn.addEventListener('click', async () => {
      await startMatch();
    });
  }

  const restartBtn = root.querySelector('[data-action="restart"]');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      state.screen = 'color-select';
      requestRender();
    });
  }

  if (state.screen === 'multiplayer-game' && state.multiplayer.match) {
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
    [seatNameKey]: deriveDisplayName(user),
    [seatReadyKey]: false,
    [seatColorKey]: lobby[seatColorKey] ?? null,
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
    [seatUserKey]: null,
    [seat === 'host' ? 'hostDisplayName' : 'guestDisplayName']: null,
    [seat === 'host' ? 'hostColor' : 'guestColor']: null,
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

  const matchId = await db.getLocalId('matches');
  const now = Date.now();
  const diceRolls = {
    host: 1 + Math.floor(Math.random() * 6),
    guest: 1 + Math.floor(Math.random() * 6),
  };
  let winner = null;
  if (diceRolls.host !== diceRolls.guest) {
    winner = diceRolls.host > diceRolls.guest ? 0 : 1;
  }

  const match = {
    id: matchId,
    lobbyId: lobby.id,
    status: 'starting',
    activePlayer: winner ?? 0,
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
    createdAt: now,
    updatedAt: now,
  };

  await db.transact([
    db.tx.matches[matchId].update(match),
    db.tx.lobbies[lobby.id].update({
      matchId,
      status: 'starting',
      updatedAt: now,
    }),
  ]);
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
