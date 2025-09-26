# InstantDB Multiplayer Schema

Multiplayer relies on deterministic, append-only events stored in InstantDB. This document describes the data model used by the client and the recommended rules to enforce fair play.

## Entities Overview

### `lobbies`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Lobby id |
| `status` | string | `'open' \| 'full' \| 'ready' \| 'starting' \| 'playing' \| 'completed' \| 'abandoned'` |
| `hostUserId` | string | Lobby owner |
| `hostDisplayName` | string | Cached host name |
| `hostColor` | string | Selected deck color |
| `hostReady` | boolean | Ready flag |
| `guestUserId` | string | Guest user id |
| `guestDisplayName` | string | Guest display name |
| `guestColor` | string | Guest deck color |
| `guestReady` | boolean | Guest ready flag |
| `searchKey` | string | Lower-cased host name (search index) |
| `matchId` | string | Match activated for the lobby |
| `createdAt` | number | Unix epoch |
| `updatedAt` | number | Unix epoch |

### `matches`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Match id |
| `lobbyId` | string | Parent lobby id |
| `status` | string | `'starting' \| 'in-progress' \| 'completed' \| 'abandoned'` |
| `activePlayer` | number | Seat index of active player (0 host, 1 guest) |
| `turn` | number | Current turn |
| `phase` | string | Current phase (`'main1'`, `'combat'`, `'main2'`) |
| `dice` | object | `{ host: number, guest: number, winner: 0 \| 1 }` |
| `state` | object | Legacy fallback snapshot |
| `pendingAction` | object | Legacy fallback |
| `nextSequence` | number | Next `matchEvents.sequence` to assign |
| `createdAt` | number | Unix epoch |
| `updatedAt` | number | Unix epoch |

### `matchEvents`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event id |
| `matchId` | string | Owning match |
| `sequence` | number | Strictly increasing sequence number |
| `type` | string | Event type (see below) |
| `payload` | object | Event payload |
| `createdAt` | number | Unix epoch |

## Event Catalog

| Type | Payload Fields | Description |
|------|----------------|-------------|
| `match-started` | `turn`, `activePlayer`, `phase`, `dice` | Match kicked off |
| `turn-started` | `turn`, `activePlayer`, `phase` | Turn refilled mana and drew |
| `phase-changed` | `turn`, `activePlayer`, `phase` | Phase update |
| `card-played` | `controller`, `card`, `zone` | Card entered battlefield/grave/hand |
| `token-created` | `controller`, `card`, `zone`, `token` | Token creation |
| `card_left_battlefield` | `controller`, `card` | Card removed from battlefield |
| `creature-destroyed` | `controller`, `card` | Creature destroyed |
| `pending-created` | `controller`, `kind`, `card`, `requirements`, `effects?` | Pending action created |
| `pending-updated` | `controller`, `requirementIndex`, `chosenTargets`, `awaitingConfirmation?` | Pending selection state |
| `pending-resolved` | `controller`, `kind`, `card`, `chosenTargets`, `effects` | Pending resolved |
| `effect-resolved` | `controller`, `effectIndex`, `effect`, `targets` | Individual effect application |
| `attacker-toggled` | `creature`, `selected` | Attacker toggled during selection |
| `attackers-confirmed` | `attackers[]` | Attackers locked in |
| `blocking-started` | `defender` | Blocking phase started |
| `blocker-selected` | `blocker` | Blocker selected by defender |
| `blocker-assigned` | `attacker`, `blocker` | Blocker assigned |
| `combat-started` | `controller` | Combat phase began |
| `combat-resolved` | `log[]` | Combat damage resolution summary |
| `life-changed` | `controller`, `delta`, `life` | Life adjustments |
| `draw-card` | `controller`, `amount` | Card draws |
| `log` | `message`, `category` | Optional UI log entry |

## Event Authoring Rules

- Only the active seat may write turn or card events; InstantDB rules should verify `matches.activePlayer` matches the caller.
- Every event must bump `matches.nextSequence` alongside the new entry in the same transaction.
- Clients replay events strictly by sequence; if a gap appears, they wait until the missing event arrives.
- Events should carry minimal payloads (card id/instance) and rely on local card data for full details.

## Client Replay Notes

- Upon subscribing to a match, clients rebuild `state.game` by applying events sequentially.
- Pending actions are reconstructed from `pending-*` events so both seats see identical selection prompts.
- Card zone changes (`card-played`, `card_left_battlefield`, `creature-destroyed`) are applied before combat/pending logic to maintain consistency.

## Recommended Instant Rules (High Level)

1. `lobbies`: only hosts may update their own seat; seat ready flags must correspond to the seat owner.
2. `matches`: only seats present in the match may write events.
3. `matchEvents`: reject events where `sequence` != `matches.nextSequence`; enforce turn ownership/seat-specific actions.
4. `matches.status`: transitions must follow lobby ready states (open → starting → in-progress → completed/abandoned).

These rules keep gameplay synchronized and prevent race conditions or unauthorized moves.