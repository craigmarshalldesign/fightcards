import { attachParticleField, resetParticleFields } from './particleField.js';
import { applyWideMobileOrientation } from '../widescreenview/mobile-orientation.js';

const PARTICLE_SCREENS = new Set([
  'menu',
  'mode-select',
  'color-select',
  'game-over',
  'multiplayer-lobbies',
  'multiplayer-lobby-detail',
]);

export function enhanceView(root, screen) {
  applyWideMobileOrientation(root);
  resetParticleFields();
  if (!PARTICLE_SCREENS.has(screen)) {
    return;
  }
  root.querySelectorAll('[data-particle-field]').forEach((container) => {
    attachParticleField(container);
  });
}
