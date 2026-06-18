// dashboard/js/utils.js — small shared helpers.

/** Escape user-supplied text before injecting into innerHTML. */
export function escapeHTML(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal markdown → HTML for chat. Not perfect, but good enough. */
export function renderMarkdown(text) {
  if (!text) return '';
  let s = escapeHTML(text);

  // Code fences
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${escapeHTML(lang)}">${code}</code></pre>`;
  });
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\b_([^_\n]+)_\b/g, '<em>$1</em>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Headings (only at line start)
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Links [text](url) — only http(s) to avoid javascript: XSS
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Unordered lists
  s = s.replace(/(^|\n)((?:- .+\n?)+)/g, (m, pre, block) => {
    const items = block.trim().split(/\n/).map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
    return `${pre}<ul>${items}</ul>`;
  });
  // Paragraphs — wrap loose text blocks separated by blank lines
  s = s.split(/\n{2,}/).map(block => {
    if (/^<(h\d|ul|pre|p|blockquote)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return s;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function showToast(message, kind = 'info', durationMs = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, durationMs);
}

export function showModal({ title, body, footer, onClose }) {
  const container = document.getElementById('modal-container');
  if (!container) return;
  container.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>${escapeHTML(title || '')}</h2>
    <div class="modal-body">${body || ''}</div>
    <div class="modal-footer mt-3" style="display:flex;justify-content:flex-end;gap:8px;"></div>
  `;
  if (footer) {
    const f = modal.querySelector('.modal-footer');
    if (typeof footer === 'string') f.innerHTML = footer;
    else f.appendChild(footer);
  }
  backdrop.appendChild(modal);
  container.appendChild(backdrop);

  const close = () => {
    container.innerHTML = '';
    if (onClose) onClose();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      close();
    }
  };
  document.addEventListener('keydown', escHandler);
  return { close, root: modal };
}

/** JSON syntax highlighting for the config tree view (read-only). */
export function highlightJSON(value) {
  const json = JSON.stringify(value, null, 2);
  if (!json) return '';
  return escapeHTML(json)
    .replace(/&quot;([^&]+?)&quot;(\s*:)/g, '<span style="color:#79c0ff">"$1"</span>$2')
    .replace(/:\s*&quot;([^&]+?)&quot;/g, ': <span style="color:#a5d6ff">"$1"</span>')
    .replace(/:\s*(true|false|null)\b/g, ': <span style="color:#ff7b72">$1</span>')
    .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span style="color:#ffa657">$1</span>');
}
