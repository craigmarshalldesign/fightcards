import './style.css';
import * as THREE from 'three';
import { init } from '@instantdb/core';
import { buildDeck, COLORS, createCardInstance } from './game/cards.js';

const APP_ID = import.meta.env.VITE_INSTANTDB_ID;
const db = init({ appId: APP_ID });

const root = document.querySelector('#app');
root.innerHTML = '';

const backgroundCanvas = document.createElement('canvas');
backgroundCanvas.id = 'bg-canvas';
root.appendChild(backgroundCanvas);

const uiLayer = document.createElement('div');
uiLayer.className = 'ui-layer';
root.appendChild(uiLayer);

initBackground(backgroundCanvas);

const initialState = {
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
};

const state = JSON.parse(JSON.stringify(initialState));

function setState(partial) {
  Object.assign(state, partial);
  render();
}

function resetToMenu() {
  state.game = null;
  state.screen = 'menu';
  render();
}

db.subscribeAuth((authState) => {
  if (authState.isLoading) {
    setState({
      auth: { loading: true, user: null, error: null },
      screen: 'loading',
    });
    return;
  }
  if (authState.error) {
    setState({
      auth: { loading: false, user: null, error: authState.error.message },
      screen: 'login',
    });
    return;
  }
  const user = authState.user ?? null;
  setState({
    auth: { loading: false, user, error: null },
    screen: user ? 'menu' : 'login',
  });
});

function render() {
  const { screen } = state;
  let content = '';
  if (screen === 'loading') {
    content = renderLoading();
  } else if (screen === 'login') {
    content = renderLogin();
  } else if (screen === 'menu') {
    content = renderMenu();
  } else if (screen === 'mode-select') {
    content = renderModeSelect();
  } else if (screen === 'color-select') {
    content = renderColorSelect();
  } else if (screen === 'game') {
    content = renderGame();
  } else if (screen === 'game-over') {
    content = renderGameOver();
  }
  uiLayer.innerHTML = content;
  attachEventHandlers();
}

function renderLoading() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Summoning the Arena...</h1>
        <p>Please wait.</p>
      </div>
    </div>
  `;
}

function renderLogin() {
  const { email, codeSent, code, message } = state.emailLogin;
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Elemental Clash</h1>
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

function renderMenu() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h1>Elemental Clash</h1>
        <p class="subtitle">Three elements collide in strategic battles.</p>
        <button class="primary" data-action="start">Start Game</button>
        <button data-action="signout">Sign out</button>
      </div>
    </div>
  `;
}

function renderModeSelect() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>Select Mode</h2>
        <button class="primary" data-action="choose-mode" data-mode="ai">Battle AI</button>
        <button class="disabled" disabled>Player vs Player (coming soon)</button>
        <button data-action="back-menu">Back</button>
      </div>
    </div>
  `;
}

function renderColorSelect() {
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>Choose Your Element</h2>
        <div class="color-grid">
          ${Object.entries(COLORS)
            .map(
              ([colorKey, info]) => `
                <button class="color-card" data-action="select-color" data-color="${colorKey}">
                  <span class="color-title">${info.name}</span>
                  <span class="color-desc">${info.theme}</span>
                </button>
              `,
            )
            .join('')}
        </div>
        <button data-action="back-menu">Back</button>
      </div>
    </div>
  `;
}
function renderGame() {
  const { game } = state;
  if (!game) return '';
  const player = game.players[0];
  const opponent = game.players[1];
  const logHtml = game.log
    .slice(-12)
    .map((entry) => `<li>${entry}</li>`)
    .join('');
  const pending = game.pendingAction;
  const blocking = game.blocking;
  return `
    <div class="view game-view">
      <header class="top-bar">
        <div>
          <strong>Turn ${game.turn}</strong>
          <div>${describePhase(game)}</div>
        </div>
        <div class="mana-display">Mana ${player.availableMana}/${player.maxMana}</div>
      </header>
      <section class="player-area opponent-area">
        ${renderPlayerBoard(opponent, game, true)}
      </section>
      <section class="info-area">
        <div class="life">Opponent Life: ${opponent.life}</div>
        <div class="life">Your Life: ${player.life}</div>
        ${pending ? renderPendingAction(pending, game) : ''}
        ${blocking ? renderBlocking(blocking, game) : ''}
        <div class="phase-controls">
          ${renderPhaseControls(game)}
        </div>
      </section>
      <section class="player-area your-area">
        ${renderPlayerBoard(player, game, false)}
      </section>
      <section class="hand-area">
        <h3>Your Hand</h3>
        <div class="hand-cards">
          ${player.hand.map((card) => renderCard(card, true, game)).join('')}
        </div>
      </section>
      <aside class="log-area">
        <h3>Log</h3>
        <ul>${logHtml || '<li>No events yet.</li>'}</ul>
      </aside>
    </div>
  `;
}

function renderGameOver() {
  const { game } = state;
  if (!game) return '';
  const winnerText = game.winner === 0 ? 'You won!' : game.winner === 1 ? 'AI wins.' : 'Game ended.';
  return `
    <div class="view view-center">
      <div class="card panel">
        <h2>${winnerText}</h2>
        <p>The battle is over. Ready to try again?</p>
        <button class="primary" data-action="restart">Play Again</button>
        <button data-action="back-menu">Main Menu</button>
      </div>
    </div>
  `;
}

function renderPlayerBoard(player, game, isOpponent) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const deckCount = player.deck.length;
  const handCount = player.hand.length;
  const graveCount = player.graveyard.length;
  const playerIndex = game.players.indexOf(player);
  return `
    <div class="board" data-player="${playerIndex}">
      <div class="player-header ${isOpponent ? 'opponent' : ''}">
        <div class="player-name">${player.name}</div>
        <div class="player-stats">Deck ${deckCount} · Hand ${handCount} · Grave ${graveCount}</div>
      </div>
      <div class="battlefield">
        ${creatures.map((creature) => renderCreature(creature, playerIndex, game)).join('') || '<p class="placeholder">No creatures</p>'}
      </div>
    </div>
  `;
}

