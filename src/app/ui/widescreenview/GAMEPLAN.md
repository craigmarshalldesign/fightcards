## Widescreen Game View — Implementation Plan

Goal: Add an alternate "widescreen" layout for the battlefield that players can switch to **during an active match only**, without changing core game logic or flows. The current classic view remains unchanged. The widescreen view should work on desktop and auto-activate on mobile when rotated to landscape (with a user preference override).

**CRITICAL: Widescreen view is only available during active gameplay (when `state.screen === 'game'`). It does not affect menu, lobby, or other screens.**

Key constraints:
- Minimal changes to existing files. Prefer wrappers/adapters that reuse current renderers, events, and data attributes.
- Maintain all targeting/attack lines, life orb clicks, ability activations, and phase control behavior.
- Build each widescreen part as its own file so we can verify them incrementally.

High-level approach:
1) Introduce a new UI view mode flag in state: `state.ui.viewMode` = `"classic" | "wide"` (default `classic`). Preference stored in `localStorage`.
2) Add a tiny toggle button (bottom center/right) to switch views at runtime. Add a couple of small event handlers to route `data-action` clicks to set `viewMode`.
3) Implement a parallel renderer `renderGameWide()` that composes widescreen-specific components. We will re-use existing helpers (logs, targeting, hand, phase indicator, etc.) whenever possible to avoid logic duplication.
4) Keep identifiers and attributes that the targeting/attack line systems depend on, especially:
   - Life orbs: `id="player-life-orb"` and `id="opponent-life-orb"` with `data-player-target`.
   - Creatures: `data-card="<instanceId>"` and `data-controller` on creature elements.
   - SVG layers for lines: include `attack-lines-svg` and `target-lines-svg` containers at the same stacking level as today.

Directory layout (new):

```
src/app/ui/widescreenview/
  index.js                 // renderGameWide entry, composes parts
  wide-battlefield.js      // full-bleed background battlefield skin/image
  wide-lifeglobes.js       // centered, floating life orbs (top/bottom middle)
  wide-phaseindicator.js   // centered phase indicator overlay
  wide-playerbars.js       // compact stat bars (top-left for opponent, bottom-left for player)
  wide-phasechangebuttons.js // floating controls bottom-right
  wide-logs.js             // battle + spell logs framing the active spell slot
  wide-activespellslot.js  // right-middle active spell panel
  wide-hand.js             // center-bottom tray, toggle expand/collapse
  styles.css (optional)    // if we decide to split CSS from global stylesheet
```

Assets:
- **Use existing colored battlefield skins** from `src/app/ui/views/battlefield/` (red, blue, green, neutral) based on player deck color. The `public/widescreenbattlefield.png` is a reference image only.
- The battlefield should fill nearly the entire viewport with the appropriate skin stretched or repeated.

CSS and layering:
- Z-index order from back to front:
  1. Wide battlefield background
  2. Creature boards and cards
  3. Attack/target SVG layers (`.attack-lines-svg`, `.target-lines-svg`)
  4. Floating overlays: life globes, phase indicator, player bars, logs, active spell slot, phase buttons, hand tray, toggle button
- Position overlays with absolute/fixed positioning inside the game view root to avoid interfering with event delegation.

Reuse to minimize changes:
- Targeting and attack lines: import and render `renderTargetLines(game)` and `renderAttackLines(game)` from `src/app/ui/views/game/battlefield.js` in the widescreen layout container. These rely only on DOM ids/data-attributes.
- Phase indicator: import `renderPhaseIndicator(game)` and position it in the center overlay.
- Hand tray: import `renderHandArea(player, game)` and wrap it in a tray container controlled by `state.ui.wideHandOpen` (new UI flag), with `data-action="toggle-wide-hand"`.
- Logs and active spell slot: we can initially reuse `renderTopStatusGrid(...)` for correctness, then migrate to split wrappers (`wide-logs.js`, `wide-activespellslot.js`) for final positioning. Each wrapper can call existing renderers internally to keep logic identical.
- Player bars: either reuse `renderPlayerStatBar(...)` and restyle in wide mode, or implement a compact bar that mirrors the same data (mana, deck, hand, grave) and maintains `data-open-grave` for the graveyard modal.

