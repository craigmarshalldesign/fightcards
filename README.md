# FightCards

FightCards is a fast-paced, turn-based card battler where elemental decks clash in short, tactical matches. Players build momentum each round, summon creatures, and unleash spells to overwhelm their opponent. The current release focuses on single-player battles against a reactive AI, and the project is being actively prepared for head-to-head multiplayer using InstantDB-backed lobbies and real-time state sync.

## Table of Contents
- [Project Status](#project-status)
- [Tech Stack & Dependencies](#tech-stack--dependencies)
- [Getting Started](#getting-started)
- [Game Overview](#game-overview)
  - [Turn Structure & Phases](#turn-structure--phases)
  - [Resources & Mana Curve](#resources--mana-curve)
  - [Card Types](#card-types)
  - [Deck Archetypes](#deck-archetypes)
- [Multiplayer Vision](#multiplayer-vision)
- [Documentation](#documentation)

## Project Status
- ✅ **Single-player vs. AI** — fully playable with three elemental decks.
- 🚧 **Multiplayer (Player vs. Player)** — design in progress. Lobby creation, matchmaking, and synchronized turns will be powered by InstantDB.
- 🛣️ **Content Expansion** — documentation for extending spell, creature, and deck systems is included in the `docs/` folder to support new colors (for example, an Air/Lightning "Purple" deck).

## Tech Stack & Dependencies
- [Node.js 18+](https://nodejs.org/) — development runtime.
- [Vite](https://vitejs.dev/) — build tool and dev server.
- [Three.js](https://threejs.org/) — used for the animated 3D background layer.
- [@instantdb/core](https://www.instantdb.com/docs) — planned backend for multiplayer lobbies and live game state.
- [gh-pages](https://github.com/tschaub/gh-pages) — optional deployment helper for publishing static builds.

You can review the complete dependency list in [`package.json`](./package.json).

## Getting Started
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fightcards
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Run the development server**
   ```bash
   npm run dev
   ```
   Vite will print a local URL (usually `http://localhost:5173`) where you can test the game.
4. **Build for production**
   ```bash
   npm run build
   ```
5. **Preview a production build**
   ```bash
   npm run preview
   ```

## Game Overview
FightCards pits two elemental decks against each other. Each deck is composed of creatures and spells that reflect a specific color identity. Matches typically last 10–15 minutes and revolve around tempo, board control, and smart spell timing.

### Turn Structure & Phases
Every turn advances through three primary phases, managed by the game flow logic:
1. **Main Phase I** — Play creatures and spells using your available mana. Activated abilities can also be triggered here.
2. **Combat Phase** — Declare attackers, assign blockers, and resolve combat damage. Certain spells can skip combat or modify it mid-flow.
3. **Main Phase II / End of Turn** — Finish playing cards, then end your turn. Damage on creatures is cleared and temporary buffs expire at end of turn.

The turn order is determined at the start of the game by an initiative dice roll. Players draw one card per turn, and the active player’s mana pool refills and grows by one each round.

### Resources & Mana Curve
- Players start with zero mana crystals and gain one maximum mana at the beginning of each turn (`maxMana += 1`).
- Available mana is refreshed to the new maximum during the upkeep step (`availableMana = maxMana`).
- Mana is spent to cast spells or summon creatures. Cards are sorted by cost in-hand to encourage curve-based play.
- Some abilities (for example, activated abilities on creatures) require additional mana payments and track once-per-turn usage.

### Card Types
- **Creatures** — Permanents that attack, block, and may carry passive, triggered, or activated abilities. Examples include:
  - *On-enter effects* (e.g., damage, bounce, buffs).
  - *Triggered abilities* on attack or upkeep.
  - *Activated abilities* with costs and turn limits.
  - Keywords such as **Haste** (attack immediately), **Shimmer** (unblockable), or status effects like **Frozen**.
- **Spells** — One-shot effects resolved via the effect system. Effects cover direct damage, card draw, freezing, token creation, buffs, mass bounce, global prevention, splash damage, and more. Spells can require target selection and may create multiple effects per cast.

### Deck Archetypes
Each color currently ships with 10 unique creatures and 10 spells. Decks are built by duplicating each entry, resulting in consistent 40-card lists that emphasize their theme:
- **Fire (Red)** — Aggressive damage, haste creatures, direct burn, and global attack buffs.
- **Water (Blue)** — Control-oriented bounce, freeze effects, card advantage, and shimmer-enabled evasive threats.
- **Grass (Green)** — Resilient board growth, permanent buffs, life gain, and powerful late-game finishers.

Deck construction is centralized in [`src/game/cards`](./src/game/cards), where each color exports its creature and spell collections. See [`docs/deck-creation.md`](./docs/deck-creation.md) for standards when adding new colors such as a Purple (Air/Lightning) deck.

## Multiplayer Vision
The upcoming multiplayer mode will mirror the single-player experience while synchronizing state through InstantDB:
- **Lobby Browser** — A multiplayer menu will list open lobbies, allowing players to create or join rooms and pick their deck color.
- **Ready-Up Flow** — Each participant locks in a color, marks ready, and the server coordinates the initial dice roll and turn assignment.
- **Perspective Handling** — Regardless of seat, the UI will always render the local player at the bottom of the battlefield with identical controls to the AI mode.
- **Turn Sync** — Game actions (card plays, combat declarations, log events) will be persisted in InstantDB so both clients stay in sync and can safely reconnect.
- **Security & Fair Play** — Deterministic resolution and server-tracked pending actions will prevent race conditions, ensuring each turn waits for the opposing player’s confirmation.

These plans guide the new documentation so future features (spectating, rematches, seasonal ladders) can build on the same architecture.

## Documentation
Extended design notes live in the [`docs/`](./docs) directory:
- [`docs/creature-mechanics.md`](./docs/creature-mechanics.md) — lifecycle of creatures, statuses, and ability types.
- [`docs/spell-mechanics.md`](./docs/spell-mechanics.md) — spell resolution pipeline, effect catalog, and targeting rules.
- [`docs/deck-creation.md`](./docs/deck-creation.md) — guidelines for designing balanced decks, including color identity and multiplayer considerations.

Contributions that add new mechanics or multiplayer systems should update both the codebase and relevant docs to keep the design playbook fresh.
