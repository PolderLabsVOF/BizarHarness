// dashboard/js/views/plans.js — plan list + new plan form + canvas link.
import { escapeHTML, formatRelative, debounce } from '../utils.js';

let plansFilter = '';

export async function render(ctx) {
  const root = document.getElementById('view-plans');
  if (!root) return;

  const plans = ctx.snapshot?.plans || [];
  if (!plans.length && !ctx.snapshot) {
    try {
      const data = await ctx.api.get('/plans');
      ctx.snapshot = { ...(ctx.snapshot || {}), plans: data.plans || [] };
    } catch (err) {
      root.innerHTML = `<div class="empty">Could not load plans: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }

  const list = ctx.snapshot?.plans || plans;
  const filtered = plansFilter
    ? list.filter((p) => (p.status || '').toLowerCase().includes(plansFilter.toLowerCase()))
    : list;
  const statuses = Array.from(new Set(list.map((p) => p.status || 'draft')));

  root.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <span class="card-title" style="font-size:18px">Plans (${list.length})</span>
      <div class="flex gap-2 items-center">
        <select id="plans-filter" class="text-sm" style="width:auto">
          <option value="">All statuses</option>
          ${statuses.map((s) => `<option ${s === plansFilter ? 'selected' : ''}>${escapeHTML(s)}</option>`).join('')}
        </select>
        <button class="btn text-sm" id="plans-refresh">Refresh</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-title mb-2">New Plan</div>
      <form id="new-plan-form" class="new-plan-form">
        <input type="text" id="new-plan-slug" placeholder="slug (e.g. dashboard-v2.5)" pattern="[a-z0-9][a-z0-9-]{0,63}" required>
        <input type="text" id="new-plan-title" placeholder="Title (optional)">
        <button class="btn primary" type="submit">Create</button>
      </form>
      <div class="text-xs muted">Slug must be lowercase, may contain hyphens, 1–64 chars.</div>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty">${list.length === 0 ? 'No plans yet. Create one above.' : 'No plans match the filter.'}</div>
    ` : `
      <div class="grid cols-2">
        ${filtered.map((p) => renderCard(p)).join('')}
      </div>
    `}
  `;

  // Wire
  root.querySelector('#plans-refresh')?.addEventListener('click', async () => {
    try {
      const data = await ctx.api.get('/plans');
      ctx.snapshot = { ...(ctx.snapshot || {}), plans: data.plans || [] };
      render(ctx);
      ctx.showToast('Plans refreshed.', 'info', 1500);
    } catch (err) {
      ctx.showToast(`Refresh failed: ${err.message}`, 'error');
    }
  });

  const filter = root.querySelector('#plans-filter');
  filter?.addEventListener('change', () => {
    plansFilter = filter.value;
    render(ctx);
  });

  const form = root.querySelector('#new-plan-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = root.querySelector('#new-plan-slug').value.trim();
    const title = root.querySelector('#new-plan-title').value.trim() || undefined;
    if (!slug) return;
    try {
      await ctx.api.post('/plans', { slug, title });
      ctx.showToast(`Plan "${slug}" created.`, 'success');
      const data = await ctx.api.get('/plans');
      ctx.snapshot = { ...(ctx.snapshot || {}), plans: data.plans || [] };
      render(ctx);
    } catch (err) {
      ctx.showToast(`Create failed: ${err.message}`, 'error');
    }
  });

  root.querySelectorAll('[data-plan]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const slug = el.dataset.plan;
      const action = el.dataset.action || 'open';
      if (action === 'open') {
        // Open in new tab — fall back to the existing CLI flow if the SPA isn't wired
        ctx.showToast(`Opening plan "${slug}" via the CLI. Use: bizar plan open ${slug}`, 'info', 4000);
      } else if (action === 'view') {
        openPlanDetail(ctx, slug);
      }
    });
  });
}

function renderCard(p) {
  const status = p.status || 'draft';
  const badgeKind = ({
    draft: '',
    approved: 'success',
    rejected: 'error',
    'in-progress': 'info',
    done: 'accent',
  })[status] || '';
  return `
    <div class="card plan-card">
      <div class="flex justify-between items-center">
        <div class="title">${escapeHTML(p.title || p.slug)}</div>
        <span class="badge ${badgeKind}">${escapeHTML(status)}</span>
      </div>
      <div class="slug mt-1">${escapeHTML(p.slug)} · ${escapeHTML(p.source || 'worktree')}</div>
      <div class="text-xs muted mt-2">
        ${p.elementCount != null ? `${p.elementCount} elements` : ''}
        ${p.commentCount != null ? ` · ${p.commentCount} comments` : ''}
        · edited ${escapeHTML(formatRelative(p.mtime))}
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn text-sm" data-plan="${escapeHTML(p.slug)}" data-action="view">View</button>
        <button class="btn text-sm" data-plan="${escapeHTML(p.slug)}" data-action="open">Open in canvas</button>
      </div>
    </div>
  `;
}

async function openPlanDetail(ctx, slug) {
  try {
    const data = await ctx.api.get(`/plans/${encodeURIComponent(slug)}`);
    const body = `
      <div class="text-sm">
        <div class="mb-2">
          <span class="muted mono">${escapeHTML(data.dir || '')}</span>
        </div>
        <div class="mb-2"><strong>Meta</strong></div>
        <pre class="mono text-xs" style="background:var(--bg);padding:8px;border-radius:4px;max-height:160px;overflow:auto">${escapeHTML(JSON.stringify(data.meta || {}, null, 2))}</pre>
        ${data.planMdx ? `
          <div class="mb-2 mt-3"><strong>plan.mdx</strong> (${data.planMdx.length} bytes)</div>
          <pre class="mono text-xs" style="background:var(--bg);padding:8px;border-radius:4px;max-height:200px;overflow:auto">${escapeHTML(data.planMdx.slice(0, 2000))}${data.planMdx.length > 2000 ? '\n…' : ''}</pre>
        ` : '<div class="muted">No plan.mdx yet.</div>'}
      </div>
    `;
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '8px';
    footer.innerHTML = `<button class="btn primary" id="plan-close">Close</button>`;
    const m = showModal({ title: `Plan: ${slug}`, body, footer });
    footer.querySelector('#plan-close').addEventListener('click', m.close);
  } catch (err) {
    ctx.showToast(`Could not load plan: ${err.message}`, 'error');
  }
}
