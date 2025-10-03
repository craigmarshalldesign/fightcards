import { state, requestRender } from '../../state.js';
import { escapeHtml, sanitizeClass } from '../views/game/shared.js';

export function renderWideLogs({ battleLogEntries = [], spellLogEntries = [] }) {
  // Initialize state if needed - default to open
  if (state.ui && state.ui.wideBattleLogExpanded === undefined) {
    state.ui.wideBattleLogExpanded = true;
  }
  if (state.ui && state.ui.wideSpellLogExpanded === undefined) {
    state.ui.wideSpellLogExpanded = true;
  }

  const battleLogExpanded = state.ui?.wideBattleLogExpanded ?? true;
  const spellLogExpanded = state.ui?.wideSpellLogExpanded ?? true;

  return `
    <div class="wide-logs-row">
      ${renderWideLogPanel({
        title: 'Battle Log',
        entries: battleLogEntries,
        expanded: battleLogExpanded,
        toggleId: 'battle',
        emptyMessage: 'No battle events yet.',
      })}
      ${renderWideLogPanel({
        title: 'Spell Log',
        entries: spellLogEntries,
        expanded: spellLogExpanded,
        toggleId: 'spell',
        emptyMessage: 'No spell activity yet.',
      })}
    </div>
  `;
}

function renderWideLogPanel({ title, entries = [], expanded, toggleId, emptyMessage }) {
  const hasEntries = entries.length > 0;
  // When open, show all entries (scrollable). Always display from oldest to newest.
  const displayEntries = expanded ? entries : [];
  
  let items;
  if (hasEntries && displayEntries.length > 0) {
    items = displayEntries.map((entry) => `<li>${renderLogEntry(entry) || '&nbsp;'}</li>`).join('');
  } else {
    items = `<li class="log-empty">${emptyMessage}</li>`;
  }

  const expandedClass = expanded ? 'expanded' : 'collapsed';

  return `
    <section class="wide-log-panel ${expandedClass}">
      <div class="wide-log-header" onclick="window.toggleWideLog('${toggleId}')">
        <h3>${title}</h3>
        <span class="wide-log-toggle-icon">${expanded ? '▼' : '▲'}</span>
      </div>
      ${expanded ? `<div class="wide-log-body" id="wide-log-${toggleId}"><ul class="wide-log-list">${items}</ul></div>` : ''}
    </section>
  `;
}

function renderLogEntry(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') {
    return escapeHtml(entry);
  }
  const segments = Array.isArray(entry) ? entry : entry.segments || [];
  if (!segments.length && entry.text) {
    return escapeHtml(entry.text);
  }
  return segments.map((segment) => renderLogSegment(segment)).join('');
}

function renderLogSegment(segment) {
  if (!segment) return '';
  switch (segment.type) {
    case 'player':
      return renderPlayerSegment(segment);
    case 'card':
      return renderLogCard(segment);
    case 'damage':
      return `<span class="log-value damage">${escapeHtml(segment.amount ?? segment.value ?? '')}</span>`;
    case 'heal':
      return `<span class="log-value heal">${escapeHtml(segment.amount ?? segment.value ?? '')}</span>`;
    case 'keyword':
      return `<span class="log-keyword">${escapeHtml(segment.text)}</span>`;
    case 'value': {
      const variant = sanitizeClass(segment.variant);
      const variantClass = variant ? ` ${variant}` : '';
      return `<span class="log-value${variantClass}">${escapeHtml(segment.value)}</span>`;
    }
    case 'text':
    default:
      return `<span class="log-text">${escapeHtml(segment.text ?? segment)}</span>`;
  }
}

function renderPlayerSegment(segment) {
  const colorClass = sanitizeClass(segment.color || 'neutral');
  return `<span class="log-player player-${colorClass}">${escapeHtml(segment.name)}</span>`;
}

function renderLogCard(segment) {
  const colorClass = sanitizeClass(segment.color || 'neutral');
  const typeClass = sanitizeClass(segment.cardType || 'card');
  const classes = `log-card-ref card-color-${colorClass} card-type-${typeClass}`;
  const instanceAttr = segment.instanceId ? ` data-card-ref="${escapeHtml(segment.instanceId)}"` : '';
  const snapshotAttr = segment.snapshot
    ? ` data-card-snapshot="${escapeHtml(encodeURIComponent(JSON.stringify(segment.snapshot)))}"`
    : '';
  return `<span class="${classes}"${instanceAttr}${snapshotAttr}>${escapeHtml(segment.name)}</span>`;
}

// Auto-scroll helper
function autoScrollLogsToBottom() {
  setTimeout(() => {
    const battleLogBody = document.getElementById('wide-log-battle');
    const spellLogBody = document.getElementById('wide-log-spell');
    if (battleLogBody && state.ui?.wideBattleLogExpanded) {
      battleLogBody.scrollTop = battleLogBody.scrollHeight;
    }
    if (spellLogBody && state.ui?.wideSpellLogExpanded) {
      spellLogBody.scrollTop = spellLogBody.scrollHeight;
    }
  }, 50);
}

// Export toggle function for onclick handler
if (typeof window !== 'undefined') {
  window.toggleWideLog = function(logType) {
    if (state.ui) {
      if (logType === 'battle') {
        state.ui.wideBattleLogExpanded = !state.ui.wideBattleLogExpanded;
      } else if (logType === 'spell') {
        state.ui.wideSpellLogExpanded = !state.ui.wideSpellLogExpanded;
      }
      requestRender();
      // Auto-scroll to bottom after toggle
      autoScrollLogsToBottom();
    }
  };
  
  // Auto-scroll after any render
  if (!window._wideLogsScrollSetup) {
    window._wideLogsScrollSetup = true;
    // Use mutation observer to detect when logs update
    const observer = new MutationObserver(() => {
      autoScrollLogsToBottom();
    });
    
    // Start observing after a short delay to let the DOM load
    setTimeout(() => {
      const logsContainer = document.querySelector('.wide-logs-row');
      if (logsContainer) {
        observer.observe(logsContainer, { childList: true, subtree: true });
      }
      // Initial scroll
      autoScrollLogsToBottom();
    }, 100);
  }
}

