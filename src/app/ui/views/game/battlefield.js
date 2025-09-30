import { isTargetablePlayer, isTargetableCreature, canSelectBlocker, isAttackingCreature } from '../../../game/core/index.js';
import { getCreatureStats } from '../../../game/creatures.js';
import { renderBattlefieldSkin } from '../battlefield/index.js';
import { renderStatusChips, getCardColorClass } from './cards.js';
import { escapeHtml, sanitizeClass, getPassivePreviewInfo } from './shared.js';
import { getLocalSeat, getLocalSeatIndex } from '../../../multiplayer/runtime.js';

export function renderBattlefieldSection({ player, opponent, game }) {
  const localSeat = getLocalSeat();
  const isHostLocal = localSeat === 'host' || !localSeat;
  const bottomPlayer = isHostLocal ? game.players[0] : game.players[1];
  const topPlayer = isHostLocal ? game.players[1] : game.players[0];
  return `
    <section class="battlefield-area">
      <div class="battle-row opponent-row">
        ${renderPlayerBoard(topPlayer, game, true)}
      </div>
      ${renderBattlefieldCrevice()}
      <div class="battle-row player-row">
        ${renderPlayerBoard(bottomPlayer, game, false)}
      </div>
    </section>
  `;
}

export function renderPlayerStatBar(player, game, isOpponent) {
  const localSeat = getLocalSeat();
  const isLocal = (localSeat === 'host' && player === game.players[0]) || (localSeat === 'guest' && player === game.players[1]) || (!localSeat && player === game.players[0]);
  const deckCount = player.deck.length;
  const handCount = player.hand.length;
  const graveCount = player.graveyard.length;
  const playerIndex = game.players.indexOf(player);
  const maxLife = 30;
  const lifePercentage = Math.max(0, Math.min(100, (player.life / maxLife) * 100));
  let lifeColor = 'healthy';
  if (lifePercentage <= 25) {
    lifeColor = 'critical';
  } else if (lifePercentage <= 50) {
    lifeColor = 'warning';
  }

  const pending = game.pendingAction;
  const isLifeTargetable = pending ? isTargetablePlayer(playerIndex, pending) : false;
  const isLifeChosen = pending
    ? Boolean(
        pending.selectedTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
          pending.previewTargets?.some((target) => target.type === 'player' && target.controller === playerIndex) ||
          Object.values(pending.chosenTargets || {}).some((list) =>
            (list || []).some((target) => target.type === 'player' && target.controller === playerIndex),
          ),
      )
    : false;
  const lifeOrbClasses = ['life-orb', `life-${lifeColor}`];
  if (isLifeTargetable) lifeOrbClasses.push('targetable');
  if (isLifeChosen) lifeOrbClasses.push('targeted');
  const lifeOrbId = isOpponent ? 'opponent-life-orb' : 'player-life-orb';

  const colorClass = sanitizeClass(player.color || 'neutral');
  return `
    <section class="player-stat-bar ${isOpponent ? 'opponent-stat-bar' : 'player-stat-bar'} player-color-${colorClass}">
      <div class="stat-bar-content">
        <div class="player-identity">
          <div class="player-icon">${renderDeckIcon(player.color)}</div>
          <div class="player-name">${player.name}</div>
          <div class="player-type">${isLocal ? 'You' : 'Opponent'}</div>
        </div>

        <div class="life-orb-container">
          <div class="${lifeOrbClasses.join(' ')}" id="${lifeOrbId}" data-player-target="${playerIndex}">
            <div class="life-orb-fill" style="height: ${lifePercentage}%"></div>
            <div class="life-value">${player.life}</div>
          </div>
          <div class="life-label">Life</div>
        </div>

        <div class="card-counts">
          <div class="card-count-item">
            <div class="count-icon-clean">💎</div>
            <div class="count-value">${player.availableMana}/${player.maxMana}</div>
            <div class="count-label">Mana</div>
          </div>
          <div class="card-count-item">
            <div class="count-icon-clean">🎴</div>
            <div class="count-value">${deckCount}</div>
            <div class="count-label">Deck</div>
          </div>
          <div class="card-count-item">
            <div class="count-icon-clean">🪬</div>
            <div class="count-value">${handCount}</div>
            <div class="count-label">Hand</div>
          </div>
          <div class="card-count-item" data-open-grave="${playerIndex}" tabindex="0" role="button" aria-label="Open graveyard">
            <div class="count-icon-clean">💀</div>
            <div class="count-value">${graveCount}</div>
            <div class="count-label">Grave</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function renderTargetLines(game) {
  const pending = game.pendingAction;
  if (!pending) return '';

  const targets = [];
  const seen = new Set();

  const pushTargets = (list = [], variant) => {
    list.forEach((target) => {
      if (!target) return;
      let key;
      if (target.type === 'player') {
        key = `player-${target.controller}`;
      } else if (target.creature?.instanceId) {
        key = `creature-${target.creature.instanceId}`;
      }
      if (!key) return;
      if (variant !== 'preview' && seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({ target, variant });
    });
  };

  if (pending.previewTargets?.length) {
    pushTargets(pending.previewTargets, 'preview');
  }

  const requirement = pending.requirements?.[pending.requirementIndex];
  if (requirement && pending.selectedTargets?.length) {
    pushTargets(pending.selectedTargets, 'active');
    Object.entries(pending.chosenTargets || {}).forEach(([effectIndex, list]) => {
      if (Number.parseInt(effectIndex, 10) !== requirement.effectIndex) {
        pushTargets(list, 'confirmed');
      }
    });
  } else if (pending.awaitingConfirmation) {
    Object.values(pending.chosenTargets || {}).forEach((list) => {
      pushTargets(list, 'confirmed');
    });
  }

  if (!targets.length) {
    return '';
  }

  const lines = targets
    .map(({ target, variant }) => {
      let targetId = '';
      let controllerAttr = '';
      if (target.type === 'player') {
        // In multiplayer, need to determine which orb based on local vs remote player
        const localSeatIndex = getLocalSeatIndex();
        const isTargetingLocalPlayer = target.controller === localSeatIndex;
        targetId = isTargetingLocalPlayer ? 'player-life-orb' : 'opponent-life-orb';
        controllerAttr = ` data-target-controller="${target.controller}"`;
      } else if (target.creature?.instanceId) {
        targetId = target.creature.instanceId;
        controllerAttr = ` data-target-controller="${target.controller}"`;
      }
      if (!targetId) return '';
      const variantClass = variant ? ` ${variant}` : '';
      const abilityClass =
        pending.type === 'ability' || pending.type === 'trigger' ? ' ability' : '';
      return `<line class="target-line${variantClass}${abilityClass}" data-target="${targetId}"${controllerAttr} x1="0" y1="0" x2="0" y2="0" />`;
    })
    .filter(Boolean)
    .join('');

  if (!lines) return '';

  return `
    <svg class="target-lines-svg" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <marker id="arrow-blue" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" />
        </marker>
        <marker id="arrow-green" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#22c55e" />
        </marker>
      </defs>
      ${lines}
    </svg>
  `;
}

export function renderAttackLines(game) {
  if (!game.combat || !game.combat.attackers || game.combat.attackers.length === 0) {
    return '';
  }

  // CRITICAL: In multiplayer, show attack arrows during 'choose' stage for both players
  const visibleAttackers = game.combat.attackers.filter((atk) => atk.controller === game.currentPlayer);
  if (!visibleAttackers.length) {
    return '';
  }

  // Determine which life orb to target based on local vs remote player perspective
  const localSeatIndex = getLocalSeatIndex();
  
  const lines = visibleAttackers
    .map((attacker) => {
      const attackerId = attacker.creature.instanceId;
      const attackerController = attacker.controller;
      const defendingPlayerIndex = attackerController === 0 ? 1 : 0;
      const assignedBlocker = game.blocking?.assignments?.[attackerId];
      const variant = assignedBlocker ? 'blocked' : 'unblocked';
      
      let targetId;
      if (assignedBlocker) {
        targetId = assignedBlocker.instanceId;
      } else {
        // Arrow should point to the defending player's life orb from local perspective
        const isDefenderLocal = defendingPlayerIndex === localSeatIndex;
        targetId = isDefenderLocal ? 'player-life-orb' : 'opponent-life-orb';
      }
      
      const targetControllerAttr = assignedBlocker ? ` data-target-controller="${defendingPlayerIndex}"` : '';
      return `<line class="attack-line ${variant}" data-attacker="${attackerId}" data-attacker-controller="${attackerController}" data-target="${targetId}"${targetControllerAttr} x1="0" y1="0" x2="0" y2="0" />`;
    })
    .filter(Boolean)
    .join('');

  return `
    <svg class="attack-lines-svg" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <marker id="arrow-red" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
        </marker>
        <marker id="arrow-orange" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#f97316" />
        </marker>
      </defs>
      ${lines}
    </svg>
  `;
}

function renderBattlefieldCrevice() {
  return `
    <div class="battlefield-crevice">
      <div class="crevice-surface"></div>
      <div class="crevice-fissures"></div>
    </div>
  `;
}

function renderPlayerBoard(player, game, isOpponent) {
  const creatures = player.battlefield.filter((c) => c.type === 'creature');
  const playerIndex = game.players.indexOf(player);
  const colorClass = sanitizeClass(player.color || 'neutral');
  const skin = renderBattlefieldSkin(player.color, { isOpponent });
  return `
    <div class="board player-battlefield player-color-${colorClass}" data-player="${playerIndex}">
      ${skin}
      <div class="battlefield">
        ${
          creatures.length
            ? creatures.map((creature) => renderCreature(creature, playerIndex, game)).join('')
            : '<p class="placeholder">No creatures</p>'
        }
      </div>
    </div>
  `;
}

function renderCreature(creature, controllerIndex, game) {
  const stats = getCreatureStats(creature, controllerIndex, game);
  // CRITICAL: Determine if this is the local player's creature for ability buttons
  const localSeatIndex = getLocalSeatIndex();
  const isLocalCreature = controllerIndex === localSeatIndex;
  const classes = ['card', 'creature-card', getCardColorClass(creature)];
  if (creature.summoningSickness) classes.push('summoning');
  if (creature.frozenTurns) classes.push('frozen');
  const pending = game.pendingAction;
  if (pending && isTargetableCreature(creature, controllerIndex, pending)) {
    classes.push('targetable');
  }
  const isTargeted = pending
    ? Boolean(
        pending.selectedTargets?.some(
          (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
        ) ||
          pending.previewTargets?.some(
            (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
          ) ||
          Object.values(pending.chosenTargets || {}).some((list) =>
            (list || []).some(
              (target) => target.creature?.instanceId === creature.instanceId && target.controller === controllerIndex,
            ),
          ),
      )
    : false;
  if (isTargeted) {
    classes.push('targeted');
  }
  if (game.blocking && canSelectBlocker(creature, controllerIndex, game)) {
    classes.push('blocker-selectable');
  }
  if (game.combat && isAttackingCreature(creature, controllerIndex, game)) {
    classes.push('attacker-card');
  }
  const blockingInfo = game.blocking;
  if (blockingInfo?.selectedBlocker?.instanceId === creature.instanceId) {
    classes.push('blocker-selected');
  }
  if (blockingInfo && controllerIndex === 0) {
    const isBlocking = Object.values(blockingInfo.assignments || {}).some(
      (assigned) => assigned.instanceId === creature.instanceId,
    );
    if (isBlocking) {
      classes.push('blocking-creature');
    }
  }
  if (blockingInfo && controllerIndex === 1 && blockingInfo.assignments?.[creature.instanceId]) {
    classes.push('attacker-blocked');
  }
  if (creature._dying) {
    classes.push('fading-out');
  }
  const abilityButtons = [];
  if (creature.activated) {
    const canActivate =
      isLocalCreature &&
      !creature.activatedThisTurn &&
      !(creature.frozenTurns > 0) &&
      (!game.pendingAction ||
        (game.pendingAction.type === 'ability' && game.pendingAction.card?.instanceId === creature.instanceId)) &&
      game.players[controllerIndex].availableMana >= creature.activated.cost &&
      (game.phase === 'main1' || game.phase === 'main2') &&
      game.currentPlayer === controllerIndex;
    const abilityName = creature.activated.name ? `${escapeHtml(creature.activated.name)}:` : 'Ability:';
    abilityButtons.push(
      `<div class="ability-row">
         <button class="ability-button ${!canActivate ? 'disabled' : ''}" data-action="activate" data-creature="${creature.instanceId}" ${!canActivate ? 'disabled' : ''}>
           <span class="mana-gem small">${creature.activated.cost ?? 0}</span>
           <span class="ability-name">${abilityName}</span>
           <span class="ability-label">${escapeHtml(creature.activated.description)}</span>
         </button>
       </div>`,
    );
  }
  const damage = creature.damageMarked || 0;
  const currentToughness = Math.max(stats.toughness - damage, 0);
  const toughnessClasses = ['stat', 'toughness'];
  if (damage > 0) {
    toughnessClasses.push('damaged');
  }
  const damageChip = damage > 0 ? `<span class="damage-chip">-${damage}</span>` : '';
  const pendingAction = game.pendingAction;
  const showAbilityActions =
    isLocalCreature &&
    pendingAction &&
    pendingAction.card?.instanceId === creature.instanceId &&
    (pendingAction.type === 'ability' || pendingAction.type === 'trigger');
  const abilityActions = showAbilityActions
    ? (() => {
        const req = pendingAction.requirements?.[pendingAction.requirementIndex];
        const selectedCount = pendingAction.selectedTargets?.length || 0;
        const requiredCount = req?.count || 0;
        const canCancel = pendingAction.cancellable !== false;
        const chooseEnabled =
          pendingAction.awaitingConfirmation ||
          !req ||
          selectedCount >= requiredCount;
        const chooseButton = chooseEnabled
          ? '<button class="mini" data-action="confirm-pending">Choose</button>'
          : '<button class="mini disabled" disabled>Choose</button>';
        const cancelButton = canCancel
          ? '<button class="mini cancel" data-action="cancel-action">Cancel</button>'
          : '';
        let statusText;
        if (!req) {
          statusText = pendingAction.type === 'trigger' ? 'Triggered ability resolving' : 'Ready to activate';
        } else if (selectedCount === 0) {
          statusText = `Select ${requiredCount} target${requiredCount > 1 ? 's' : ''}`;
        } else {
          statusText = `${selectedCount}/${requiredCount} selected`;
        }
        return `
    <div class="creature-ability-actions">
      ${cancelButton}
      ${chooseButton}
    </div>
    <div class="ability-status">
      ${statusText}
    </div>
  `;
      })()
    : '';

  const passiveInfo = getPassivePreviewInfo(creature.passive);
  const passiveMarkup = passiveInfo
    ? `<p class="card-passive">${passiveInfo.label ? `${escapeHtml(passiveInfo.label)}: ` : ''}${escapeHtml(
        passiveInfo.description,
      )}</p>`
    : '';

  return `
    <div class="${classes.join(' ')}" data-card="${creature.instanceId}" data-controller="${controllerIndex}">
      <div class="card-header">
        <span class="card-cost"><span class="mana-gem">${creature.cost ?? ''}</span></span>
        <span class="card-name">${creature.name}</span>
      </div>
      <div class="card-body">
        <p class="card-text">${creature.text || ''}</p>
        ${passiveMarkup}
        ${renderStatusChips(creature, controllerIndex, game)}
      </div>
      ${abilityButtons.length ? `<div class="ability">${abilityButtons.join('')}</div>` : ''}
      ${abilityActions}
      <div class="card-footer">
        <span class="stat attack">${stats.attack}</span>/<span class="${toughnessClasses.join(' ')}">${currentToughness}</span>${damageChip}
      </div>
    </div>
  `;
}

function renderDeckIcon(color) {
  const c = (color || 'neutral').toLowerCase();
  if (c === 'red') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="flameGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#fb923c" />
            <stop offset="100%" stop-color="#ef4444" />
          </linearGradient>
        </defs>
        <path fill="url(#flameGrad)" d="M12 2c1.5 3.5-.5 5.5-1.5 6.5-1 .9-1.5 1.9-1.5 3 0 2.5 2 4 4 4 2.2 0 4-1.8 4-4 0-2.8-2.2-4.6-3.2-6.9-.4-.9-.6-1.8-.8-2.6z"/>
        <path fill="#fde68a" opacity="0.9" d="M12 10c-.7.8-1 1.4-1 2.1 0 1.1.9 1.9 2 1.9s2-.8 2-1.9c0-1.2-1-2-1.8-3.2-.3.5-.7.8-1.2 1.1z"/>
      </svg>`;
  }
  if (c === 'blue') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="waterGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" />
            <stop offset="100%" stop-color="#1d4ed8" />
          </linearGradient>
        </defs>
        <path fill="url(#waterGrad)" d="M12 2c3.5 5 7 7.9 7 12a7 7 0 1 1-14 0c0-4.1 3.5-7 7-12z"/>
        <circle cx="10" cy="14" r="2" fill="#bfdbfe" opacity="0.7"/>
      </svg>`;
  }
  if (c === 'green') {
    return `
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <defs>
          <linearGradient id="leafGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#86efac" />
            <stop offset="100%" stop-color="#22c55e" />
          </linearGradient>
        </defs>
        <path fill="url(#leafGrad)" d="M20 4c-7 0-12 4-14 8 0 5 4 8 8 8 6 0 8-7 6-16z"/>
        <path d="M8 14c2-2 6-4 10-4" stroke="#065f46" stroke-width="1.5" fill="none" opacity="0.6"/>
      </svg>`;
  }
  return '';
}
