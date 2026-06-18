// dashboard/js/views/tasks.js — Personal Task Kanban Board
import { escapeHTML } from '../utils.js';

const COLUMNS = [
  { id: 'queued', label: 'Queued' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

let filterQuery = '';
let focusedTaskId = null;

// ─── render ─────────────────────────────────────────────────────────────────

export async function render(ctx) {
  const root = document.getElementById('view-tasks');
  if (!root) return;

  registerKeyboardShortcuts(ctx);

  // Ensure tasks are loaded
  if (!ctx.snapshot?.tasks) {
    try {
      const data = await ctx.api.get('/tasks');
      ctx.snapshot = { ...(ctx.snapshot || {}), tasks: Array.isArray(data) ? data : [] };
    } catch {
      ctx.snapshot = { ...(ctx.snapshot || {}), tasks: [] };
    }
  }

  const allTasks = ctx.snapshot.tasks || [];
  const filtered = filterTasks(allTasks, filterQuery);

  root.innerHTML = `
    <div class="tasks-header">
      <span class="card-title" style="font-size:18px">Tasks</span>
      <div class="tasks-search">
        <input type="text" id="tasks-filter" placeholder="Search tasks…" value="${escapeHTML(filterQuery)}">
        ${filterQuery ? '<button class="btn text-sm" id="tasks-filter-clear">Clear</button>' : ''}
      </div>
    </div>
    <div class="kanban">
      ${COLUMNS.map((col) => renderColumn(col, filtered, ctx)).join('')}
    </div>
  `;

  wire(root, ctx, allTasks);
}

// ─── column ──────────────────────────────────────────────────────────────────

function renderColumn(col, tasks, ctx) {
  const colTasks = tasks.filter((t) => t.status === col.id);
  return `
    <div class="kanban-column" data-column="${col.id}">
      <div class="kanban-col-header">
        <span class="kanban-col-title">${escapeHTML(col.label)}</span>
        <span class="badge">${colTasks.length}</span>
      </div>
      <div class="kanban-col-body" id="col-body-${col.id}">
        ${colTasks.length === 0
          ? '<div class="kanban-empty">No tasks</div>'
          : colTasks.map((t) => renderCard(t)).join('')
        }
      </div>
      <div class="kanban-col-footer">
        <button class="btn w-full add-task-btn" data-status="${col.id}">+ Add task</button>
      </div>
    </div>
  `;
}

// ─── card ────────────────────────────────────────────────────────────────────

function renderCard(task) {
  const isFocused = focusedTaskId === task.id;
  const priorityClass = `priority-${task.priority}`;
  const priorityDot = priorityDotHTML(task.priority);
  const tags = (task.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join('');
  const descPreview = task.description
    ? escapeHTML(task.description).slice(0, 120) + (task.description.length > 120 ? '…' : '')
    : '';

  return `
    <div class="task-card ${priorityClass} ${isFocused ? 'focused' : ''}" data-task-id="${task.id}">
      <div class="task-card-header">
        <span class="priority-dot">${priorityDot}</span>
        <span class="task-title" data-task-id="${task.id}">${escapeHTML(task.title)}</span>
      </div>
      ${descPreview ? `<div class="task-desc">${descPreview}</div>` : ''}
      ${tags ? `<div class="task-tags">${tags}</div>` : ''}
      <div class="task-actions">
        <button class="task-btn move-left" data-task-id="${task.id}" title="Move left">←</button>
        <button class="task-btn edit-btn" data-task-id="${task.id}" title="Edit (e)">✎</button>
        <button class="task-btn delete-btn" data-task-id="${task.id}" title="Delete">🗑</button>
        <button class="task-btn move-right" data-task-id="${task.id}" title="Move right">→</button>
      </div>
    </div>
  `;
}

function priorityDotHTML(priority) {
  const colors = { low: '#8b949e', normal: '#58a6ff', high: '#f85149' };
  const color = colors[priority] || colors.normal;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`;
}

// ─── filter ──────────────────────────────────────────────────────────────────

function filterTasks(tasks, query) {
  if (!query.trim()) return tasks;
  const q = query.toLowerCase();
  return tasks.filter((t) => {
    const title = (t.title || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    const tags = (t.tags || []).join(' ').toLowerCase();
    return title.includes(q) || desc.includes(q) || tags.includes(q);
  });
}

// ─── wire ───────────────────────────────────────────────────────────────────

function wire(root, ctx, allTasks) {
  // Filter
  root.querySelector('#tasks-filter')?.addEventListener('input', (e) => {
    filterQuery = e.target.value;
    render(ctx);
  });
  root.querySelector('#tasks-filter-clear')?.addEventListener('click', () => {
    filterQuery = '';
    render(ctx);
  });

  // Add task buttons
  root.querySelectorAll('.add-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      openAddModal(ctx, status);
    });
  });

  // Task action buttons
  root.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const task = allTasks.find((t) => t.id === taskId);
      if (task) openEditModal(ctx, task);
    });
  });

  root.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      try {
        await ctx.api.delete(`/tasks/${encodeURIComponent(taskId)}`);
        ctx.showToast('Task deleted.', 'success', 1500);
        await reloadTasks(ctx);
      } catch (err) {
        ctx.showToast(`Delete failed: ${err.message}`, 'error');
      }
    });
  });

  root.querySelectorAll('.move-left, .move-right').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.taskId;
      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;
      const colIndex = COLUMNS.findIndex((c) => c.id === task.status);
      const delta = btn.classList.contains('move-left') ? -1 : 1;
      const newIndex = colIndex + delta;
      if (newIndex < 0 || newIndex >= COLUMNS.length) return;
      const newStatus = COLUMNS[newIndex].id;
      await moveTaskTo(ctx, taskId, newStatus);
    });
  });

  // Focus on card click
  root.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // Don't focus if clicking a button
      if (e.target.closest('.task-actions')) return;
      const taskId = card.dataset.taskId;
      focusedTaskId = focusedTaskId === taskId ? null : taskId;
      render(ctx);
    });
  });

  // Click title to expand inline
  root.querySelectorAll('.task-title').forEach((titleEl) => {
    titleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = titleEl.dataset.taskId;
      const task = allTasks.find((t) => t.id === taskId);
      if (!task) return;
      openEditModal(ctx, task);
    });
  });
}

// ─── move helper ─────────────────────────────────────────────────────────────

async function moveTaskTo(ctx, taskId, newStatus) {
  try {
    await ctx.api.patch(`/tasks/${encodeURIComponent(taskId)}/status`, { status: newStatus });
    // Flash animation
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    if (card) {
      card.style.animation = 'none';
      card.offsetHeight; // reflow
      card.style.animation = 'task-move 0.3s ease-out';
    }
    await reloadTasks(ctx);
  } catch (err) {
    ctx.showToast(`Move failed: ${err.message}`, 'error');
  }
}

async function reloadTasks(ctx) {
  try {
    const data = await ctx.api.get('/tasks');
    ctx.snapshot = { ...(ctx.snapshot || {}), tasks: Array.isArray(data) ? data : [] };
    render(ctx);
  } catch {
    // ignore
  }
}

// ─── modal helpers ───────────────────────────────────────────────────────────

function openAddModal(ctx, initialStatus = 'queued') {
  const body = `
    <div class="form-row">
      <label for="task-title">Title *</label>
      <input type="text" id="task-title" maxlength="200" placeholder="What needs to be done?" required>
    </div>
    <div class="form-row">
      <label for="task-desc">Description</label>
      <textarea id="task-desc" placeholder="Markdown supported…"></textarea>
    </div>
    <div class="form-row">
      <label>Priority</label>
      <div class="priority-radio">
        <label><input type="radio" name="task-priority" value="low"> Low</label>
        <label><input type="radio" name="task-priority" value="normal" checked> Normal</label>
        <label><input type="radio" name="task-priority" value="high"> High</label>
      </div>
    </div>
    <div class="form-row">
      <label for="task-tags">Tags</label>
      <input type="text" id="task-tags" placeholder="comma-separated, e.g. bug, frontend">
    </div>
  `;
  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn primary" id="modal-create">Create</button>
  `;
  const m = openModal({ title: 'New Task', body, footer });

  footer.querySelector('#modal-cancel').addEventListener('click', m.close);
  footer.querySelector('#modal-create').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value.trim();
    if (!title) {
      ctx.showToast('Title is required.', 'error');
      return;
    }
    const description = document.getElementById('task-desc').value.trim();
    const priority = document.querySelector('input[name="task-priority"]:checked')?.value || 'normal';
    const tagsRaw = document.getElementById('task-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await ctx.api.post('/tasks', { title, description, status: initialStatus, tags, priority });
      ctx.showToast('Task created.', 'success', 1500);
      m.close();
      await reloadTasks(ctx);
    } catch (err) {
      ctx.showToast(`Create failed: ${err.message}`, 'error');
    }
  });
}

function openEditModal(ctx, task) {
  const body = `
    <div class="form-row">
      <label for="task-title">Title *</label>
      <input type="text" id="task-title" maxlength="200" value="${escapeHTML(task.title || '')}" required>
    </div>
    <div class="form-row">
      <label for="task-desc">Description</label>
      <textarea id="task-desc">${escapeHTML(task.description || '')}</textarea>
    </div>
    <div class="form-row">
      <label>Priority</label>
      <div class="priority-radio">
        <label><input type="radio" name="task-priority" value="low" ${task.priority === 'low' ? 'checked' : ''}> Low</label>
        <label><input type="radio" name="task-priority" value="normal" ${task.priority !== 'low' && task.priority !== 'high' ? 'checked' : ''}> Normal</label>
        <label><input type="radio" name="task-priority" value="high" ${task.priority === 'high' ? 'checked' : ''}> High</label>
      </div>
    </div>
    <div class="form-row">
      <label for="task-tags">Tags</label>
      <input type="text" id="task-tags" value="${escapeHTML((task.tags || []).join(', '))}" placeholder="comma-separated">
    </div>
  `;
  const footer = document.createElement('div');
  footer.innerHTML = `
    <button class="btn" id="modal-cancel">Cancel</button>
    <button class="btn primary" id="modal-save">Save</button>
  `;
  const m = openModal({ title: 'Edit Task', body, footer });

  footer.querySelector('#modal-cancel').addEventListener('click', m.close);
  footer.querySelector('#modal-save').addEventListener('click', async () => {
    const title = document.getElementById('task-title').value.trim();
    if (!title) {
      ctx.showToast('Title is required.', 'error');
      return;
    }
    const description = document.getElementById('task-desc').value.trim();
    const priority = document.querySelector('input[name="task-priority"]:checked')?.value || 'normal';
    const tagsRaw = document.getElementById('task-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await ctx.api.put(`/tasks/${encodeURIComponent(task.id)}`, { title, description, tags, priority });
      ctx.showToast('Task updated.', 'success', 1500);
      m.close();
      await reloadTasks(ctx);
    } catch (err) {
      ctx.showToast(`Update failed: ${err.message}`, 'error');
    }
  });
}

function openModal({ title, body, footer }) {
  const container = document.getElementById('modal-container');
  if (!container) return { close: () => {} };
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
  const f = modal.querySelector('.modal-footer');
  if (footer) f.appendChild(footer);
  backdrop.appendChild(modal);
  container.appendChild(backdrop);

  const close = () => {
    container.innerHTML = '';
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

// ─── keyboard shortcuts ──────────────────────────────────────────────────────

let _kbRegistered = false;
let _kbCtx = null;

function registerKeyboardShortcuts(ctx) {
  _kbCtx = ctx;
  if (_kbRegistered) return;
  _kbRegistered = true;
  document.addEventListener('keydown', (e) => {
    if (window.__bizar?.currentTab !== 'tasks') return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'n') {
      e.preventDefault();
      openAddModal(_kbCtx, 'queued');
    } else if (e.key === '1') {
      scrollToColumn('queued');
    } else if (e.key === '2') {
      scrollToColumn('doing');
    } else if (e.key === '3') {
      scrollToColumn('done');
    } else if (e.key === 'e' && focusedTaskId) {
      const task = (_kbCtx.snapshot?.tasks || []).find((t) => t.id === focusedTaskId);
      if (task) openEditModal(_kbCtx, task);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && focusedTaskId) {
      // Only fire if not in an input and a task is focused
      const task = (_kbCtx.snapshot?.tasks || []).find((t) => t.id === focusedTaskId);
      if (task) {
        e.preventDefault();
        // Trigger delete via the delete button click
        document.querySelector(`.delete-btn[data-task-id="${task.id}"]`)?.click();
      }
    }
  });
}

function scrollToColumn(colId) {
  document.querySelector(`[data-column="${colId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