function renderCreature(creature, controllerIndex, game) {
  const stats = getCreatureStats(creature, controllerIndex, game);
  const classes = ['card', 'creature-card'];
  if (creature.summoningSickness) classes.push('summoning');
  if (creature.frozenTurns) classes.push('frozen');
  const pending = game.pendingAction;
  if (pending && isTargetableCreature(creature, controllerIndex, pending)) {
    classes.push('targetable');
  }
  if (game.blocking && canSelectBlocker(creature, controllerIndex, game)) {
    classes.push('blocker-selectable');
  }
  if (game.blocking && isAttackingCreature(creature, controllerIndex, game)) {
    classes.push('attacker-card');
  }
  const abilityButtons = [];
  if (
    controllerIndex === 0 &&
    creature.activated &&
    !creature.activatedThisTurn &&
    (game.phase === 'main1' || game.phase === 'main2') &&
    game.currentPlayer === controllerIndex &&
    game.players[controllerIndex].availableMana >= creature.activated.cost
  ) {
    abilityButtons.push(
      `<button class="mini" data-action="activate" data-creature="${creature.instanceId}">${creature.activated.description}</button>`,
    );
  }
  return `
    <div class="${classes.join(' ')}" data-card="${creature.instanceId}" data-controller="${controllerIndex}">
      <div class="card-header">
        <span class="card-cost">${creature.cost ?? ''}</span>
        <span class="card-name">${creature.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${creature.text || ''}</p>
        ${creature.passive ? `<p class="card-passive">${creature.passive.description}</p>` : ''}
      </div>
      <div class="card-footer">
        <span>${stats.attack}/${stats.toughness}</span>
      </div>
      ${abilityButtons.length ? `<div class="ability">${abilityButtons.join('')}</div>` : ''}
    </div>
  `;
}

function renderCard(card, isHand, game) {
  const playable = isHand && canPlayCard(card, 0, game);
  const classes = ['card', card.type === 'creature' ? 'creature-card' : 'spell-card'];
  if (playable) classes.push('playable');
  const pending = game?.pendingAction;
  if (pending && pending.card.instanceId === card.instanceId) {
    classes.push('selected');
  }
  return `
    <div class="${classes.join(' ')}" data-card="${card.instanceId}" data-location="hand">
      <div class="card-header">
        <span class="card-cost">${card.cost ?? ''}</span>
        <span class="card-name">${card.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${card.text || ''}</p>
        ${card.type === 'creature' ? `<span class="card-stats">${card.baseAttack}/${card.baseToughness}</span>` : ''}
      </div>
    </div>
  `;
}

function renderPhaseControls(game) {
  const isPlayerTurn = game.currentPlayer === 0;
  if (!isPlayerTurn) {
    return `<p>AI is taking its turn...</p>`;
  }
  const buttons = [];
  if (game.phase === 'main1') {
    buttons.push('<button data-action="end-phase">Go to Combat</button>');
  } else if (game.phase === 'combat') {
    if (!game.combat || game.combat.stage === 'declare') {
      buttons.push('<button data-action="declare-attackers">Declare Attackers</button>');
    } else if (game.combat.stage === 'choose') {
      buttons.push('<button data-action="resolve-attacks">Finish Attack Step</button>');
    } else {
      buttons.push('<button data-action="skip-combat">Skip Combat</button>');
    }
  } else if (game.phase === 'main2') {
    buttons.push('<button data-action="end-phase">End Turn</button>');
  }
  return buttons.join('');
}

function renderPendingAction(pending) {
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return '';
  return `
    <div class="pending-overlay">
      <p>${describeRequirement(requirement)}</p>
      ${requirement.count > 1 ? `<button data-action="confirm-targets">Confirm targets (${pending.selectedTargets.length}/${requirement.count})</button>` : ''}
      <button data-action="cancel-action">Cancel</button>
    </div>
  `;
}

function renderBlocking(blocking, game) {
  const attackers = blocking.attackers
    .map((attacker) => {
      const stats = getCreatureStats(attacker.creature, attacker.controller, game);
      const assigned = blocking.assignments[attacker.creature.instanceId];
      const blockerName = assigned ? assigned.name : 'Unblocked';
      return `<li data-attacker="${attacker.creature.instanceId}">${attacker.creature.name} (${stats.attack}/${stats.toughness}) → <strong>${blockerName}</strong></li>`;
    })
    .join('');
  const instructions =
    game.players[1].isAI && game.currentPlayer === 0
      ? 'Select attackers and finish the attack step.'
      : 'Select a blocker then tap an attacker to assign it.';
  return `
    <div class="pending-overlay">
      <p>${instructions}</p>
      <ul>${attackers}</ul>
      ${game.currentPlayer === 1 ? '<button data-action="resolve-blocks">Resolve Combat</button>' : ''}
    </div>
  `;
}
function attachEventHandlers() {
  uiLayer.querySelectorAll('[data-action="start"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.screen = 'mode-select';
      render();
    });
  });
  uiLayer.querySelectorAll('[data-action="signout"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await db.auth.signOut();
        state.screen = 'login';
        render();
      } catch (err) {
        console.error(err);
      }
    });
  });
  uiLayer.querySelectorAll('[data-action="back-menu"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      resetToMenu();
    });
  });
  const modeBtn = uiLayer.querySelector('[data-action="choose-mode"]');
  if (modeBtn) {
    modeBtn.addEventListener('click', (event) => {
      const mode = event.currentTarget.getAttribute('data-mode');
      if (mode === 'ai') {
        state.screen = 'color-select';
        render();
      }
    });
  }
  uiLayer.querySelectorAll('[data-action="select-color"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color');
      startGame(color);
    });
  });
  const restartBtn = uiLayer.querySelector('[data-action="restart"]');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      state.screen = 'color-select';
      render();
    });
  }
  const emailForm = uiLayer.querySelector('#email-form');
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
      render();
    });
  }
  const verifyForm = uiLayer.querySelector('#verify-form');
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
      render();
    });
  }
  if (state.screen === 'game' && state.game) {
    bindGameEvents();
  }
}

