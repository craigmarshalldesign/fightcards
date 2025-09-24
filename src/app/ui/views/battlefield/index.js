import { renderRedFieldSkin } from './redField.js';
import { renderBlueFieldSkin } from './blueField.js';
import { renderGreenFieldSkin } from './greenField.js';
import { renderNeutralFieldSkin } from './neutralField.js';

const RENDERERS = {
  red: renderRedFieldSkin,
  blue: renderBlueFieldSkin,
  green: renderGreenFieldSkin,
  neutral: renderNeutralFieldSkin,
};

export function renderBattlefieldSkin(color, { isOpponent = false } = {}) {
  const key = String(color || 'neutral').toLowerCase();
  const renderer = RENDERERS[key] || renderNeutralFieldSkin;
  const skinMarkup = renderer();
  const orientationClass = isOpponent ? 'skin-opponent' : 'skin-player';
  return skinMarkup.replace(
    'battlefield-skin ',
    `battlefield-skin ${orientationClass} `,
  );
}
