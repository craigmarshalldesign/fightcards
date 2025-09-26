import {
  addTemporaryBuff,
  applyPermanentBuff,
  bounceCreature,
  bounceStrongestCreatures,
  checkForDeadCreatures,
  dealDamageToCreature,
  dealDamageToPlayer,
  distributeSplashDamage,
  freezeCreature,
  grantHaste,
  grantShimmer,
  instantiateToken,
} from '../creatures.js';
import { addLog, cardSegment, healSegment, playerSegment, textSegment } from '../log.js';
import { state } from '../../state.js';
import { drawCards, sortHand } from './players.js';
import {
  isMultiplayerMatchActive,
  enqueueMatchEvent,
  MULTIPLAYER_EVENT_TYPES,
} from '../../multiplayer/runtime.js';
import { cardToEventPayload } from './flow.js';

export function resolveEffects(effects, pending) {
  effects.forEach((effect, idx) => {
    const targets = pending.chosenTargets[idx] || [];
    applyEffect(effect, pending.controller, targets, pending.card);
    if (isMultiplayerMatchActive()) {
      enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.EFFECT_RESOLVED, {
        effectIndex: idx,
        effect,
        controller: pending.controller,
        card: cardToEventPayload(pending.card),
        targets: targets.map((target) => ({
          type: target.type,
          controller: target.controller,
          creature: target.creature ? cardToEventPayload(target.creature) : undefined,
        })),
      });
    }
  });
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
          if (target.type === 'player') {
            dealDamageToPlayer(target.controller, effect.amount);
          } else if (target.creature) {
            dealDamageToCreature(target.creature, target.controller, effect.amount);
          }
        });
      }
      break;
    }
    case 'draw': {
      drawCards(controller, effect.amount);
      addLog([playerSegment(controller), textSegment(` draws ${effect.amount} card(s).`)]);
      if (isMultiplayerMatchActive()) {
        enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.DRAW_CARD, {
          controller: controllerIndex,
          amount: effect.amount,
        });
      }
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
    case 'grantShimmer': {
      targets.forEach((target) => grantShimmer(target.creature, effect.duration));
      break;
    }
    case 'globalBuff': {
      controller.battlefield
        .filter((c) => c.type === 'creature')
        .forEach((creature) => {
          if (effect.scope === 'other-friendly' && sourceCard && creature.instanceId === sourceCard.instanceId) {
            return;
          }
          applyPermanentBuff(creature, effect.attack, effect.toughness);
        });
      break;
    }
    case 'createToken': {
      const token = instantiateToken(effect.token, controller.color);
      controller.battlefield.push(token);
      addLog([playerSegment(controller), textSegment(' creates '), cardSegment(token), textSegment('.')]);
      if (isMultiplayerMatchActive()) {
        enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.TOKEN_CREATED, {
          controller: controllerIndex,
          card: cardToEventPayload(token),
          zone: 'battlefield',
          token: true,
        });
      }
      break;
    }
    case 'createMultipleTokens': {
      for (let i = 0; i < effect.count; i += 1) {
        const token = instantiateToken(effect.token, controller.color);
        controller.battlefield.push(token);
        addLog([playerSegment(controller), textSegment(' creates '), cardSegment(token), textSegment('.')]);
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
      if (targets.length) {
        targets.forEach((target) => bounceCreature(target.creature, target.controller));
      }
      break;
    }
    case 'bounceAttackers': {
      if (game.combat?.attackers) {
        game.combat.attackers.forEach((attacker) => bounceCreature(attacker.creature, attacker.controller));
        game.combat = null;
        game.blocking = null;
        addLog([textSegment('All attackers returned to hand.')]);
      }
      break;
    }
    case 'freeze': {
      targets.forEach((target) => freezeCreature(target.creature));
      break;
    }
    case 'preventDamageToAttackers': {
      game.preventDamageToAttackersFor = controllerIndex;
      addLog([playerSegment(controller), textSegment(' protects attacking creatures this turn.')]);
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
      addLog([playerSegment(controller), textSegment(' gains '), healSegment(effect.amount), textSegment(' life.')]);
       if (isMultiplayerMatchActive()) {
        enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.LIFE_CHANGED, {
          controller: controllerIndex,
          delta: effect.amount,
          life: controller.life,
        });
      }
      break;
    }
    case 'preventCombatDamage': {
      game.preventCombatDamageFor = controllerIndex;
      addLog([playerSegment(controller), textSegment(' prevents combat damage this turn.')]);
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
        sortHand(controller);
        addLog([playerSegment(controller), textSegment(' returns '), cardSegment(revived), textSegment(' to hand.')]);
        if (isMultiplayerMatchActive()) {
          enqueueMatchEvent(MULTIPLAYER_EVENT_TYPES.LOG, {
            controller: controllerIndex,
            type: 'revive',
            card: cardToEventPayload(revived),
          });
        }
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
