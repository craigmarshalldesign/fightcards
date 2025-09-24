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
  game: null,
  ui: {
    battleLogExpanded: false,
    spellLogExpanded: false,
    previewCard: null,
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
  state.screen = 'menu';
  state.ui.previewCard = null;
  requestRender();
}

const rawViteId = import.meta.env.VITE_INSTANTDB_ID;
const appId = typeof rawViteId === 'string' ? rawViteId.replace('VITE_INSTANTDB_ID=', '').trim() : '';
export const db = init({ appId });
