// dashboard/js/views/plans.js — plan list + new plan form + canvas view.
import { escapeHTML, formatRelative, debounce } from '../utils.js';

let plansFilter = '';
let selectedSlug = null;

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

  // Determine selected plan — keep existing or auto-select first
  const currentSlug = selectedSlug;
  const validSlug = currentSlug && list.some((p) => p.slug === currentSlug) ? currentSlug : null;

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

    ${filtered.length === 0 && list.length === 0 ? `
      <div class="empty">No plans yet. Create one above.</div>
    ` : `
      <div class="plans-layout">
        <div class="plans-list-col">
          ${filtered.map((p) => renderCard(p, p.slug === validSlug)).join('')}
        </div>
        <div class="plans-canvas-col" id="plans-canvas-col">
          ${validSlug ? '' : '<div class="empty canvas-empty">Select a plan to view its canvas.</div>'}
        </div>
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
      selectedSlug = slug;
      const data = await ctx.api.get('/plans');
      ctx.snapshot = { ...(ctx.snapshot || {}), plans: data.plans || [] };
      render(ctx);
    } catch (err) {
      ctx.showToast(`Create failed: ${err.message}`, 'error');
    }
  });

  // Plan card clicks — view action
  root.querySelectorAll('[data-plan]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const slug = el.dataset.plan;
      const action = el.dataset.action || 'view';
      if (action === 'view') {
        selectedSlug = slug;
        render(ctx).then(() => {
          loadCanvas(ctx, slug);
        });
      } else if (action === 'open') {
        // Open in new tab — fall back to the existing CLI flow
        ctx.showToast(`Opening plan "${slug}" via the CLI. Use: bizar plan open ${slug}`, 'info', 4000);
      }
    });
  });

  // Load canvas if a slug is selected
  if (validSlug) {
    await loadCanvas(ctx, validSlug);
  }
}

function renderCard(p, isSelected) {
  const status = p.status || 'draft';
  const badgeKind = ({
    draft: '',
    approved: 'success',
    rejected: 'error',
    'in-progress': 'info',
    done: 'accent',
  })[status] || '';
  return `
    <div class="card plan-card ${isSelected ? 'selected' : ''}" data-plan="${escapeHTML(p.slug)}" data-action="view">
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
        <button class="btn text-sm" data-plan="${escapeHTML(p.slug)}" data-action="open">Open</button>
      </div>
    </div>
  `;
}

async function loadCanvas(ctx, slug) {
  const col = document.getElementById('plans-canvas-col');
  if (!col) return;

  col.innerHTML = `
    <div class="canvas-loading">
      <div class="spinner"></div>
      <span class="muted text-sm">Loading canvas…</span>
    </div>
  `;

  try {
    const data = await ctx.api.get(`/plans/${encodeURIComponent(slug)}/canvas`);
    const canvas = data.canvas || {};
    const elements = canvas.elements || [];
    const comments = canvas.comments || [];
    const connections = canvas.connections || [];
    renderCanvasInPane(ctx, col, slug, canvas, elements, comments, connections);
  } catch (err) {
    col.innerHTML = `
      <div class="empty canvas-empty">
        Could not load canvas: ${escapeHTML(err.message)}
      </div>
    `;
  }
}

function renderCanvasInPane(ctx, col, slug, canvas, elements, comments, connections) {
  const title = canvas.title || slug;
  const viewport = canvas.viewport || { x: 0, y: 0, zoom: 1 };

  col.innerHTML = `
    <div class="canvas-header">
      <div class="flex justify-between items-center">
        <div>
          <span class="canvas-plan-title">${escapeHTML(title)}</span>
          <span class="muted text-xs" style="margin-left:8px">${elements.length} element${elements.length !== 1 ? 's' : ''} · ${comments.length} comment${comments.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="flex gap-2">
          <button class="btn text-sm" id="canvas-refresh" title="Refresh canvas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <button class="btn text-sm" id="canvas-popout" title="Open in new tab">↗</button>
        </div>
      </div>
      <div class="canvas-viewport-hint text-xs muted mt-1">
        Pan: drag · Zoom: scroll · Click element to view comments
      </div>
    </div>
    <div class="canvas-area" id="canvas-area">
      <div class="canvas-elements" id="canvas-elements">
        ${elements.length === 0 ? `<div class="canvas-empty-hint">No elements yet. Add one via the CLI: /plan add ${slug} &lt;type&gt;</div>` : ''}
        ${elements.map((el) => renderCanvasElement(el)).join('')}
      </div>
      ${connections.length > 0 ? `
        <svg class="canvas-connections" id="canvas-connections">
          ${connections.map((c) => {
            const fromEl = elements.find((e) => e.id === c.fromElementId || e.id === c.from);
            const toEl = elements.find((e) => e.id === c.toElementId || e.id === c.to);
            if (!fromEl || !toEl) return '';
            const x1 = (fromEl.x || 0) + (fromEl.width || 240) / 2;
            const y1 = (fromEl.y || 0) + (fromEl.height || 160);
            const x2 = (toEl.x || 0) + (toEl.width || 240) / 2;
            const y2 = (toEl.y || 0);
            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#arrow)"/>`;
          }).join('')}
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)"/>
            </marker>
          </defs>
        </svg>
      ` : ''}
    </div>
    <div class="canvas-comments-panel" id="canvas-comments-panel">
      <div class="card-title mb-2" style="font-size:13px">Comments (${comments.length})</div>
      <div class="comments-list" id="comments-list">
        ${comments.length === 0 ? '<div class="muted text-xs">No comments yet.</div>' : ''}
        ${comments.map((c) => renderComment(c)).join('')}
      </div>
    </div>
  `;

  // Wire refresh
  col.querySelector('#canvas-refresh')?.addEventListener('click', () => {
    loadCanvas(ctx, slug);
  });

  // Wire popout — open in full editor via CLI
  col.querySelector('#canvas-popout')?.addEventListener('click', () => {
    ctx.showToast(`Opening plan "${slug}" via the CLI. Use: bizar plan open ${slug}`, 'info', 4000);
  });

  // Element click — highlight + show element comments
  col.querySelectorAll('.canvas-element').forEach((elDiv) => {
    elDiv.addEventListener('click', () => {
      const elId = elDiv.dataset.elId;
      // Highlight selected element
      col.querySelectorAll('.canvas-element').forEach((e) => e.classList.remove('el-selected'));
      elDiv.classList.add('el-selected');
      // Filter comments to this element
      const elComments = comments.filter((c) => c.elementId === elId || c.id === elId);
      const panel = document.getElementById('canvas-comments-panel');
      if (panel) {
        const list = panel.querySelector('#comments-list');
        if (list) {
          list.innerHTML = elComments.length === 0
            ? `<div class="muted text-xs">No comments on this element.</div>`
            : elComments.map((c) => renderComment(c)).join('');
        }
      }
    });
  });

  // Pan/zoom via mouse drag on canvas-area
  setupCanvasPanZoom(col, viewport);
}

