# Deck Creation Standards

Use this guide when authoring new deck colors or tweaking existing ones. The goal is to maintain balance, preserve each color’s identity, and prepare the card pool for seamless multiplayer play.

## Core Deck Structure
- **Card Count** — Each deck contains 20 unique definitions (10 creatures, 10 spells). The deck builder duplicates every entry, resulting in a 40-card list.
- **Mana Curve** — Creature and spell costs should span 1–6 mana. Early drops enable board presence, while higher-cost cards offer finishers or swingy spells.
- **Theme Consistency** — Every color focuses on a distinct playstyle:
  - **Red (Fire)** — Aggression, haste, and direct damage.
  - **Blue (Water)** — Control, bounce, freeze, and card draw.
  - **Green (Grass)** — Growth, life gain, and resilient creatures.
  When creating a new deck (e.g., **Purple / Air-Lightning**), define a clear theme such as evasion, tempo swings, or chain lightning effects.

## Design Checklist for New Colors
1. **Color Identity Document** — Draft a short brief covering combat philosophy, resource patterns, and signature mechanics.
2. **Creature Suite**
   - Include a mix of vanilla bodies, utility creatures with `onEnter` effects, and at least one card featuring an activated ability.
   - Provide 2–3 keyword-bearing creatures. For a Purple deck, consider new keywords (e.g., `storm` for extra spell triggers) and document them in `docs/creature-mechanics.md`.
   - Ensure late-game creatures can close matches without being strictly better than other colors’ finishers.
3. **Spell Suite**
   - Supply removal, tempo tools, and a marquee spell that expresses the color’s theme.
   - Reuse existing effect types when possible. If new effect logic is needed, extend `applyEffect` and add entries to `docs/spell-mechanics.md`.
   - Balance card draw or mana acceleration carefully to avoid runaway advantages in multiplayer.
4. **Stat & Cost Review** — Compare new cards against existing ones. Aim for parity in total attack/toughness and number of efficient spells.
5. **AI Compatibility** — If the deck introduces new targeting rules, update `requirements.js` and AI helpers so single-player behavior remains intelligent.
6. **Multiplayer Readiness**
   - Design cards to resolve deterministically. Avoid ambiguous triggers that could diverge between clients.
   - For any card that references opponent choices (e.g., forced discards), outline how those inputs will be captured in InstantDB.

## File Layout
- Add new creature and spell files under `src/game/cards/<color>-cards/`.
- Export the combined list in `src/game/cards/<color>-cards/index.js` and register the color inside `src/game/cards/index.js` (`COLORS`, `CARD_LIBRARY`).
- Provide localized artwork or placeholders as needed by the UI (`src/app/ui`).

## Testing & Validation
- **Unit Tests / Build** — Run `npm run build` to ensure the project bundles successfully.
- **Playtest Scripts** — Use the existing single-player mode to check for gameplay loops, ensuring the AI can pilot or counter the new deck.
- **Documentation Updates** — Append any new mechanics, keywords, or spell effects to the relevant docs so other contributors understand the additions.

By following these standards, a future Purple Air-Lightning deck—and any other expansions—will feel cohesive, balanced, and ready for multiplayer deployment.