function bindGameEvents() {
  uiLayer.querySelectorAll('[data-location="hand"]').forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      const cardId = cardEl.getAttribute('data-card');
      handleHandCardClick(cardId);
    });
  });
  uiLayer.querySelectorAll('.creature-card').forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      const cardId = cardEl.getAttribute('data-card');
      const controller = Number(cardEl.getAttribute('data-controller'));
      handleCreatureClick(cardId, controller);
    });
  });
  uiLayer.querySelectorAll('[data-action="end-phase"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      advancePhase();
    });
  });
  const declareBtn = uiLayer.querySelector('[data-action="declare-attackers"]');
  if (declareBtn) {
    declareBtn.addEventListener('click', () => {
      toggleCombatSelection();
    });
  }
  const resolveBtn = uiLayer.querySelector('[data-action="resolve-attacks"]');
  if (resolveBtn) {
    resolveBtn.addEventListener('click', () => {
      confirmAttackers();
    });
  }
  const skipBtn = uiLayer.querySelector('[data-action="skip-combat"]');
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      skipCombat();
    });
  }
  const confirmTargets = uiLayer.querySelector('[data-action="confirm-targets"]');
  if (confirmTargets) {
    confirmTargets.addEventListener('click', () => {
      finalizeCurrentRequirement();
    });
  }
  const cancelAction = uiLayer.querySelector('[data-action="cancel-action"]');
  if (cancelAction) {
    cancelAction.addEventListener('click', () => {
      cancelPendingAction();
    });
  }
  const resolveBlocksBtn = uiLayer.querySelector('[data-action="resolve-blocks"]');
  if (resolveBlocksBtn) {
    resolveBlocksBtn.addEventListener('click', () => {
      resolveCombat();
    });
  }
  uiLayer.querySelectorAll('[data-action="activate"]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const creatureId = event.currentTarget.getAttribute('data-creature');
      activateCreatureAbility(creatureId);
    });
  });
}
function handleHandCardClick(cardId) {
  const game = state.game;
  if (!game) return;
  const player = game.players[0];
  const card = player.hand.find((c) => c.instanceId === cardId);
  if (!card) return;
  if (!canPlayCard(card, 0, game)) {
    addLog('Cannot play that card right now.');
    render();
    return;
  }
  if (card.type === 'creature') {
    playCreature(0, card);
    render();
  } else {
    prepareSpell(0, card);
  }
}

function handleCreatureClick(cardId, controller) {
  const game = state.game;
  if (!game) return;
  const creature = game.players[controller].battlefield.find((c) => c.instanceId === cardId);
  if (!creature) return;
  if (game.pendingAction) {
    handleTargetSelection(creature, controller);
    return;
  }
  if (game.phase === 'combat' && game.currentPlayer === 0 && controller === 0) {
    toggleAttacker(creature);
    return;
  }
  if (game.blocking && game.currentPlayer === 1 && controller === 1) {
    game.blocking.selectedBlocker = creature;
    addLog(`${creature.name} ready to block.`);
    render();
    return;
  }
  if (game.blocking && game.currentPlayer === 1 && controller === 0) {
    assignBlockerToAttacker(creature);
  }
}

function startGame(color) {
  const playerName = state.auth.user?.email?.split('@')[0] || 'You';
  const aiColor = pickAIOpponent(color);
  const playerDeck = buildDeck(color);
  const aiDeck = buildDeck(aiColor);
  const player = createPlayer(playerName, color, false, playerDeck);
  const ai = createPlayer('AI Opponent', aiColor, true, aiDeck);
  const game = {
    players: [player, ai],
    currentPlayer: 0,
    phase: 'main1',
    turn: 1,
    log: [],
    pendingAction: null,
    combat: null,
    blocking: null,
    preventCombatDamageFor: null,
    winner: null,
    dice: rollForInitiative(),
  };
  game.currentPlayer = game.dice.winner;
  state.game = game;
  state.screen = 'game';
  addLog(
    `Initiative roll — You: ${game.dice.player}, AI: ${game.dice.ai}. ${game.currentPlayer === 0 ? 'You go first.' : 'AI goes first.'}`,
    game,
  );
  addLog(`AI Opponent will wield the ${COLORS[aiColor].name} deck.`, game);
  drawCards(player, 5);
  drawCards(ai, 5);
  if (game.currentPlayer === 0) {
    beginTurn(game.currentPlayer);
  } else {
    beginTurn(game.currentPlayer);
    setTimeout(() => runAI(), 700);
  }
  render();
}

function pickAIOpponent(playerColor) {
  const options = Object.keys(COLORS).filter((c) => c !== playerColor);
  return options[Math.floor(Math.random() * options.length)];
}