function renderCanvasElement(el) {
  const x = el.x || 0;
  const y = el.y || 0;
  const w = el.width || 240;
  const h = el.height || 160;
  const type = el.type || 'text';
  const title = el.title || 'Untitled';
  const content = el.content || '';
  const truncated = content.length > 120 ? content.slice(0, 120) + '…' : content;
  return `
    <div class="canvas-element"
         data-el-id="${escapeHTML(el.id || '')}"
         style="left:${x}px;top:${y}px;width:${w}px;min-height:${h}px">
      <div class="el-type">${escapeHTML(type)}</div>
      <div class="el-title">${escapeHTML(title)}</div>
      ${truncated ? `<div class="el-content">${escapeHTML(truncated)}</div>` : ''}
    </div>
  `;
}

function renderComment(c) {
  const replies = c.thread || [];
  const text = c.text || '';
  const author = c.author || 'unknown';
  const created = c.created ? formatRelative(new Date(c.created)) : '';
  return `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${escapeHTML(author)}</span>
        <span class="comment-time muted text-xs">${escapeHTML(created)}</span>
      </div>
      <div class="comment-text">${escapeHTML(text)}</div>
      ${replies.length > 0 ? `
        <div class="comment-replies">
          ${replies.map((r) => `
            <div class="reply-item">
              <span class="comment-author text-xs">${escapeHTML(r.author || 'unknown')}</span>
              <span class="muted text-xs">${escapeHTML(r.text || '')}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function setupCanvasPanZoom(col, viewport) {
  const area = col.querySelector('#canvas-area');
  const elements = col.querySelector('#canvas-elements');
  if (!area || !elements) return;

  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOffsetX = viewport.x || 0;
  let panOffsetY = viewport.y || 0;

  elements.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;

  area.addEventListener('mousedown', (e) => {
    if (e.target !== area && !e.target.classList.contains('canvas-connections')) return;
    panning = true;
    panStartX = e.clientX - panOffsetX;
    panStartY = e.clientY - panOffsetY;
    area.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!panning) return;
    panOffsetX = e.clientX - panStartX;
    panOffsetY = e.clientY - panStartY;
    elements.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;
  });

  document.addEventListener('mouseup', () => {
    if (panning) {
      panning = false;
      area.style.cursor = '';
    }
  });

  area.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const currentTransform = elements.style.transform;
    const m = currentTransform.match(/scale\(([\d.]+)\)/);
    const currentScale = m ? parseFloat(m[1]) : 1;
    const newScale = Math.min(Math.max(currentScale * delta, 0.2), 3);
    elements.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${newScale})`;
  }, { passive: false });
}