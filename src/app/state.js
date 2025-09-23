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
    logExpanded: false,
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
  requestRender();
}

const rawViteId = import.meta.env.VITE_INSTANTDB_ID;
console.log('Raw VITE_INSTANTDB_ID value:', rawViteId);
const appId = typeof rawViteId === 'string' ? rawViteId.replace('VITE_INSTANTDB_ID=', '').trim() : '';
console.log('Cleaned appId value:', appId);
export const db = init({ appId });
