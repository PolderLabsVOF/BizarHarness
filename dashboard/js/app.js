// dashboard/js/app.js — main shell, tab routing, view loader.
import { Api } from './api.js';
import { Ws } from './ws.js';
import { showToast, escapeHTML } from './utils.js';
import * as Overview from './views/overview.js';
import * as Chat from './views/chat.js';
import * as Agents from './views/agents.js';
import * as Plans from './views/plans.js';
import * as Projects from './views/projects.js';
import * as Config from './views/config.js';
import * as Settings from './views/settings.js';
import * as Tasks from './views/tasks.js';

const api = new Api();
const ws = new Ws();
let currentTab = 'overview';
let snapshot = null;
let currentSettings = { theme: 'dark' };

// ─── Theme ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

const VIEWS = {
  overview: { root: () => Overview, name: 'Overview' },
  chat:     { root: () => Chat,     name: 'Chat' },
  agents:   { root: () => Agents,   name: 'Agents' },
  plans:    { root: () => Plans,    name: 'Plans' },
  projects: { root: () => Projects, name: 'Projects' },
  tasks:    { root: () => Tasks,    name: 'Tasks' },
  config:   { root: () => Config,   name: 'Config' },
  settings: { root: () => Settings, name: 'Settings' },
};

// ─── Boot ───────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupKeyboardShortcuts();
  setupWS();
  // Apply saved theme immediately (no flash)
  try {
    const s = await api.get('/settings');
    currentSettings = s.data || { theme: 'dark' };
    applyTheme(currentSettings.theme);
  } catch {
    applyTheme('dark');
  }
  // Follow system preference changes when in system mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentSettings.theme === 'system') applyTheme('system');
  });
  // Initial load
  activateTab(currentTab, /*force*/ true);
});

// ─── Tabs ───────────────────────────────────────────────────────────────

function setupTabs() {
  const tabBar = document.getElementById('tabs');
  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (tab in VIEWS) activateTab(tab);
  });
}

function activateTab(tab, force = false) {
  if (!force && tab === currentTab) return;
  // Hide all
  for (const id of Object.keys(VIEWS)) {
    const el = document.getElementById(`view-${id}`);
    if (el) el.hidden = true;
  }
  // Show selected
  const view = document.getElementById(`view-${tab}`);
  if (view) {
    view.hidden = false;
    view.innerHTML = ''; // clear stale render
  }
  // Update tab styles
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  currentTab = tab;
  // Render
  try {
    const view = VIEWS[tab].root();
    if (typeof view.render === 'function') {
      view.render({ root: view, api, ws, snapshot, setSnapshot, showToast, escapeHTML, activateTab });
    }
  } catch (err) {
    console.error(`View render failed (${tab}):`, err);
    if (view) view.innerHTML = `<div class="empty">Error rendering ${escapeHTML(VIEWS[tab].name)}: ${escapeHTML(err.message)}</div>`;
  }
}

function setupKeyboardShortcuts() {
  const map = { '1': 'overview', '2': 'chat', '3': 'agents', '4': 'plans',
                '5': 'projects', '6': 'tasks', '7': 'config', '8': 'settings' };
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in an input/textarea
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (map[e.key]) {
      e.preventDefault();
      activateTab(map[e.key]);
    }
  });
}

// ─── WebSocket ──────────────────────────────────────────────────────────

function setupWS() {
  ws.onStatus((status) => {
    const ind = document.getElementById('ws-indicator');
    const txt = document.getElementById('ws-text');
    if (ind) ind.className = `indicator ${status}`;
    if (txt) txt.textContent = status;
  });

  ws.on((msg) => {
    if (msg.type === 'snapshot' && msg.data) {
      setSnapshot(msg.data);
      // Re-render the current tab with new data
      try {
        const view = VIEWS[currentTab].root();
        if (typeof view.render === 'function') {
          view.render({ root: view, api, ws, snapshot, setSnapshot, showToast, escapeHTML, activateTab });
        }
      } catch (err) {
        console.error('Snapshot re-render failed:', err);
      }
    } else if (msg.type === 'change') {
      // A watched file changed — show toast + reload affected data
      const path = msg.path || '';
      const file = path.split('/').pop() || path;
      showToast(`File changed: ${file}`, 'info', 2500);
      // Trigger refresh — easiest path: re-fetch overview + rerender current tab
      refreshSnapshot();
    } else if (msg.type === 'tasks:change' || msg.type === 'tasks:delete') {
      // Reload tasks data and re-render current tab if it's the Tasks view
      if (currentTab === 'tasks') {
        reloadTasksForTab();
      }
    }
  });

  // Periodic refresh ping every 30s as a fallback (in case WS dies silently)
  setInterval(() => {
    if (ws._status === 'connected') ws.send({ type: 'ping' });
  }, 30000);
}

async function reloadTasksForTab() {
  try {
    const tasks = await api.get('/tasks');
    snapshot = { ...(snapshot || {}), tasks: Array.isArray(tasks) ? tasks : [] };
    const view = VIEWS[currentTab].root();
    if (typeof view.render === 'function') {
      view.render({ root: view, api, ws, snapshot, setSnapshot, showToast, escapeHTML, activateTab });
    }
  } catch {
    /* ignore */
  }
}

async function refreshSnapshot() {
  try {
    const [overview, agents, plans, projects, config, settings, tasks] = await Promise.all([
      api.get('/overview'),
      api.get('/agents'),
      api.get('/plans'),
      api.get('/projects'),
      api.get('/config'),
      api.get('/settings'),
      api.get('/tasks'),
    ]);
    setSnapshot({ overview, agents: agents.agents, plans: plans.plans, projects: projects.projects, config, settings, tasks });
  } catch (err) {
    console.error('refreshSnapshot failed:', err);
  }
}

function setSnapshot(data) {
  snapshot = { ...(snapshot || {}), ...data };
  // Re-render the current tab so views pick up new data
  try {
    const view = VIEWS[currentTab].root();
    if (typeof view.render === 'function') {
      view.render({ root: view, api, ws, snapshot, setSnapshot, showToast, escapeHTML, activateTab });
    }
  } catch (err) {
    console.error('setSnapshot re-render failed:', err);
  }
}

// Expose a small helper for views to trigger refresh + re-render
window.__bizar = {
  api,
  ws,
  activateTab,
  showToast,
  refreshSnapshot,
  escapeHTML,
  applyTheme,
  get snapshot() { return snapshot; },
  set snapshot(v) { snapshot = v; },
  get settings() { return currentSettings; },
  set settings(v) { currentSettings = v; },
  get currentTab() { return currentTab; },
};
