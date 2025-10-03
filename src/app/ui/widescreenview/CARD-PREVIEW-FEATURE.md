# Widescreen Card Hover Preview

## Overview
When the hand is collapsed in widescreen view, players can hover over the small card previews to see a full-sized card preview on the left side of the screen. This allows players to read card details without opening the full hand.

## Features

### Card Preview Display
- **Location**: Left side of the screen, vertically centered
- **Size**: 280px wide, full card rendering
- **Trigger**: Hover over any card in the collapsed hand
- **Animation**: Smooth slide-in from the left (0.2s ease)
- **Visibility**: Only shows when hand is collapsed (hidden when hand is open)

### Interaction
- **Hover on**: Preview appears showing full card details
- **Hover off**: Preview disappears immediately
- **Non-intrusive**: Preview has `pointer-events: none` so it doesn't interfere with gameplay
- **Visual feedback**: Hovered card in hand gets enhanced styling (brighter border, shadow, slight lift)

### Card Information Displayed
The preview shows the full card rendering including:
- Card name and mana cost
- Card type (creature/spell)
- Full card text and abilities
- For creatures: Attack/Defense stats
- Status chips (Haste, Shimmer, etc.)
- Counter modifications (+X/+X)

## Technical Implementation

### Files Created
1. `src/app/ui/widescreenview/wide-cardpreview.js`
   - `renderWideCardPreview()` - Renders the preview container
   - `findCardInHand()` - Helper to find card by instance ID

### Files Modified

1. `src/app/ui/widescreenview/index.js`
   - Imported `renderWideCardPreview`
   - Added preview rendering (only when hand is closed)

2. `src/app/ui/widescreenview/styles.css`
   - Added `.wide-card-preview-container` styles
   - Added slide-in animation
   - Enhanced hover effects on `.wide-hand-card-peek`

3. `src/app/ui/events.js`
   - Added mouseenter/mouseleave handlers for `.wide-hand-card-peek` elements
   - Handlers update `state.ui.wideHoveredCard` and trigger re-render

4. `src/app/state.js`
   - Added `wideHoveredCard: null` to track currently hovered card

## CSS Styling

### Preview Container
```css
.wide-card-preview-container {
  position: fixed;
  left: 2rem;
  top: 50%;
  transform: translateY(-50%);
  z-index: 500;
  pointer-events: none;
  animation: slideInLeft 0.2s ease;
}
```

### Animation
- Slides in from left with opacity fade
- 0.2 second duration for smooth appearance
- 20px horizontal translation during animation

### Card Styling
- 280px width for good readability
- Enhanced shadow for depth (0 8px 32px)
- 12px border radius for modern look
- Matches existing card styling from main game

## Usage
1. Switch to widescreen view
2. Keep hand collapsed (don't click the hand toggle)
3. Move mouse over any small card preview at the bottom
4. Full card preview appears on the left side
5. Move mouse away to hide preview
6. Click card to play it (preview disappears during action)

## Performance Notes
- Preview only renders when `wideHoveredCard` is not null
- Conditional rendering prevents unnecessary DOM updates
- Uses existing `renderCard()` function for consistency
- No additional API calls or data fetching required
- Hover state updates trigger efficient targeted re-renders

## Future Enhancements
- Could add preview for battlefield creatures (hover to preview)
- Could add preview for graveyard cards
- Could add keyboard navigation (arrow keys to browse hand with preview)
- Could add preview delay (show after 200ms hover to prevent flashing)

