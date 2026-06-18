// dashboard/js/views/agents.js — agent grid + invoke form.
import { escapeHTML, formatRelative, showModal } from '../utils.js';

export async function render(ctx) {
  const root = document.getElementById('view-agents');
  if (!root) return;

  const agents = ctx.snapshot?.agents || [];
  if (!agents.length && !ctx.snapshot) {
    try {
      const data = await ctx.api.get('/agents');
      ctx.snapshot = { ...(ctx.snapshot || {}), agents: data.agents || [] };
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load agents: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }

  const list = ctx.snapshot?.agents || agents;

  root.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <span class="card-title" style="font-size:18px">Agents (${list.length})</span>
      <button class="btn text-sm" id="agents-refresh">Refresh</button>
    </div>

    ${list.length === 0 ? `
      <div class="empty">No agents found. Run <code>bizar</code> in the terminal to install Bizar.</div>
    ` : `
      <div class="grid cols-3">
        ${list.map((a) => renderCard(a)).join('')}
      </div>
    `}
  `;

  // Wire
  root.querySelector('#agents-refresh')?.addEventListener('click', async () => {
    try {
      const data = await ctx.api.get('/agents');
      ctx.snapshot = { ...(ctx.snapshot || {}), agents: data.agents || [] };
      render(ctx);
      ctx.showToast('Agents refreshed.', 'info', 1500);
    } catch (err) {
      ctx.showToast(`Refresh failed: ${err.message}`, 'error');
    }
  });

  root.querySelectorAll('[data-agent]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const name = el.dataset.agent;
      openAgentModal(ctx, name);
    });
  });
}

function renderCard(a) {
  return `
    <div class="card agent-card" data-agent="${escapeHTML(a.name)}" style="cursor:pointer">
      <div class="flex justify-between items-center">
        <div class="name">${escapeHTML(a.name)}</div>
        <span class="badge">${escapeHTML(a.mode || 'agent')}</span>
      </div>
      <div class="description">${escapeHTML((a.description || '').slice(0, 160))}${(a.description || '').length > 160 ? '…' : ''}</div>
      <div class="row">
        <span>${escapeHTML(a.model || '—')}</span>
        <span>${escapeHTML(formatRelative(a.mtime))}</span>
      </div>
      <div class="flex gap-2">
        <button class="btn text-sm" data-invoke="${escapeHTML(a.name)}">Invoke</button>
      </div>
    </div>
  `;
}

function openAgentModal(ctx, name) {
  const agents = ctx.snapshot?.agents || [];
  const a = agents.find((x) => x.name === name);
  if (!a) return;
  const body = `
    <div class="text-sm">
      <p><strong>${escapeHTML(a.name)}</strong> · <span class="muted mono">${escapeHTML(a.model || '—')}</span></p>
      <p class="muted">${escapeHTML(a.description || '')}</p>
      <p class="mono text-xs muted">${escapeHTML(a.path || a.file || '')}</p>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
      <div class="form-row">
        <label>Prompt</label>
        <textarea id="invoke-prompt" rows="4" placeholder="What should this agent do?"></textarea>
      </div>
    </div>
  `;
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.gap = '8px';
  footer.innerHTML = `
    <button class="btn" id="invoke-cancel">Cancel</button>
    <button class="btn primary" id="invoke-go">Invoke ${escapeHTML(a.name)}</button>
  `;
  const m = showModal({ title: `Invoke ${a.name}`, body, footer });
  footer.querySelector('#invoke-cancel').addEventListener('click', m.close);
  footer.querySelector('#invoke-go').addEventListener('click', async () => {
    const prompt = m.root.querySelector('#invoke-prompt').value.trim();
    if (!prompt) {
      ctx.showToast('Prompt is required.', 'warning');
      return;
    }
    try {
      await ctx.api.post(`/agents/${encodeURIComponent(a.name)}/invoke`, { prompt });
      ctx.showToast(`Invoked ${a.name}.`, 'success');
      m.close();
    } catch (err) {
      ctx.showToast(`Invoke failed: ${err.message}`, 'error');
    }
  });
  setTimeout(() => m.root.querySelector('#invoke-prompt')?.focus(), 50);
}
