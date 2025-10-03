import { getCreatureStats, getCounterTotals, hasShimmer, hasHidden, hasStomp } from '../../game/creatures.js';
import { escapeHtml, sanitizeClass, getPassivePreviewInfo } from '../views/game/shared.js';
import { getLocalSeatIndex } from '../../multiplayer/runtime.js';

export function getCardColorClass(card) {
  return `card-color-${card?.color ?? 'neutral'}`;
}

export function renderTypeBadge(card) {
  const label = (card?.type || '').toString().toUpperCase();
  const variant = card?.type === 'creature' ? 'type-creature' : 'type-spell';
  return `<span class="type-badge ${variant}">${escapeHtml(label || 'CARD')}</span>`;
}

export function renderStatusChips(card, controllerIndex, game) {
  if (!card || card.type !== 'creature') return '';

  const chips = [];
  const inBattlefield = Number.isInteger(controllerIndex);

  const abilities = card.abilities || {};
  const hasHaste = Boolean(abilities.haste || (inBattlefield && card.temporaryHaste));
  const shimmerActive = inBattlefield ? hasShimmer(card) : Boolean(abilities.shimmer);
  const hiddenActive = inBattlefield ? hasHidden(card) : false;
  const stompActive = inBattlefield ? hasStomp(card) : Boolean(abilities.stomp);

  if (hasHaste) chips.push({ label: 'Haste', variant: 'haste' });
  if (shimmerActive) chips.push({ label: 'Shimmer', variant: 'shimmer' });
  if (stompActive) chips.push({ label: 'Stomp', variant: 'stomp' });
  if (hiddenActive) chips.push({ label: 'Hidden', variant: 'hidden' });
  if (inBattlefield && card.frozenTurns) chips.push({ label: 'Frozen', variant: 'frozen' });
  if (inBattlefield && game && game.currentPlayer === controllerIndex && card.summoningSickness && !hasHaste) {
    chips.push({ label: 'Summoning', variant: 'sickness' });
  }

  if (inBattlefield) {
    const counters = getCounterTotals(card, controllerIndex, game);
    const permanentLabel = formatCounterLabel(counters.permanent);
    if (permanentLabel) {
      chips.push({ label: permanentLabel, variant: 'counter-permanent' });
    }
    const temporaryLabel = formatCounterLabel(counters.temporary);
    if (temporaryLabel) {
      chips.push({ label: temporaryLabel, variant: 'counter-temporary' });
    }
  } else {
    const counters = getCounterTotals(card);
    const permanentLabel = formatCounterLabel(counters.permanent);
    if (permanentLabel) {
      chips.push({ label: permanentLabel, variant: 'counter-permanent' });
    }
  }

  if (chips.length === 0) return '';
  return `<div class="status-chips">${chips
    .map((c) => `<span class="status-chip ${sanitizeClass(c.variant)}">${escapeHtml(c.label)}</span>`)
    .join('')}</div>`;
}

function formatCounterLabel(counter = { attack: 0, toughness: 0 }) {
  if (!counter) return '';
  const { attack = 0, toughness = 0 } = counter;
  if (attack === 0 && toughness === 0) {
    return '';
  }
  return `${formatCounterValue(attack)}/${formatCounterValue(toughness)}`;
}

function formatCounterValue(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return '+0';
}

/**
 * Renders a creature card for the widescreen view
 * Similar to the classic view but without the text field (for future images)
 */
export function renderWideCreature(creature, controllerIndex, game) {
  const stats = getCreatureStats(creature, controllerIndex, game);
  const localSeatIndex = getLocalSeatIndex();
  const isLocalCreature = controllerIndex === localSeatIndex;
  const classes = ['card', 'creature-card', 'wide-creature-card', getCardColorClass(creature)];
  
  // Add all the same state classes as classic view
  if (creature.tapped) {
    classes.push('tapped');
  }
  
  const pendingAction = game.pendingAction;
  if (pendingAction?.card?.instanceId === creature.instanceId) {
    classes.push('selected');
  }
  
  const targeting = game.targeting;
  if (targeting?.selected?.includes(creature.instanceId)) {
    classes.push('target-selected');
  }
  if (targeting && !targeting.selected.includes(creature.instanceId)) {
    classes.push('target-mode');
  }
  
  const combatStage = game.combat;
  if (combatStage && combatStage.stage === 'choose') {
    const isAttacker = combatStage.attackers.some((a) => a.instanceId === creature.instanceId);
    if (isAttacker) {
      classes.push('attacker-selected');
    }
  }
  
  const blockingInfo = game.blocking;
  const defendingIndex = game.currentPlayer === 0 ? 1 : 0;
  
  // Highlight selected blocker (when you first click your creature)
  if (blockingInfo?.selectedBlocker?.instanceId === creature.instanceId) {
    classes.push('blocker-selected');
    classes.push('selected-blocker'); // Lighter blue highlight for selected blocker
  }
  
  // Highlight creatures that are assigned as blockers (confirmed blocks)
  if (blockingInfo && controllerIndex === defendingIndex) {
    const isBlocking = Object.values(blockingInfo.assignments || {}).some(
      (assigned) => assigned.instanceId === creature.instanceId,
    );
    if (isBlocking) {
      classes.push('blocking-creature');
      classes.push('confirmed-blocker'); // Blue highlight for confirmed blocker
    }
  }
  
  // Highlight attackers that are being blocked
  if (blockingInfo && blockingInfo.assignments?.[creature.instanceId]) {
    classes.push('attacker-blocked');
    classes.push('being-blocked'); // Blue highlight for attacker being blocked
  }
  
  // Add visual highlights during blocking phase
  if (blockingInfo && game.combat?.stage === 'blockers') {
    // Highlight attacking creatures in red (enemy creatures that are attacking)
    if (controllerIndex === game.currentPlayer) {
      const isAttacking = game.combat?.attackers?.some((a) => a.creature?.instanceId === creature.instanceId);
      if (isAttacking) {
        classes.push('is-attacking');
      }
    }
    
    // Highlight creatures that can block in white (your creatures when you're defending)
    if (controllerIndex === localSeatIndex && localSeatIndex === defendingIndex) {
      // Creatures can block as long as they're not tapped or frozen
      // Summoning sickness does NOT prevent blocking, only attacking
      const canBlock = !creature.tapped && 
                       !creature.frozenTurns && 
                       !blockingInfo.selectedBlocker;
      if (canBlock) {
        classes.push('can-block');
      }
    }
  }
  if (creature._dying) {
    classes.push('fading-out');
  }
  
  // Ability buttons
  const abilityButtons = [];
  if (creature.activated) {
    const canActivate =
      isLocalCreature &&
      !creature.activatedThisTurn &&
      !creature.summoningSickness &&
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
           <span class="ability-text-stack">
             <span class="ability-name">${abilityName}</span>
             <span class="ability-label">${escapeHtml(creature.activated.description)}</span>
           </span>
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
  
  // Mirror classic view logic for pending ability/trigger actions
  const abilityActions =
    pendingAction && pendingAction.card.instanceId === creature.instanceId
      ? (() => {
          const req = pendingAction.requirements?.[pendingAction.requirementIndex];
          const selectedCount = pendingAction.selectedTargets?.length || 0;
          const requiredCount = req?.count || 0;
          const canCancel = pendingAction.cancellable !== false;
          const chooseEnabled =
            pendingAction.awaitingConfirmation || !req || selectedCount >= requiredCount;
          const chooseButton = chooseEnabled
            ? '<button class="mini primary" data-action="confirm-pending">Choose</button>'
            : '<button class="mini primary disabled" disabled>Choose</button>';
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

