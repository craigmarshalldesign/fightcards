import { attachParticleField, resetParticleFields } from './particleField.js';

const PARTICLE_SCREENS = new Set(['menu', 'mode-select', 'color-select', 'game-over']);

export function enhanceView(root, screen) {
  resetParticleFields();
  if (!PARTICLE_SCREENS.has(screen)) {
    return;
  }
  root.querySelectorAll('[data-particle-field]').forEach((container) => {
    attachParticleField(container);
  });
}
