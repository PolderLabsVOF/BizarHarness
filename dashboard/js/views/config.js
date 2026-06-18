// dashboard/js/views/config.js — opencode.json editor with live validation.
import { escapeHTML, debounce, highlightJSON, showModal } from '../utils.js';

let configState = {
  raw: '',
  parsed: null,
  error: null,
  dirty: false,
  saving: false,
  original: '',
  path: '',
};

export async function render(ctx) {
  const root = document.getElementById('view-config');
  if (!root) return;

  // Load on first render
  if (!configState.raw && !configState.dirty) {
    try {
      const data = await ctx.api.get('/config');
      configState.raw = data.raw || (data.data ? JSON.stringify(data.data, null, 2) : '');
      configState.parsed = data.data || null;
      configState.original = configState.raw;
      configState.path = data.path || '';
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load config: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }

  // Refresh snapshot data too so other things stay in sync
  const cfg = ctx.snapshot?.config;

  root.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <span class="card-title" style="font-size:18px">Config</span>
      <div class="flex gap-2 items-center">
        <span class="text-xs muted mono">${escapeHTML(configState.path || cfg?.path || '')}</span>
        <button class="btn text-sm" id="cfg-reload">Reload from disk</button>
        <button class="btn primary text-sm" id="cfg-save" ${configState.saving || !!configState.error || !configState.dirty ? 'disabled' : ''}>${configState.saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>

    <div class="config-grid">
      <div class="card">
        <div class="card-title mb-2">JSON Tree</div>
        <div class="json-tree">${configState.parsed ? highlightJSON(configState.parsed) : '<span class="muted">No data</span>'}</div>
      </div>
      <div class="card">
        <div class="card-title mb-2">Raw JSON</div>
        <textarea id="cfg-textarea" class="config-textarea ${configState.error ? 'invalid' : ''}" spellcheck="false">${escapeHTML(configState.raw)}</textarea>
        ${configState.error ? `<div class="config-error">${escapeHTML(configState.error)}</div>` : ''}
      </div>
    </div>

    <div class="card mt-3">
      <div class="card-title mb-2">Diff vs Last Save</div>
      <div id="cfg-diff" class="mono text-xs">${renderDiff(configState.original, configState.raw)}</div>
    </div>
  `;

  wire(root, ctx);
}

function wire(root, ctx) {
  const ta = root.querySelector('#cfg-textarea');
  const save = root.querySelector('#cfg-save');
  const reload = root.querySelector('#cfg-reload');
  const diff = root.querySelector('#cfg-diff');
  const card = ta.closest('.card');

  const onInput = debounce(() => {
    configState.raw = ta.value;
    configState.dirty = configState.raw !== configState.original;
    try {
      configState.parsed = JSON.parse(ta.value);
      configState.error = null;
      ta.classList.remove('invalid');
    } catch (err) {
      configState.parsed = null;
      configState.error = err.message;
      ta.classList.add('invalid');
    }
    save.disabled = !!configState.error || !configState.dirty || configState.saving;
    diff.innerHTML = renderDiff(configState.original, configState.raw);
    // Re-render JSON tree panel
    const treePanel = root.querySelector('.json-tree');
    if (treePanel) treePanel.innerHTML = configState.parsed ? highlightJSON(configState.parsed) : '<span class="muted">No data</span>';
    // Re-show error
    const oldErr = card.querySelector('.config-error');
    if (oldErr) oldErr.remove();
    if (configState.error) {
      const e = document.createElement('div');
      e.className = 'config-error';
      e.textContent = configState.error;
      card.appendChild(e);
    }
  }, 150);

  ta.addEventListener('input', onInput);

  save.addEventListener('click', async () => {
    if (!configState.parsed) return;
    configState.saving = true;
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      const result = await ctx.api.put('/config', configState.parsed);
      configState.original = JSON.stringify(result.data, null, 2);
      configState.raw = configState.original;
      configState.dirty = false;
      configState.saving = false;
      ctx.showToast('Config saved.', 'success');
      render(ctx);
    } catch (err) {
      configState.saving = false;
      save.disabled = false;
      save.textContent = 'Save';
      ctx.showToast(`Save failed: ${err.message}`, 'error');
    }
  });

  reload.addEventListener('click', async () => {
    if (configState.dirty) {
      const ok = confirm('Discard unsaved changes and reload from disk?');
      if (!ok) return;
    }
    try {
      const data = await ctx.api.post('/config/reload');
      configState.raw = data.raw || (data.data ? JSON.stringify(data.data, null, 2) : '');
      configState.parsed = data.data || null;
      configState.original = configState.raw;
      configState.dirty = false;
      configState.error = null;
      ctx.snapshot = { ...(ctx.snapshot || {}), config: data };
      ctx.showToast('Config reloaded.', 'info', 1500);
      render(ctx);
    } catch (err) {
      ctx.showToast(`Reload failed: ${err.message}`, 'error');
    }
  });
}

function renderDiff(a, b) {
  if (a === b) return '<span class="muted">No changes.</span>';
  // Very simple line-level diff
  const aLines = (a || '').split('\n');
  const bLines = (b || '').split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    const al = aLines[i] ?? '';
    const bl = bLines[i] ?? '';
    if (al === bl) {
      out.push(`<div>${escapeHTML(al)}</div>`);
    } else {
      if (al) out.push(`<div style="color:var(--error);background:rgba(248,81,73,0.08);padding:0 4px">- ${escapeHTML(al)}</div>`);
      if (bl) out.push(`<div style="color:var(--success);background:rgba(63,185,80,0.08);padding:0 4px">+ ${escapeHTML(bl)}</div>`);
    }
  }
  return out.join('');
}