function createPlayer(name, color, isAI, deck) {
  return {
    id: `${name}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    color,
    isAI,
    deck: [...deck],
    hand: [],
    battlefield: [],
    graveyard: [],
    life: 15,
    maxMana: 0,
    availableMana: 0,
  };
}

function rollForInitiative() {
  let player = 0;
  let ai = 0;
  do {
    player = 1 + Math.floor(Math.random() * 6);
    ai = 1 + Math.floor(Math.random() * 6);
  } while (player === ai);
  return { player, ai, winner: player > ai ? 0 : 1 };
}

function addLog(message, gameOverride) {
  const target = gameOverride || state.game;
  if (!target) return;
  target.log.push(message);
  if (target.log.length > 50) {
    target.log.splice(0, target.log.length - 50);
  }
}

function drawCards(player, amount) {
  for (let i = 0; i < amount; i += 1) {
    if (!player.deck.length) {
      addLog(`${player.name} cannot draw more cards.`);
      break;
    }
    const card = player.deck.pop();
    player.hand.push(card);
  }
}

function beginTurn(playerIndex) {
  const game = state.game;
  const player = game.players[playerIndex];
  player.maxMana += 1;
  player.availableMana = player.maxMana;
  drawCards(player, 2);
  player.battlefield.forEach((creature) => {
    if (creature.frozenTurns) {
      creature.frozenTurns -= 1;
      creature.summoningSickness = true;
    } else {
      creature.summoningSickness = false;
    }
    creature.activatedThisTurn = false;
    if (creature.temporaryHaste) {
      creature.temporaryHaste = false;
    }
    if (creature.buffs) {
      creature.buffs = creature.buffs.filter((buff) => buff.duration !== 'endOfTurn');
    }
  });
  addLog(`${player.name} starts their turn with ${player.availableMana} mana.`);
  game.phase = 'main1';
  game.preventCombatDamageFor = null;
}
function endTurn() {
  const game = state.game;
  game.phase = 'main1';
  game.currentPlayer = game.currentPlayer === 0 ? 1 : 0;
  game.turn += 1;
  beginTurn(game.currentPlayer);
  render();
  if (game.currentPlayer === 1) {
    setTimeout(() => runAI(), 600);
  }
}

function canPlayCard(card, playerIndex, game) {
  if (!game) return false;
  const player = game.players[playerIndex];
  if (game.currentPlayer !== playerIndex) return false;
  if (!(game.phase === 'main1' || game.phase === 'main2')) return false;
  return player.availableMana >= (card.cost ?? 0);
}

function spendMana(player, amount) {
  player.availableMana = Math.max(0, player.availableMana - amount);
}

function playCreature(playerIndex, card) {
  const game = state.game;
  const player = game.players[playerIndex];
  removeFromHand(player, card.instanceId);
  spendMana(player, card.cost ?? 0);
  card.baseAttack = card.baseAttack ?? card.attack ?? 0;
  card.baseToughness = card.baseToughness ?? card.toughness ?? 0;
  card.summoningSickness = !card.abilities?.haste;
  card.damageMarked = 0;
  card.buffs = [];
  player.battlefield.push(card);
  addLog(`${player.name} summons ${card.name}.`);
  handlePassive(card, playerIndex, 'onEnter');
}

function removeFromHand(player, instanceId) {
  const index = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (index >= 0) {
    player.hand.splice(index, 1);
  }
}

function prepareSpell(playerIndex, card) {
  const game = state.game;
  const player = game.players[playerIndex];
  const requirements = computeRequirements(card);
  game.pendingAction = {
    type: 'spell',
    controller: playerIndex,
    card,
    requirements,
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
  };
  addLog(`${player.name} prepares ${card.name}.`);
  if (requirements.length === 0) {
    executeSpell(game.pendingAction);
  } else {
    render();
  }
}

function computeRequirements(card) {
  if (!card.effects) return [];
  const reqs = [];
  card.effects.forEach((effect, idx) => {
    if (effect.type === 'damage' && ['enemy-creature', 'friendly-creature', 'any', 'any-creature'].includes(effect.target)) {
      reqs.push({ effectIndex: idx, effect, count: 1, target: effect.target });
    }
    if (effect.type === 'buff' && effect.target === 'friendly-creature') {
      reqs.push({ effectIndex: idx, effect, count: 1, target: 'friendly-creature' });
    }
    if (effect.type === 'temporaryBuff' && effect.target === 'friendly-creature') {
      reqs.push({ effectIndex: idx, effect, count: 1, target: 'friendly-creature' });
    }
    if (effect.type === 'grantHaste' && effect.target === 'two-friendly') {
      reqs.push({ effectIndex: idx, effect, count: 2, target: 'friendly-creature', allowLess: true });
    }
    if (effect.type === 'multiBuff') {
      reqs.push({ effectIndex: idx, effect, count: effect.count, target: 'friendly-creature', allowLess: true });
    }
    if (effect.type === 'heal') {
      reqs.push({ effectIndex: idx, effect, count: 1, target: 'friendly-creature' });
    }
  });
  return reqs;
}

function handleTargetSelection(creature, controller) {
  const pending = state.game.pendingAction;
  if (!pending) return;
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return;
  if (!isTargetValid(creature, controller, requirement, pending)) {
    addLog('Invalid target.');
    render();
    return;
  }
  pending.selectedTargets.push({ creature, controller });
  if (pending.selectedTargets.length >= requirement.count) {
    finalizeCurrentRequirement();
  } else {
    render();
  }
}

function finalizeCurrentRequirement() {
  const game = state.game;
  const pending = game.pendingAction;
  if (!pending) return;
  const requirement = pending.requirements[pending.requirementIndex];
  pending.chosenTargets[requirement.effectIndex] = [...pending.selectedTargets];
  pending.selectedTargets = [];
  pending.requirementIndex += 1;
  if (pending.requirementIndex >= pending.requirements.length) {
    executeSpell(pending);
  } else {
    render();
  }
}

function cancelPendingAction() {
  const game = state.game;
  if (game.pendingAction) {
    game.pendingAction = null;
    addLog('Spell cancelled.');
    render();
  }
}

function executeSpell(pending) {
  const game = state.game;
  const player = game.players[pending.controller];
  removeFromHand(player, pending.card.instanceId);
  spendMana(player, pending.card.cost ?? 0);
  addLog(`${player.name} casts ${pending.card.name}.`);
  resolveEffects(pending.card.effects || [], pending);
  player.graveyard.push(pending.card);
  game.pendingAction = null;
  render();
  checkForWinner();
  if (game.currentPlayer === 1) {
    runAI();
  }
}

function resolveEffects(effects, pending) {
  effects.forEach((effect, idx) => {
    const targets = pending.chosenTargets[idx] || [];
    applyEffect(effect, pending.controller, targets, pending.card);
  });
}

function isTargetValid(creature, controller, requirement, pending) {
  if (requirement.target === 'friendly-creature') {
    return controller === pending.controller;
  }
  if (requirement.target === 'enemy-creature') {
    return controller !== pending.controller;
  }
  if (requirement.target === 'any-creature' || requirement.target === 'any') {
    return true;
  }
  return false;
}

function isTargetableCreature(creature, controller, pending) {
  const requirement = pending.requirements[pending.requirementIndex];
  if (!requirement) return false;
  return isTargetValid(creature, controller, requirement, pending);
}

function describeRequirement(requirement) {
  switch (requirement.target) {
    case 'friendly-creature':
      return 'Select a friendly creature.';
    case 'enemy-creature':
      return 'Select an enemy creature.';
    case 'any-creature':
    case 'any':
      return 'Select a creature.';
    default:
      return 'Choose targets.';
  }
}
function applyEffect(effect, controllerIndex, targets, sourceCard) {
  const game = state.game;
  const controller = game.players[controllerIndex];
  const opponentIndex = controllerIndex === 0 ? 1 : 0;
  const opponent = game.players[opponentIndex];
  switch (effect.type) {
    case 'damage': {
      if (effect.target === 'opponent') {
        dealDamageToPlayer(opponentIndex, effect.amount);
      } else if (effect.target === 'player') {
        dealDamageToPlayer(controllerIndex, effect.amount);
      } else if (targets.length) {
        targets.forEach((target) => {
          dealDamageToCreature(target.creature, target.controller, effect.amount);
        });
      }
      break;
    }
    case 'draw': {
      drawCards(controller, effect.amount);
      addLog(`${controller.name} draws ${effect.amount} card(s).`);
      break;
    }
    case 'damageAllEnemies': {
      dealDamageToPlayer(opponentIndex, effect.amount);
      opponent.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => dealDamageToCreature(creature, opponentIndex, effect.amount));
      break;
    }
    case 'damageAllCreatures': {
      if (effect.target === 'enemy') {
        opponent.battlefield
          .filter((c) => c.type === 'creature')
          .forEach((creature) => dealDamageToCreature(creature, opponentIndex, effect.amount));
      }
      break;
    }
    case 'temporaryBuff': {
      targets.forEach((target) => addTemporaryBuff(target.creature, effect.attack, effect.toughness));
      break;
    }
    case 'buff': {
      targets.forEach((target) => applyPermanentBuff(target.creature, effect.attack, effect.toughness));
      if (!targets.length && effect.type === 'buff' && effect.excludeSelf) {
        const allies = controller.battlefield.filter((c) => c.type === 'creature' && c.instanceId !== sourceCard.instanceId);
        if (allies.length) {
          applyPermanentBuff(allies[0], effect.attack, effect.toughness);
        }
      }
      break;
    }
    case 'grantHaste': {
      targets.forEach((target) => grantHaste(target.creature, effect.duration));
      break;
    }
    case 'createToken': {
      const token = instantiateToken(effect.token, controller.color);
      controller.battlefield.push(token);
      addLog(`${controller.name} creates ${token.name}.`);
      break;
    }
    case 'createMultipleTokens': {
      for (let i = 0; i < effect.count; i += 1) {
        const token = instantiateToken(effect.token, controller.color);
        controller.battlefield.push(token);
        addLog(`${controller.name} creates ${token.name}.`);
      }
      break;
    }
    case 'bounce': {
      if (targets.length) {
        targets.forEach((target) => bounceCreature(target.creature, target.controller));
      }
      break;
    }
    case 'massBounce': {
      bounceStrongestCreatures(opponentIndex, effect.amount);
      break;
    }
    case 'bounceAttackers': {
      if (game.combat?.attackers) {
        game.combat.attackers.forEach((attacker) => bounceCreature(attacker.creature, attacker.controller));
        game.combat = null;
        game.blocking = null;
        addLog('All attackers returned to hand.');
      }
      break;
    }
    case 'freeze': {
      targets.forEach((target) => freezeCreature(target.creature));
      break;
    }
    case 'damageAttackers': {
      if (game.combat?.attackers) {
        game.combat.attackers.forEach((attacker) => {
          dealDamageToCreature(attacker.creature, attacker.controller, effect.amount);
        });
      }
      break;
    }
    case 'heal': {
      targets.forEach((target) => {
        target.creature.damageMarked = 0;
      });
      break;
    }
    case 'gainLife': {
      controller.life += effect.amount;
      addLog(`${controller.name} gains ${effect.amount} life.`);
      break;
    }
    case 'preventCombatDamage': {
      game.preventCombatDamageFor = controllerIndex;
      addLog(`${controller.name} prevents combat damage this turn.`);
      break;
    }
    case 'teamBuff': {
      controller.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => applyPermanentBuff(creature, effect.attack, effect.toughness));
      break;
    }
    case 'multiBuff': {
      targets.forEach((target) => applyPermanentBuff(target.creature, effect.attack, effect.toughness));
      break;
    }
    case 'revive': {
      if (controller.graveyard.length) {
        const revived = controller.graveyard.pop();
        controller.hand.push(revived);
        addLog(`${controller.name} returns ${revived.name} to hand.`);
      }
      break;
    }
    case 'splashDamage': {
      distributeSplashDamage(opponentIndex, effect.amount);
      break;
    }
    case 'selfBuff': {
      if (sourceCard) {
        applyPermanentBuff(sourceCard, effect.attack, effect.toughness);
      }
      break;
    }
    default:
      break;
  }
  checkForDeadCreatures();
}

function instantiateToken(tokenDef, color) {
  const tokenCard = {
    id: `${tokenDef.name}-${Math.random().toString(36).slice(2, 7)}`,
    name: tokenDef.name,
    type: 'creature',
    color,
    cost: 0,
    attack: tokenDef.attack,
    toughness: tokenDef.toughness,
    abilities: tokenDef.abilities || {},
    text: tokenDef.text || 'Token creature',
  };
  const instance = createCardInstance(tokenCard);
  instance.isToken = true;
  return instance;
}

function bounceCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  creature.summoningSickness = !creature.abilities?.haste;
  player.hand.push(creature);
  addLog(`${creature.name} returns to ${player.name}'s hand.`);
}

function bounceStrongestCreatures(controllerIndex, amount) {
  const player = state.game.players[controllerIndex];
  const targets = player.battlefield
    .filter((c) => c.type === 'creature')
    .sort((a, b) => getCreatureStats(b, controllerIndex, state.game).attack - getCreatureStats(a, controllerIndex, state.game).attack)
    .slice(0, amount);
  targets.forEach((creature) => bounceCreature(creature, controllerIndex));
}

function freezeCreature(creature) {
  creature.frozenTurns = Math.max(1, creature.frozenTurns || 0);
  creature.summoningSickness = true;
  addLog(`${creature.name} is frozen.`);
}

function distributeSplashDamage(opponentIndex, amount) {
  const opponent = state.game.players[opponentIndex];
  const creatures = opponent.battlefield.filter((c) => c.type === 'creature');
  if (creatures.length === 0) {
    dealDamageToPlayer(opponentIndex, amount);
    return;
  }
  let remaining = amount;
  while (remaining > 0 && creatures.length > 0) {
    const target = creatures[Math.floor(Math.random() * creatures.length)];
    dealDamageToCreature(target, opponentIndex, 1);
    remaining -= 1;
  }
  if (remaining > 0) {
    dealDamageToPlayer(opponentIndex, remaining);
  }
}

function addTemporaryBuff(creature, attack, toughness) {
  if (!creature.buffs) creature.buffs = [];
  creature.buffs.push({ attack, toughness, duration: 'endOfTurn' });
}

function applyPermanentBuff(creature, attack, toughness) {
  creature.baseAttack += attack;
  creature.baseToughness += toughness;
}

function grantHaste(creature, duration) {
  creature.abilities = creature.abilities || {};
  creature.abilities.haste = true;
  creature.summoningSickness = false;
  if (duration === 'turn') {
    creature.temporaryHaste = true;
  }
}

function removeFromBattlefield(player, instanceId) {
  const index = player.battlefield.findIndex((c) => c.instanceId === instanceId);
  if (index >= 0) {
    player.battlefield.splice(index, 1);
  }
}

function dealDamageToCreature(creature, controllerIndex, amount) {
  const stats = getCreatureStats(creature, controllerIndex, state.game);
  creature.damageMarked = (creature.damageMarked || 0) + amount;
  if (creature.damageMarked >= stats.toughness) {
    destroyCreature(creature, controllerIndex);
  }
}

function destroyCreature(creature, controllerIndex) {
  const player = state.game.players[controllerIndex];
  removeFromBattlefield(player, creature.instanceId);
  creature.damageMarked = 0;
  player.graveyard.push(creature);
  addLog(`${creature.name} is defeated.`);
}

function dealDamageToPlayer(index, amount) {
  const player = state.game.players[index];
  player.life -= amount;
  addLog(`${player.name} takes ${amount} damage (life ${player.life}).`);
  checkForWinner();
}

function getCreatureStats(creature, controllerIndex, game) {
  let attack = creature.baseAttack ?? creature.attack ?? 0;
  let toughness = creature.baseToughness ?? creature.toughness ?? 0;
  if (creature.buffs) {
    creature.buffs.forEach((buff) => {
      attack += buff.attack || 0;
      toughness += buff.toughness || 0;
    });
  }
  const controller = game.players[controllerIndex];
  controller.battlefield.forEach((card) => {
    if (card.passive?.type === 'static' && card.passive.effect.type === 'globalBuff') {
      const { scope, attack: atk = 0, toughness: tough = 0 } = card.passive.effect;
      if (scope === 'friendly' || (scope === 'other-friendly' && card.instanceId !== creature.instanceId)) {
        attack += atk;
        toughness += tough;
      }
    }
  });
  return { attack: Math.max(0, attack), toughness: Math.max(1, toughness) };
}
function checkForDeadCreatures() {
  state.game.players.forEach((player, idx) => {
    player.battlefield
      .filter((c) => c.type === 'creature' && c.damageMarked >= getCreatureStats(c, idx, state.game).toughness)
      .forEach((creature) => destroyCreature(creature, idx));
  });
}

function describePhase(game) {
  const map = {
    main1: 'Main Phase',
    combat: 'Combat',
    main2: 'Second Main',
  };
  return map[game.phase] || 'Phase';
}

function startCombatStage() {
  const game = state.game;
  game.combat = { attackers: [], stage: 'declare' };
  game.blocking = { attackers: [], assignments: {}, selectedBlocker: null };
  addLog('Combat begins.');
}

function toggleCombatSelection() {
  const game = state.game;
  if (!game.combat) {
    startCombatStage();
  }
  game.combat.stage = 'choose';
  render();
}

function toggleAttacker(creature) {
  const game = state.game;
  if (!game.combat) return;
  if (creature.summoningSickness) {
    addLog(`${creature.name} cannot attack this turn.`);
    render();
    return;
  }
  const existing = game.combat.attackers.find((atk) => atk.creature.instanceId === creature.instanceId);
  if (existing) {
    game.combat.attackers = game.combat.attackers.filter((atk) => atk.creature.instanceId !== creature.instanceId);
  } else {
    game.combat.attackers.push({ creature, controller: 0 });
    handlePassive(creature, 0, 'onAttack');
  }
  render();
}

function confirmAttackers() {
  const game = state.game;
  if (!game.combat || game.combat.attackers.length === 0) {
    addLog('No attackers declared.');
    skipCombat();
    return;
  }
  addLog(`Attacking with ${game.combat.attackers.length} creature(s).`);
  prepareBlocks();
}

function skipCombat() {
  const game = state.game;
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  addLog('Combat skipped.');
  render();
}

function prepareBlocks() {
  const game = state.game;
  game.blocking = {
    attackers: [...game.combat.attackers],
    assignments: {},
    selectedBlocker: null,
  };
  const defending = 1;
  if (game.players[defending].isAI) {
    aiAssignBlocks();
    resolveCombat();
  } else {
    render();
  }
}

function aiAssignBlocks() {
  const game = state.game;
  const defenders = game.players[1].battlefield.filter((c) => c.type === 'creature');
  game.blocking.attackers.forEach((attacker) => {
    const blocker = defenders.shift();
    if (blocker) {
      game.blocking.assignments[attacker.creature.instanceId] = blocker;
    }
  });
}

function assignBlockerToAttacker(attackerCreature) {
  const game = state.game;
  if (!game.blocking) return;
  const blocker = game.blocking.selectedBlocker;
  if (!blocker) {
    addLog('Select a blocker first.');
    render();
    return;
  }
  game.blocking.assignments[attackerCreature.instanceId] = blocker;
  game.blocking.selectedBlocker = null;
  addLog(`${blocker.name} blocks ${attackerCreature.name}.`);
  render();
}

function resolveCombat() {
  const game = state.game;
  if (!game.combat) {
    game.phase = 'main2';
    render();
    return;
  }
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  game.combat.attackers.forEach((attacker) => {
    const attackerStats = getCreatureStats(attacker.creature, attacker.controller, game);
    const blocker = game.blocking.assignments[attacker.creature.instanceId];
    if (!blocker) {
      if (game.preventCombatDamageFor !== defendingIndex) {
        dealDamageToPlayer(defendingIndex, attackerStats.attack);
      }
      return;
    }
    const blockerStats = getCreatureStats(blocker, defendingIndex, game);
    if (attackerStats.attack >= blockerStats.toughness) {
      destroyCreature(blocker, defendingIndex);
    } else {
      blocker.damageMarked = (blocker.damageMarked || 0) + attackerStats.attack;
    }
    if (blockerStats.attack >= attackerStats.toughness) {
      destroyCreature(attacker.creature, attacker.controller);
    } else {
      attacker.creature.damageMarked = (attacker.creature.damageMarked || 0) + blockerStats.attack;
    }
  });
  checkForDeadCreatures();
  game.combat = null;
  game.blocking = null;
  game.phase = 'main2';
  render();
}

function checkForWinner() {
  const game = state.game;
  if (game.winner != null) return;
  if (game.players[0].life <= 0) {
    game.winner = 1;
    state.screen = 'game-over';
  } else if (game.players[1].life <= 0) {
    game.winner = 0;
    state.screen = 'game-over';
  }
  if (game.winner != null) {
    render();
  }
}

function runAI() {
  const game = state.game;
  if (!game || game.currentPlayer !== 1 || game.winner != null) return;
  const aiPlayer = game.players[1];
  if (game.phase === 'main1' || game.phase === 'main2') {
    const played = aiPlayTurnStep(aiPlayer);
    if (!played) {
      advancePhase();
    } else {
      setTimeout(() => runAI(), 500);
    }
    return;
  }
  if (game.phase === 'combat') {
    aiDeclareAttacks();
    resolveCombat();
    setTimeout(() => runAI(), 500);
    return;
  }
}

function aiPlayTurnStep(aiPlayer) {
  const game = state.game;
  const playable = aiPlayer.hand.find((card) => canPlayCard(card, 1, game));
  if (!playable) return false;
  if (playable.type === 'creature') {
    playCreature(1, playable);
  } else {
    const requirements = computeRequirements(playable);
    const pending = {
      controller: 1,
      card: playable,
      requirements,
      requirementIndex: 0,
      selectedTargets: [],
      chosenTargets: {},
    };
    requirements.forEach((req) => {
      const targets = pickTargetsForAI(req, 1);
      pending.chosenTargets[req.effectIndex] = targets;
    });
    removeFromHand(aiPlayer, playable.instanceId);
    spendMana(aiPlayer, playable.cost ?? 0);
    addLog(`${aiPlayer.name} casts ${playable.name}.`);
    resolveEffects(playable.effects || [], pending);
    aiPlayer.graveyard.push(playable);
  }
  render();
  return true;
}

function pickTargetsForAI(requirement, controllerIndex) {
  const game = state.game;
  if (requirement.target === 'friendly-creature') {
    return game.players[controllerIndex].battlefield
      .filter((c) => c.type === 'creature')
      .slice(0, requirement.count)
      .map((creature) => ({ creature, controller: controllerIndex }));
  }
  if (requirement.target === 'enemy-creature') {
    return game.players[controllerIndex === 0 ? 1 : 0].battlefield
      .filter((c) => c.type === 'creature')
      .slice(0, requirement.count)
      .map((creature) => ({ creature, controller: controllerIndex === 0 ? 1 : 0 }));
  }
  return [];
}

function aiDeclareAttacks() {
  const game = state.game;
  const attackers = game.players[1].battlefield.filter((c) => c.type === 'creature' && !c.summoningSickness);
  if (attackers.length === 0) {
    skipCombat();
    return;
  }
  game.combat = { attackers: attackers.map((creature) => ({ creature, controller: 1 })), stage: 'declare' };
  attackers.forEach((creature) => handlePassive(creature, 1, 'onAttack'));
  game.blocking = { attackers: [...game.combat.attackers], assignments: {}, selectedBlocker: null };
  render();
}

function handlePassive(card, controllerIndex, trigger) {
  if (!card.passive || card.passive.type !== trigger) return;
  const effect = card.passive.effect;
  if (!effect) return;
  const pending = {
    controller: controllerIndex,
    card,
    requirements: [],
    requirementIndex: 0,
    selectedTargets: [],
    chosenTargets: {},
  };
  if (effect.type === 'damage' && effect.target === 'opponent') {
    dealDamageToPlayer(controllerIndex === 0 ? 1 : 0, effect.amount);
    return;
  }
  if (effect.type === 'damage' && effect.target === 'enemy-creature') {
    const enemy = state.game.players[controllerIndex === 0 ? 1 : 0].battlefield.find((c) => c.type === 'creature');
    if (enemy) {
      dealDamageToCreature(enemy, controllerIndex === 0 ? 1 : 0, effect.amount);
    }
    return;
  }
  if (effect.type === 'damage' && effect.target === 'any') {
    const enemySide = state.game.players[controllerIndex === 0 ? 1 : 0];
    const enemyCreature = enemySide.battlefield
      .filter((c) => c.type === 'creature')
      .sort(
        (a, b) =>
          getCreatureStats(b, controllerIndex === 0 ? 1 : 0, state.game).toughness -
          getCreatureStats(a, controllerIndex === 0 ? 1 : 0, state.game).toughness,
      )[0];
    if (enemyCreature) {
      dealDamageToCreature(enemyCreature, controllerIndex === 0 ? 1 : 0, effect.amount);
    } else {
      dealDamageToPlayer(controllerIndex === 0 ? 1 : 0, effect.amount);
    }
    return;
  }
  if (effect.type === 'buff' && effect.excludeSelf) {
    const allies = state.game.players[controllerIndex].battlefield
      .filter((c) => c.instanceId !== card.instanceId && c.type === 'creature')
      .sort((a, b) => getCreatureStats(b, controllerIndex, state.game).attack - getCreatureStats(a, controllerIndex, state.game).attack);
    if (allies.length) {
      applyPermanentBuff(allies[0], effect.attack, effect.toughness);
    }
    return;
  }
  if (effect.type === 'globalBuff') {
    state.game.players[controllerIndex].battlefield
      .filter((c) => c.type === 'creature')
      .forEach((creature) => applyPermanentBuff(creature, effect.attack, effect.toughness));
  }
  if (effect.type === 'gainLife') {
    state.game.players[controllerIndex].life += effect.amount;
  }
  if (effect.type === 'draw') {
    drawCards(state.game.players[controllerIndex], effect.amount);
  }
}

function activateCreatureAbility(creatureId) {
  const game = state.game;
  const creature = game.players[0].battlefield.find((c) => c.instanceId === creatureId);
  if (!creature || !creature.activated || creature.activatedThisTurn) return;
  if (game.players[0].availableMana < creature.activated.cost) return;
  spendMana(game.players[0], creature.activated.cost);
  creature.activatedThisTurn = creature.activated.oncePerTurn || false;
  const effect = creature.activated.effect;
  const pending = { controller: 0, card: creature, requirements: [], requirementIndex: 0, selectedTargets: [], chosenTargets: {} };
  if (effect.type === 'selfBuff') {
    applyPermanentBuff(creature, effect.attack, effect.toughness);
    render();
    return;
  }
  if (effect.type === 'temporaryBuff' || effect.type === 'buff') {
    const target = game.players[0].battlefield.find((c) => c.type === 'creature');
    if (target) {
      pending.chosenTargets[0] = [{ creature: target, controller: 0 }];
    }
  }
  resolveEffects([effect], pending);
  render();
}

function describePhaseDetailed(game) {
  return `${describePhase(game)} — ${game.currentPlayer === 0 ? 'Your turn' : 'AI turn'}`;
}

function describeGameState() {
  if (!state.game) return 'Loading...';
  return describePhaseDetailed(state.game);
}
function canSelectBlocker(creature, controllerIndex, game) {
  if (!game.blocking) return false;
  if (game.currentPlayer === 0 && controllerIndex === 0) {
    return !creature.summoningSickness;
  }
  if (game.currentPlayer === 1 && controllerIndex === 1) {
    return true;
  }
  return false;
}

function isAttackingCreature(creature, controllerIndex, game) {
  if (!game.combat) return false;
  return game.combat.attackers.some((atk) => atk.creature.instanceId === creature.instanceId);
}
function initBackground(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 100);
  camera.position.z = 3;

  const geometry = new THREE.IcosahedronGeometry(1.4, 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x3366ff, wireframe: true, transparent: true, opacity: 0.25 });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const light = new THREE.PointLight(0xffffff, 1.2);
  light.position.set(2, 3, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x335577, 0.6));

  function resize() {
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    const height = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(time) {
    requestAnimationFrame(animate);
    mesh.rotation.x = time * 0.0002;
    mesh.rotation.y = time * 0.0003;
    material.opacity = 0.2 + 0.05 * Math.sin(time * 0.001);
    resize();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  resize();
  animate(0);
}

render();