Integration plan (smallest diffs):
1) Add `state.ui.viewMode` and `state.ui.wideHandOpen` (default false). Persist `viewMode` to `localStorage`.
2) Create `renderGameWide()` and export from `src/app/ui/widescreenview/index.js`.
3) Update `src/app/ui/views/game/index.js` to delegate:
   - `renderGame()` → if `state.ui.viewMode === 'wide'` call `renderGameWide()`, else current classic layout. (One small conditional.)
4) Add a toggle button to both layouts with `data-action="toggle-viewmode"` that flips the mode.
5) Add lightweight event handlers in `src/app/ui/events.js` for `toggle-viewmode` and `toggle-wide-hand`.
6) Add responsive behavior: on initial load and on `resize/orientationchange`, if `isLandscape && largeScreen`, switch to wide unless the user has explicitly chosen the other mode. Remember preference.

Components — acceptance criteria

1) wide-battlefield
- Full-bleed image background (`/widescreenbattlefield.png`) or color skin.
- Contains two creature board areas (top and bottom) reusing existing creature renderer logic.
- Does not introduce new ids/attrs for targeting beyond what already exists.

2) wide-lifeglobes
- Two orbs centered vertically: opponent at the top center, player at the bottom center.
- Must use `id="opponent-life-orb"` and `id="player-life-orb"` and `data-player-target`.
- Orbs remain clickable (existing event handler `handleLifeOrbClick`).

3) wide-phaseindicator
- Centered overlay. Reuse `renderPhaseIndicator(game)` for correctness.

4) wide-playerbars
- Compact stat bars placed top-left (opponent) and bottom-left (player).
- Show: name, mana, deck, hand, grave (with `data-open-grave`).

5) wide-phasechangebuttons
- Bottom-right cluster using `renderGameControls(...)`. Hidden during combat just like classic view.

6) wide-logs
- Battle log above, spell log below, flanking `wide-activespellslot` on the right column. Start by wrapping `renderTopStatusGrid(...)`, then iterate to match final layout.

7) wide-activespellslot
- Right-middle panel using existing active spell rendering so cancel/confirm flows remain identical.

8) wide-hand
- Center-bottom tray. Toggled via `data-action="toggle-wide-hand"` and `state.ui.wideHandOpen`.
- Wrap `renderHandArea(player, game)` to avoid duplicating card markup.

Event compatibility and arrows
- Target lines: keep life orb ids and creature attributes so `renderTargetLines(game)` can resolve anchors.
- Attack lines: same expectation; defender arrow should still resolve to `player-life-orb` or `opponent-life-orb` based on local seat.
- Active spell arrows: no changes needed; lines are drawn from SVG overlays to anchor ids.

Risks and mitigations
- CSS z-index stacking could occlude clicks: ensure overlays do not block clicks on creatures unless intended; use `pointer-events: none` on purely decorative layers.
- Layout thrash on resize/orientation: throttle resize handler and re-render once; rely on existing render loop.
- Duplication drift: prefer thin wrappers that call existing renderers to keep logic centralized.

Step-by-step delivery (each step verifiable):
1) (Now) This GAMEPLAN.md committed.
2) Create `wide-battlefield.js` + `index.js` that mounts a background image and an empty overlay scaffold. Render nothing else, but verify toggle wiring (temporary dev toggle) and that the game still runs in classic mode by default.
3) Add view toggle button and events; verify switching back and forth preserves game state.
4) Add `wide-lifeglobes` with correct ids/attrs; verify life targeting and damage arrows hit the orbs.
5) Add `wide-phaseindicator`; verify phase updates.
6) Add `wide-playerbars`; verify counts and graveyard modal.
7) Add `wide-phasechangebuttons`; verify phase progression.
8) Add `wide-logs` and `wide-activespellslot`; verify cancel/confirm flows.
9) Add `wide-hand` tray with toggle; verify card interactions and preview modal.
10) Responsive auto-switch + preference persistence; final polish.

Notes for future maintainers
- The widescreen components are intentionally thin and rely on existing game renderers and event wiring. Keep business logic in the classic view modules; widescreen should be presentation.
- When adding new interactive features, prefer reusing the same `data-action` and `data-*` contracts so both layouts stay compatible without extra event code.


