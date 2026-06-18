// dashboard/js/views/overview.js — dashboard home: stats, recent activity, quick actions.
import { escapeHTML, formatRelative, formatTime, renderMarkdown } from '../utils.js';

export async function render(ctx) {
  const root = document.getElementById('view-overview');
  if (!root) return;

  const overview = ctx.snapshot?.overview;
  if (!overview) {
    root.innerHTML = '<div class="empty">Loading overview…</div>';
    try {
      const fresh = await ctx.api.get('/overview');
      ctx.snapshot = { ...(ctx.snapshot || {}), overview: fresh };
      render(ctx);
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load overview: ${escapeHTML(err.message)}</div>`;
    }
    return;
  }

  const c = overview.counts || {};
  const v = overview.versions || {};

  root.innerHTML = `
    <h2 class="card-title" style="font-size:18px;margin-bottom:16px;">System Overview</h2>

    <div class="grid cols-4 mb-3">
      <div class="card stat">
        <div class="value">${c.agents ?? 0}</div>
        <div class="label">Agents</div>
        <a class="badge accent" data-go="agents">view →</a>
      </div>
      <div class="card stat">
        <div class="value">${c.plans ?? 0}</div>
        <div class="label">Plans</div>
        <a class="badge accent" data-go="plans">view →</a>
      </div>
      <div class="card stat">
        <div class="value">${c.projects ?? 0}</div>
        <div class="label">Projects</div>
        <a class="badge accent" data-go="projects">view →</a>
      </div>
      <div class="card stat">
        <div class="value">${c.sessions ?? 0}</div>
        <div class="label">Sessions</div>
        <a class="badge accent" data-go="chat">view →</a>
      </div>
    </div>

    <div class="card mb-3">
      <div class="flex justify-between items-center mb-2">
        <span class="card-title">Quick Actions</span>
      </div>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <button class="btn" id="qa-newchat">New Chat</button>
        <button class="btn" id="qa-newplan">New Plan</button>
        <button class="btn" id="qa-switchproj">Switch Project</button>
        <button class="btn" id="qa-audit">Run Audit</button>
        <button class="btn primary" id="qa-refresh">Refresh</button>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title mb-2">Recent Activity</div>
        ${renderActivity(overview.recentActivity || [])}
      </div>
      <div class="card">
        <div class="card-title mb-2">Environment</div>
        <table class="mono text-sm" style="width:100%">
          <tbody>
            <tr><td class="muted">Node</td><td>${escapeHTML(v.node || '')}</td></tr>
            <tr><td class="muted">Platform</td><td>${escapeHTML(v.platform || '')}</td></tr>
            <tr><td class="muted">Project root</td><td>${escapeHTML(v.projectRoot || '')}</td></tr>
            <tr><td class="muted">Bizar root</td><td>${escapeHTML(v.bizarRoot || '')}</td></tr>
            <tr><td class="muted">Generated</td><td>${escapeHTML(formatTime(overview.generatedAt))}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Wire actions
  root.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      ctx.activateTab(el.dataset.go);
    });
  });
  root.querySelector('#qa-refresh')?.addEventListener('click', async () => {
    ctx.showToast('Refreshing…', 'info', 1500);
    await ctx.refreshSnapshot();
  });
  root.querySelector('#qa-newchat')?.addEventListener('click', () => ctx.activateTab('chat'));
  root.querySelector('#qa-newplan')?.addEventListener('click', () => ctx.activateTab('plans'));
  root.querySelector('#qa-switchproj')?.addEventListener('click', () => ctx.activateTab('projects'));
  root.querySelector('#qa-audit')?.addEventListener('click', () => {
    ctx.showToast('Run `bizar audit` in the terminal for security audit.', 'info', 4000);
  });
}

function renderActivity(items) {
  if (!items.length) {
    return '<div class="empty">No recent activity yet. Use the chat or invoke a Bizar command to start a feed.</div>';
  }
  return `
    <div class="activity">
      ${items.map((it) => `
        <div class="activity-item">
          <span class="ts">${escapeHTML(formatRelative(it.ts))}</span>
          <span class="kind">${escapeHTML(it.kind || '')}</span>
          <span class="msg">${renderMarkdown(formatActivityMsg(it))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function formatActivityMsg(it) {
  if (it.message) return it.message;
  if (it.prompt) return it.prompt;
  if (it.slug) return `slug=${it.slug}${it.title ? ` title=${it.title}` : ''}`;
  if (it.name) return `name=${it.name}`;
  return JSON.stringify(it);
}
