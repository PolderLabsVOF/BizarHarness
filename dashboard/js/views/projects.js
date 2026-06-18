// dashboard/js/views/projects.js — discovered projects + activate.
import { escapeHTML, formatRelative } from '../utils.js';

export async function render(ctx) {
  const root = document.getElementById('view-projects');
  if (!root) return;

  const projects = ctx.snapshot?.projects || [];
  if (!projects.length && !ctx.snapshot) {
    try {
      const data = await ctx.api.get('/projects');
      ctx.snapshot = { ...(ctx.snapshot || {}), projects: data.projects || [] };
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load projects: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }

  const list = ctx.snapshot?.projects || projects;

  root.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <span class="card-title" style="font-size:18px">Projects (${list.length})</span>
      <button class="btn text-sm" id="proj-refresh">Refresh</button>
    </div>

    ${list.length === 0 ? `
      <div class="empty">No projects with <code>.bizar/PROJECT.md</code> found in the current directory tree or ~/Projects/.</div>
    ` : `
      <div class="grid cols-2">
        ${list.map((p) => renderCard(p)).join('')}
      </div>
    `}
  `;

  root.querySelector('#proj-refresh')?.addEventListener('click', async () => {
    try {
      const data = await ctx.api.get('/projects');
      ctx.snapshot = { ...(ctx.snapshot || {}), projects: data.projects || [] };
      render(ctx);
      ctx.showToast('Projects refreshed.', 'info', 1500);
    } catch (err) {
      ctx.showToast(`Refresh failed: ${err.message}`, 'error');
    }
  });

  root.querySelectorAll('[data-activate]').forEach((el) => {
    el.addEventListener('click', async () => {
      const name = el.dataset.activate;
      try {
        await ctx.api.post(`/projects/${encodeURIComponent(name)}/activate`);
        ctx.showToast(`Activated "${name}". Restart the TUI in that directory to fully switch.`, 'success');
      } catch (err) {
        ctx.showToast(`Activate failed: ${err.message}`, 'error');
      }
    });
  });
}

function renderCard(p) {
  return `
    <div class="card project-card ${p.active ? 'active' : ''}">
      <div class="flex justify-between items-center">
        <div class="title">${escapeHTML(p.name)} ${p.active ? '<span class="badge accent">active</span>' : ''}</div>
        <button class="btn text-sm" ${p.active ? 'disabled' : ''} data-activate="${escapeHTML(p.name)}">Activate</button>
      </div>
      <div class="path mt-1">${escapeHTML(p.path || '')}</div>
      <div class="text-xs muted mt-2">
        ${p.projectMdSize ? `PROJECT.md: ${p.projectMdSize} bytes` : 'no PROJECT.md'}
        ${p.hindsightCount ? ` · .hindsight: ${p.hindsightCount}` : ''}
        · accessed ${escapeHTML(formatRelative(p.mtime))}
      </div>
    </div>
  `;
}
