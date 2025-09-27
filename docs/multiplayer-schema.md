# InstantDB Multiplayer Schema

Multiplayer relies on deterministic, append-only events stored in InstantDB. This document describes the data model used by the client and the recommended rules to enforce fair play.

## Entities Overview

### InstantDB Schema Snippet

```ts
import { i } from '@instantdb/core';

export const schema = i.schema({
  entities: {
    lobbies: i.entity({
      status: i.string().optional(),
      hostUserId: i.string().optional(),
      hostDisplayName: i.string().optional(),
      hostColor: i.string().optional(),
      hostReady: i.boolean().optional(),
      guestUserId: i.string().optional(),
      guestDisplayName: i.string().optional(),
      guestColor: i.string().optional(),
      guestReady: i.boolean().optional(),
      searchKey: i.string().optional(),
      matchId: i.string().optional(),
      createdAt: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    matches: i.entity({
      lobbyId: i.string().optional(),
      status: i.string().optional(),
      activePlayer: i.number().optional(),
      turn: i.number().optional(),
      phase: i.string().optional(),
      dice: i.json().optional(),
      state: i.json().optional(),
      pendingAction: i.json().optional(),
      nextSequence: i.number().optional(),
      createdAt: i.number().optional(),
      updatedAt: i.number().optional(),
      hostUserId: i.string().optional(),
      guestUserId: i.string().optional(),
    }),
    matchEvents: i.entity({
      matchId: i.string().optional(),
      sequence: i.number().optional(),
      type: i.string().optional(),
      payload: i.json().optional(),
      createdAt: i.number().optional(),
    }),
  },
  links: {},
  rooms: {},
});
```

### ID Generation

InstantDB validates that entity primary keys are UUID strings. The client uses `crypto.randomUUID()` (with a deterministic fallback for environments that lack the Web Crypto API) via `generateId()` so that lobby, match, and match-event records always satisfy that requirement.

### `lobbies`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Lobby id generated client-side via `generateId()`. |
| `status` | string | `'open' \| 'ready' \| 'starting' \| 'playing' \| 'completed' \| 'abandoned'`; defaults to `'open'`. |
| `hostUserId` | string | Lobby owner (Instant user id). Empty string means the seat is open. |
| `hostDisplayName` | string | Cached host name shown in listings. Empty string when unknown. |
| `hostColor` | string | Selected deck color for the host seat (empty string until chosen). |
| `hostReady` | boolean | Host ready flag (`false` until the host readies up). |
| `guestUserId` | string | Guest user id (`''` when unclaimed). |
| `guestDisplayName` | string | Guest display name (`''` when unclaimed). |
| `guestColor` | string | Guest deck color (`''` until chosen). |
| `guestReady` | boolean | Guest ready flag. |
| `searchKey` | string | Lower-cased host name used for search filtering. |
| `matchId` | string | Match activated for the lobby (empty string while waiting). |
| `createdAt` | number | Unix epoch (ms) when the lobby was created. |
| `updatedAt` | number | Unix epoch (ms) when the lobby last changed; used for stale cleanup. |

> **Note:** Optional seat/display fields are written as empty strings while the slot is open. The client also prunes host-owned lobbies that stay open without a guest for longer than 60 seconds by deleting the record from InstantDB.

### Client Lobby Flow

- The lobby browser subscribes to the 20 most recent entries and sorts them by `updatedAt` (falling back to `createdAt` when missing) so newly active rooms bubble to the top of the list. Filtering to `open`, `ready`, `starting`, and `playing` states now happens client-side to avoid schema validation issues when optional fields are absent.
- A manual **Refresh** control re-runs the subscription query on demand so players can immediately pull in lobbies created from other devices. Subscription failures surface an inline error allowing players to retry.
- Seat updates (claiming/leaving, deck choices, ready toggles) optimistically update the local lobby state while the InstantDB transaction completes, ensuring UI controls reflect the current selection immediately.
- Player name search is performed entirely client-side by matching the lower-cased `hostDisplayName` and `guestDisplayName` fields. The `searchKey` column exists to speed up server-side filtering if rules are added later.
- Before creating a new lobby, the host deletes any of their previous open rooms that have been idle for 60 seconds. This keeps the listing clean and prevents duplicate "ghost" lobbies from appearing across multiple devices.
- Joining a lobby installs a dedicated subscription for that record so seat changes, deck picks, and ready states stream into the detail view without polling.
- Hosts immediately delete their lobby if they navigate back to the lobby list, refresh the page, or start a match. A 60 second TTL (tracked via `updatedAt`) also removes abandoned lobbies if the client disconnects unexpectedly.
- The client stores the most recent lobby id in `localStorage` so it can be cleaned up automatically after a crash or refresh when the player signs back in.
- The lobby detail screen renders distinct experiences: the host sees only their deck selection plus an opponent status panel, while guests see host readiness alongside their own deck picker. When both seats are filled, additional visitors are shown a locked state and prompted to browse other lobbies or create their own instead of spectating.
- Joining a lobby is exclusive to a single guest seat; once a challenger claims it, the lobby becomes locked and no other accounts can join until a seat re-opens.

### `matches`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Match id generated with `generateId()` |
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
| `hostUserId` | string | Host user id cached for quick seat lookups |
| `guestUserId` | string | Guest user id cached for quick seat lookups |

### `matchEvents`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Event id generated with `generateId()` |
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