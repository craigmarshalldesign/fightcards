# Creature Mechanics

This document outlines how creature cards behave inside FightCards. Use it as a reference when authoring new cards or extending combat logic, especially as we move toward synchronized multiplayer matches.

## Lifecycle Overview
1. **Deck Construction** — Creature definitions live under `src/game/cards/<color>-cards/<color>-creatures.js`. During deck build, each definition is duplicated to create a 40-card deck (20 creatures + 20 spells).
2. **Summoning**
   - Creatures can be played during Main Phase I or II if the controller has enough available mana.
   - On cast, the creature is removed from the player’s hand, mana is spent, and the creature is initialized with its base stats and status flags.
   - If the creature has an `onEnter` passive that requires targets, the game creates a pending action so the controller can select them before the card resolves. This flow must be mirrored for remote opponents during multiplayer.
3. **Battlefield State**
   - Creatures track `baseAttack`, `baseToughness`, current buffs, `damageMarked`, `summoningSickness`, and optional ability flags (`haste`, `shimmer`, etc.).
   - Each turn, frozen counters tick down, activated ability flags reset, and temporary haste expires.
   - Damage marked is cleared at the end of each turn.
4. **Leaving Play**
   - Destroyed creatures move to the graveyard and reset transient state.
   - Bounced creatures return to hand, lose temporary buffs, and regain summoning sickness unless they natively have haste.
   - Tokens disappear when they would leave the battlefield instead of returning to hand.

## Ability Types
Creatures can mix and match the following ability patterns:

- **Static Buffs** — Always-on effects that modify allied creatures. Example: `globalBuff` raising attack or toughness for friendly units.
- **Triggered Passives**
  - `onEnter`: Fires when the creature resolves onto the battlefield.
  - `onAttack`: Fires when the creature is declared as an attacker.
  - Additional hooks can be introduced by extending the passive handler registry in `src/app/game/core/flow.js`.
- **Activated Abilities** — Invoked manually during the controller’s main phases if they can pay the mana cost. Activated abilities can be limited to once per turn.
- **Keyword Abilities**
  - **Haste** — Creature ignores summoning sickness and may attack immediately.
  - **Shimmer** — Creature is unblockable for as long as it has shimmer. Temporary shimmer is tracked as a buff that expires at end of turn.
  - **Frozen** — A status applied by some spells; the creature skips its next attack/block and loses one frozen counter at the start of each turn.

## Buff Systems
- **Permanent Buffs** (`buff`, `globalBuff`, `selfBuff`) change a creature’s base stats. These stack with previous permanent adjustments.
- **Temporary Buffs** (`temporaryBuff`) apply until end of turn and live inside the creature’s `buffs` array.
- **Granting Keywords** (`grantHaste`, `grantShimmer`) uses the same buff array to track expirations when the duration is `turn`.
- **Counters & Growth** — Some creatures add repeatable permanent buffs through activated abilities (e.g., Blooming Hydra). Ensure multiplayer updates to these stats are transactional to avoid desync.

## Combat Participation
- **Attacking** — Creatures without summoning sickness (or with haste) can attack during the combat phase. Attack toggling is part of the combat stage state machine.
- **Blocking** — Defending players assign blockers based on targeting requirements handled by `combat/helpers.js`.
- **Damage Resolution** — Damage is marked, logged, and lethal amounts schedule a destroy action. Effects like `preventCombatDamage` or `preventDamageToAttackers` modify this pipeline.

## Multiplayer Considerations
- **Authoritative State** — When implementing multiplayer, creature updates (summoning, buffs, damage) should be written to InstantDB as discrete events so both clients reconstruct the same state machine.
- **Pending Actions** — Passive triggers that require player input must pause the turn timer and await the remote player’s choice. Store pending action metadata (card, effect index, chosen targets) centrally.
- **Perspective Lock** — Always serialize seat-relative information (controller index, instance IDs) so the UI can render the local player at the bottom regardless of lobby seat.

By following these mechanics, new creature designs—such as those in a future Purple (Air/Lightning) deck—will integrate smoothly with combat, AI, and forthcoming multiplayer synchronization.
