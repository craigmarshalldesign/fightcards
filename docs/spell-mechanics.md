# Spell Mechanics

This guide describes how spell cards are defined and resolved in FightCards. It also highlights considerations for synchronizing spell casting in the upcoming multiplayer mode.

## Spell Definition
- Spell data is located in `src/game/cards/<color>-cards/<color>-spells.js`.
- Each spell entry specifies:
  - `id`, `name`, `color`, `cost`, and descriptive `text`.
  - An array of `effects`, each with a `type` and optional metadata (targets, amounts, duration, etc.).
  - Some spells chain multiple effects; they resolve in the order listed.

## Casting Pipeline
1. **Eligibility Check** — Players can cast spells during Main Phase I or II when they have sufficient mana and it is their turn.
2. **Pending Action Creation** — The spell is removed from the hand and a pending action is created. Requirements for each effect are computed to determine whether the caster must choose targets.
3. **Target Selection**
   - If all requirements can be auto-resolved (e.g., `draw`), the spell moves straight to confirmation.
   - When player choice is required (such as `damage` to "any"), the UI prompts the caster to select valid targets before InstantDB (in multiplayer) records the final selection.
4. **Confirmation & Resolution** — Once confirmed, mana is spent and `resolveEffects` walks through the effect list, applying each outcome to the chosen targets.
5. **Cleanup** — Spells go to the graveyard after resolution, and the game checks for win conditions.

## Effect Catalog
The current effect system supports a wide range of mechanics. New effects can be added by expanding `applyEffect` in `src/app/game/core/effects.js`.

| Effect Type | Description |
|-------------|-------------|
| `damage` | Deal damage to creatures or players. Targets may be specific (`enemy-creature`) or flexible (`any`). |
| `draw` | Controller draws cards and logs the event. |
| `damageAllEnemies` / `damageAllCreatures` | Area-of-effect damage across the opposing board, optionally hitting the enemy player. |
| `temporaryBuff` | Grants attack/toughness until end of turn. |
| `buff`, `globalBuff`, `multiBuff`, `selfBuff` | Permanent stat increases for single or multiple creatures. |
| `grantHaste`, `grantShimmer` | Adds keyword abilities, optionally with temporary duration. |
| `createToken`, `createMultipleTokens` | Summon predefined token creatures to the battlefield. Tokens vanish if bounced or destroyed. |
| `bounce`, `massBounce`, `bounceAttackers` | Return creatures to hand (tokens are destroyed instead). |
| `freeze` | Apply frozen counters that prevent attacking/blocking for several turns. |
| `preventCombatDamage`, `preventDamageToAttackers`, `damageAttackers` | Manipulate combat outcomes during the current turn. |
| `heal` | Remove marked damage from friendly creatures. |
| `gainLife` | Increase the controller’s life total. |
| `teamBuff` | Permanently enhance every creature on the controller’s battlefield. |
| `revive` | Return the top card of the graveyard to hand. |
| `splashDamage` | Distribute damage randomly among enemy creatures, spilling over to the opponent if excess remains. |

Refer to existing spells (e.g., *Volcanic Rain*, *Counter Surge*, *Primal Resurgence*) for concrete examples of multi-effect interactions.

## Multiplayer Considerations
- **Deterministic Resolution** — Store the pending action’s effect list, target selections, and resolution order in InstantDB so both clients can replay the same steps.
- **Latency Handling** — Because some effects trigger immediate follow-up actions (like tokens entering with passives), queue these events server-side and broadcast them as part of the same transaction.
- **Visibility** — Spell previews and logs should only expose information available to each player (e.g., hidden hand contents stay private). InstantDB entries should flag whether a log item is public or private.
- **Concurrency Control** — Only one spell pending action should exist at a time. When multiplayer is implemented, gate the "End Phase" control until the current spell resolves to avoid divergent timelines.

With these rules in place, designers can safely extend the spell roster and ensure that real-time matches remain consistent and fair.
