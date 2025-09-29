import { init } from '@instantdb/core';

export const initialState = {
  auth: {
    loading: true,
    user: null,
    error: null,
  },
  screen: 'loading',
  emailLogin: {
    email: '',
    codeSent: false,
    code: '',
    message: null,
  },
  multiplayer: {
    lobbyList: {
      loading: false,
      error: null,
      lobbies: [],
      searchTerm: '',
    },
    activeLobby: null,
    lobbySubscription: null,
    activeLobbySubscription: null,
    activeLobbySubscriptionId: null,
    cardCache: null,
    match: null,
    matchSubscription: null,
    matchEvents: [],
    localSeat: null,
    currentMatchId: null,
    lastSequenceApplied: 0,
    replayingEvents: false,
    autoJoinInFlight: null,
  },
  game: null,
  ui: {
    battleLogExpanded: false,
    spellLogExpanded: false,
    previewCard: null,
    openGraveFor: null, // controller index (0 = player, 1 = opponent)
  },
};

export const state = structuredClone(initialState);

let renderCallback = () => {};

export function registerRenderer(callback) {
  renderCallback = callback;
}

export function requestRender() {
  renderCallback();
}

export function setState(partial) {
  Object.assign(state, partial);
  requestRender();
}

export function resetEmailLogin() {
  state.emailLogin.email = '';
  state.emailLogin.code = '';
  state.emailLogin.codeSent = false;
  state.emailLogin.message = null;
}

export function resetToMenu() {
  state.game = null;
  state.multiplayer.activeLobby = null;
  state.multiplayer.match = null;
  state.multiplayer.lobbyList.loading = false;
  state.multiplayer.lobbyList.error = null;
  state.multiplayer.lobbyList.searchTerm = '';
  if (typeof state.multiplayer.lobbySubscription === 'function') {
    state.multiplayer.lobbySubscription();
  }
  state.multiplayer.lobbySubscription = null;
  if (typeof state.multiplayer.activeLobbySubscription === 'function') {
    state.multiplayer.activeLobbySubscription();
  }
  state.multiplayer.activeLobbySubscription = null;
  state.multiplayer.activeLobbySubscriptionId = null;
  if (typeof state.multiplayer.matchSubscription === 'function') {
    state.multiplayer.matchSubscription();
  }
  state.multiplayer.matchSubscription = null;
  state.multiplayer.match = null;
  state.multiplayer.matchEvents = [];
  state.multiplayer.localSeat = null;
  state.multiplayer.currentMatchId = null;
  state.multiplayer.lastSequenceApplied = 0;
  state.multiplayer.replayingEvents = false;
  state.multiplayer.autoJoinInFlight = null;
  state.screen = 'menu';
  state.ui.previewCard = null;
  requestRender();
}

const rawViteId = import.meta.env.VITE_INSTANTDB_ID;
const appId = typeof rawViteId === 'string' ? rawViteId.replace('VITE_INSTANTDB_ID=', '').trim() : '';
export const db = init({ appId });
