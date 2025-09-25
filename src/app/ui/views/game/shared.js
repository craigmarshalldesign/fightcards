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
