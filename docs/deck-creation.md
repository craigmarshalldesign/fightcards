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
   - Ensure late-game creatures can close matches without being strictly better than other colors' finishers.
3. **Spell Suite**
   - Supply removal, tempo tools, and a marquee spell that expresses the color's theme.
   - Reuse existing effect types when possible. If new effect logic is needed, extend `applyEffect` and add entries to `docs/spell-mechanics.md`.
   - Balance card draw or mana acceleration carefully to avoid runaway advantages in multiplayer.
4. **Stat & Cost Review** — Compare new cards against existing ones. Aim for parity in total attack/toughness and number of efficient spells.
5. **AI Strategy Configuration** — Add deck-specific AI behavior to `src/app/game/ai.js` (see AI Configuration section below).
6. **AI Compatibility** — If the deck introduces new targeting rules, update `requirements.js` and AI helpers so single-player behavior remains intelligent.
7. **Multiplayer Readiness**
   - Design cards to resolve deterministically. Avoid ambiguous triggers that could diverge between clients.
   - For any card that references opponent choices (e.g., forced discards), outline how those inputs will be captured in InstantDB.

## File Layout
- Add new creature and spell files under `src/game/cards/<color>-cards/`.
- Export the combined list in `src/game/cards/<color>-cards/index.js` and register the color inside `src/game/cards/index.js` (`COLORS`, `CARD_LIBRARY`).
- Provide localized artwork or placeholders as needed by the UI (`src/app/ui`).

## AI Configuration

When adding a new deck color, you **must** configure its AI strategy in `src/app/game/ai.js` within the `DECK_STRATEGIES` object. This ensures the AI can intelligently pilot the deck in single-player mode.

### Adding a New Deck to DECK_STRATEGIES

Locate the `DECK_STRATEGIES` object (around line 44 in `ai.js`) and add your color as a new key. Each deck strategy has three main sections:

#### 1. Basic Information
```javascript
purple: {
  name: 'Tempo & Evasion',
  description: 'Fast flying creatures with tempo spells',
```

#### 2. Strategic Priorities (0.0 - 1.0 scale)
These values tell the AI how to evaluate and prioritize different aspects of gameplay:

```javascript
  priorities: {
    faceTargeting: 0.6,      // How much to prioritize dealing damage to opponent's life
                              // 0.0 = never go face, 1.0 = always go face
                              // Red: 0.8, Blue: 0.2, Green: 0.3
    
    boardControl: 0.7,        // How much to value controlling the battlefield
                              // 0.0 = ignore board, 1.0 = prioritize board
                              // Red: 0.4, Blue: 0.9, Green: 0.8
    
    cardAdvantage: 0.6,       // How much to value drawing extra cards
                              // 0.0 = ignore cards, 1.0 = maximize cards
                              // Red: 0.3, Blue: 0.9, Green: 0.5
    
    creatureQuality: 0.5,     // How much individual creature power matters
                              // 0.0 = quantity over quality, 1.0 = quality over quantity
                              // Red: 0.5, Blue: 0.4, Green: 0.9
  },
```

**Guidelines:**
- Sum of priorities should be roughly 2.0-2.5 for balance
- Aggressive decks: Higher `faceTargeting`, lower `boardControl`
- Control decks: Higher `boardControl` and `cardAdvantage`, lower `faceTargeting`
- Midrange decks: Balanced across all four priorities

#### 3. Combat Strategy
```javascript
  combat: {
    attackAggression: 0.7,    // How aggressively to attack (0.0 - 1.0)
                              // 0.0 = never attack, 1.0 = always attack
                              // Affects attack decisions each turn
    
    blockAggression: 0.6,     // How aggressively to block (0.0 - 1.0)
                              // 0.0 = never block, 1.0 = always block
                              // Higher = block more often, even unfavorable trades
    
    acceptBadTrades: false,   // Willing to trade creatures unfavorably?
                              // true = attack even if creatures will die
                              // false = preserve creatures, attack strategically
                              // Red: true, Blue/Green: false
    
    pressureThreshold: 10,    // Opponent life total to start racing (1-20)
                              // When opponent hits this life, AI gets more aggressive
                              // Red: 12, Blue: 8, Green: 10
  },
```

**Combat Strategy Guidelines:**
- **Aggro Decks:** `attackAggression: 0.8-0.9`, `blockAggression: 0.4-0.5`, `acceptBadTrades: true`, `pressureThreshold: 12-15`
- **Control Decks:** `attackAggression: 0.5-0.6`, `blockAggression: 0.8-0.9`, `acceptBadTrades: false`, `pressureThreshold: 6-8`
- **Midrange Decks:** `attackAggression: 0.6-0.7`, `blockAggression: 0.6-0.7`, `acceptBadTrades: false`, `pressureThreshold: 10-12`

#### 4. Dynamic Evaluation Function

The `evaluate` function lets the AI make real-time strategic decisions based on game state:

