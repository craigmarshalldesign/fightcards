export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeClass(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

export function formatText(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function getPassivePreviewInfo(passive) {
  if (!passive || !passive.description) {
    return null;
  }
  let label;
  switch (passive.type) {
    case 'onEnter':
      label = 'On Enter';
      break;
    case 'onAttack':
      label = 'Triggered';
      break;
    case 'onDeath':
      label = 'On Death';
      break;
    case 'static':
      label = 'Passive';
      break;
    default:
      label = passive.type ? 'Ability' : '';
      break;
  }
  return { label, description: passive.description };
}
