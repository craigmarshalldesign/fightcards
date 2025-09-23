import { db, state, resetToMenu, requestRender } from '../state.js';
import {
  startGame,
  advancePhase,
  confirmAttackers,
  skipCombat,
  finalizeCurrentRequirement,
  cancelPendingAction,
  resolveCombat,
} from '../game/core.js';
import { handleHandCardClick, handleCreatureClick, activateCreatureAbility } from '../game/interactions.js';

export function attachEventHandlers(root) {
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

  const modeBtn = root.querySelector('[data-action="choose-mode"]');
  if (modeBtn) {
    modeBtn.addEventListener('click', (event) => {
      const mode = event.currentTarget.getAttribute('data-mode');
      if (mode === 'ai') {
        state.screen = 'color-select';
        requestRender();
      }
    });
  }

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

  const toggleLogBtn = root.querySelector('[data-action="toggle-log"]');
  if (toggleLogBtn) {
    toggleLogBtn.addEventListener('click', () => {
      state.ui.logExpanded = !state.ui.logExpanded;
      requestRender();
    });
  }

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
      const cardId = cardEl.getAttribute('data-card');
      handleHandCardClick(cardId);
    });
  });

  root.querySelectorAll('.creature-card').forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      const cardId = cardEl.getAttribute('data-card');
      const controller = Number(cardEl.getAttribute('data-controller'));
      handleCreatureClick(cardId, controller);
    });
  });

  root.querySelectorAll('[data-action="end-phase"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      advancePhase();
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

  const confirmTargets = root.querySelector('[data-action="confirm-targets"]');
  if (confirmTargets) {
    confirmTargets.addEventListener('click', () => {
      finalizeCurrentRequirement();
    });
  }

  const cancelAction = root.querySelector('[data-action="cancel-action"]');
  if (cancelAction) {
    cancelAction.addEventListener('click', () => {
      cancelPendingAction();
    });
  }

  const resolveBlocksBtn = root.querySelector('[data-action="declare-blocks"]');
  if (resolveBlocksBtn) {
    resolveBlocksBtn.addEventListener('click', () => {
      resolveCombat();
    });
  }

  root.querySelectorAll('[data-action="activate"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const creatureId = event.currentTarget.getAttribute('data-creature');
      activateCreatureAbility(creatureId);
    });
  });
}