```javascript
  evaluate: (game, aiIndex) => {
    const ai = game.players[aiIndex];
    const opponent = game.players[aiIndex === 0 ? 1 : 0];
    
    // Example: Count specific card types or effects in hand
    const evasiveCreatures = ai.battlefield.filter(c => 
      c.abilities?.flying || c.abilities?.shimmer
    ).length;
    
    const controlSpells = ai.hand.filter(card =>
      card.effects?.some(e => ['bounce', 'freeze'].includes(e.type))
    ).length;
    
    return {
      shouldRace: opponent.life <= 10 && evasiveCreatures >= 2,
      canFinish: evasiveCreatures >= 3 && opponent.life <= 8,
      priority: evasiveCreatures >= 2 ? 'attack-air' : 'build-board',
    };
  },
```

**Return Object:**
- `shouldRace` (boolean): Should AI race (ignore board, go for lethal)?
- `canFinish` (boolean): Can AI finish the game soon?
- `priority` (string): Current strategy focus (e.g., 'damage-face', 'draw-and-control', 'build-board')

**Evaluation Guidelines:**
- **Count key resources:** Specific creature types, burn spells, card draw, etc.
- **Assess board state:** Creature counts, total power/toughness, threats
- **Set dynamic thresholds:** When to race, when to stabilize, when to finish
- **Use deck-specific logic:** Red counts burn damage, Green counts big creatures, Blue counts card advantage

### Complete Example: Purple (Tempo & Evasion)

```javascript
purple: {
  name: 'Tempo & Evasion',
  description: 'Fast flying creatures with bounce/tempo spells to maintain advantage',
  
  priorities: {
    faceTargeting: 0.6,        // Moderate aggression with evasion
    boardControl: 0.7,          // Keep opponent off-balance
    cardAdvantage: 0.6,         // Value tempo over raw card advantage
    creatureQuality: 0.5,       // Mix of small fliers and threats
  },
  
  combat: {
    attackAggression: 0.75,     // Attack often with evasive creatures
    blockAggression: 0.5,       // Block selectively
    acceptBadTrades: false,     // Preserve evasive creatures
    pressureThreshold: 11,      // Start racing when opponent is low
  },
  
  evaluate: (game, aiIndex) => {
    const ai = game.players[aiIndex];
    const opponent = game.players[aiIndex === 0 ? 1 : 0];
    
    // Count flying/evasive creatures
    const flyingCreatures = ai.battlefield.filter(c =>
      c.abilities?.flying || c.abilities?.shimmer
    ).length;
    
    // Count tempo spells (bounce, freeze)
    const tempoSpells = ai.hand.filter(card =>
      card.effects?.some(e => ['bounce', 'freeze'].includes(e.type))
    ).length;
    
    // Calculate potential damage from unblockable threats
    const evasiveDamage = ai.battlefield.reduce((total, c) => {
      if (c.abilities?.flying || c.abilities?.shimmer) {
        const stats = getCreatureStats(c, aiIndex, game);
        return total + stats.attack;
      }
      return total;
    }, 0);
    
    return {
      shouldRace: flyingCreatures >= 2 && opponent.life <= 12,
      canFinish: evasiveDamage >= opponent.life,
      priority: flyingCreatures >= 2 ? 'pressure-air' : 'setup-evasion',
    };
  },
},
```

### AI Configuration Checklist

When adding a new deck, ensure:
- ✅ Strategy name and description match the deck's theme
- ✅ Priorities sum to 2.0-2.5 and reflect the deck's playstyle
- ✅ Combat values align with deck archetype (aggro/control/midrange)
- ✅ Evaluate function counts deck-specific resources
- ✅ Evaluate function returns meaningful `shouldRace` and `canFinish` booleans
- ✅ Test AI plays the deck as intended (not too passive or too aggressive)

### Common Pitfalls

❌ **Don't:** Set all priorities to 1.0 (makes AI unfocused)  
✅ **Do:** Emphasize 1-2 priorities that define the deck

❌ **Don't:** Set `attackAggression` to 1.0 unless truly all-in aggro  
✅ **Do:** Use 0.6-0.8 for most aggressive decks

❌ **Don't:** Leave evaluate function empty or generic  
✅ **Do:** Count specific cards that matter to your deck's strategy

❌ **Don't:** Copy another deck's strategy exactly  
✅ **Do:** Tune values based on playtesting with the new deck

## Testing & Validation
- **Unit Tests / Build** — Run `npm run build` to ensure the project bundles successfully.
- **Playtest Scripts** — Use the existing single-player mode to check for gameplay loops, ensuring the AI can pilot or counter the new deck.
  - Test on **Easy difficulty** to verify basic functionality
  - Test on **Hard difficulty** to verify strategic AI behavior matches deck theme
  - Play against the new AI deck to ensure it's competitive but beatable
- **AI Behavior Validation** — Watch for:
  - AI attacking/blocking at appropriate times
  - AI using deck-specific cards effectively (e.g., bounce when behind, burn for lethal)
  - AI not making obvious misplays (e.g., wasting removal, suicide attacks)
- **Documentation Updates** — Append any new mechanics, keywords, or spell effects to the relevant docs so other contributors understand the additions.

By following these standards, a future Purple Air-Lightning deck—and any other expansions—will feel cohesive, balanced, and ready for multiplayer deployment.
