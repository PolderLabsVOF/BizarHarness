/**
 * src/server/search-store.mjs
 *
 * v3.0.0 — Fuzzy search across projects, tasks, plans, agents, mods,
 * commands.
 *
 * v3.0.4 — Added `settings` scope. Reads ~/.config/bizar/settings.json
 * and surfaces each leaf as a searchable entry. Setting descriptions
 * come from SETTINGS_DESCRIPTIONS so users can find them by typing
 * "theme", "accent", "layout", etc.
 *
 * Uses a simple substring / token match for v3. fuse.js is wired in for
 * fuzzy ranking but we keep a simple default that works without deps.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { agentsStore } from './agents-store.mjs';
import { projectsStore } from './projects-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { modsLoader } from './mods-loader.mjs';
import { schedulesStore } from './schedules-store.mjs';

const HOME = homedir();
const SETTINGS_FILE = join(HOME, '.config', 'bizar', 'settings.json');

/**
 * v3.0.4 — Human-friendly descriptions for each known setting key.
 * The `path` in the result is what we attach to the search-result item
 * so the frontend can scroll-and-flash the right row.
 */
const SETTINGS_DESCRIPTIONS = {
  'theme.mode': 'Dark or light theme (dark, light, system)',
  'theme.accent': 'Accent color for highlights',
  'theme.success': 'Color used for success indicators',
  'theme.warning': 'Color used for warning indicators',
  'theme.error': 'Color used for error indicators',
  'theme.info': 'Color used for info indicators',
  'theme.fontFamily': 'Font family (Inter, system, mono)',
  'theme.fontSize': 'Base font size in pixels',
  'theme.compactMode': 'Denser UI with smaller spacing',
  'theme.animations': 'Enable UI animations and transitions',
  'ui.layout': 'Layout style (topnav, sidebar, both)',
  'ui.showHeader': 'Show the top header bar',
  'ui.showStatusBar': 'Show the status bar at the bottom',
  'ui.defaultTab': 'Tab to open on launch',
  'defaultAgent': 'Default agent used in chat and tasks',
  'defaultModel': 'Default model override (empty = provider default)',
  'notifications.onAgentComplete': 'Toast when an agent invocation completes',
  'notifications.onPlanApproval': 'Toast when a plan needs approval',
  'dashboard.autoLaunchWeb': 'Auto-launch web UI when starting TUI',
  'service.enabled': 'Enable background service daemon',
  'service.autostart': 'Start the service daemon at login',
};

function flattenSettings(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenSettings(v, path, out);
    } else {
      out.push({ id: path, value: v });
    }
  }
  return out;
}

function readSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return null;
    const raw = readFileSync(SETTINGS_FILE, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function scoreItem(item, fields, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  let best = 0;
  for (const f of fields) {
    const v = item[f];
    if (typeof v !== 'string') continue;
    const idx = v.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    // earlier matches score higher
    const s = 100 - Math.min(idx, 99);
    if (s > best) best = s;
  }
  return best;
}

function findPlans(planDirs) {
  // Quick local scan — the dashboard state already lists plans, but we
  // re-discover from the active project's plans/ dir for a self-contained
  // search.
  const out = [];
  // We don't have a project plan dir in v3 search — leave it empty.
  return out;
}

export const searchStore = {
  search(query, { activeProjectId, scope = 'all' } = {}) {
    const q = (query || '').trim();
    if (!q) return { query, results: [] };
    const results = [];

    if (scope === 'all' || scope === 'projects') {
      const reg = projectsStore.list();
      for (const p of reg.projects) {
        const s = scoreItem(p, ['name', 'path', 'summary'], q);
        if (s > 0) results.push({ type: 'project', score: s, item: p });
      }
    }

    if (scope === 'all' || scope === 'agents') {
      for (const a of agentsStore.list()) {
        const s = scoreItem(a, ['name', 'description', 'model', 'mode'], q);
        if (s > 0) results.push({ type: 'agent', score: s, item: a });
      }
    }

    if (scope === 'all' || scope === 'tasks') {
      const tasks = activeProjectId
        ? tasksStore.loadTasks(activeProjectId)
        : [];
      for (const t of tasks) {
        const tags = (t.tags || []).join(' ');
        const s = scoreItem(
          { title: t.title || '', description: t.description || '', tags },
          ['title', 'description', 'tags'],
          q,
        );
        if (s > 0) results.push({ type: 'task', score: s, item: t });
      }
    }

    if (scope === 'all' || scope === 'mods') {
      for (const m of modsLoader.list()) {
        const s = scoreItem(
          { name: m.name || '', description: m.description || '', author: m.author || '' },
          ['name', 'description', 'author'],
          q,
        );
        if (s > 0) results.push({ type: 'mod', score: s, item: m });
      }
    }

    if (scope === 'all' || scope === 'schedules') {
      const list = activeProjectId
        ? schedulesStore.list(activeProjectId)
        : [];
      for (const sc of list) {
        const s = scoreItem(sc, ['name', 'schedule'], q);
        if (s > 0) results.push({ type: 'schedule', score: s, item: sc });
      }
    }

    if (scope === 'all' || scope === 'commands') {
      // Built-in slash commands + a placeholder for the user's
      // commands-bizar folder.
      const builtin = [
        { name: 'plan', description: 'Manage visual plans' },
        { name: 'audit', description: 'Run security audit' },
        { name: 'init', description: 'Initialize .bizar/ in this project' },
        { name: 'update', description: 'Update bizar + plugin' },
        { name: 'export', description: 'Export to another harness' },
        { name: 'service', description: 'Manage the service daemon' },
        { name: 'explain', description: 'Read-only code Q&A' },
        { name: 'pr-review', description: 'PR review with @mimir + @forseti' },
      ];
      for (const c of builtin) {
        const s = scoreItem(c, ['name', 'description'], q);
        if (s > 0) results.push({ type: 'command', score: s, item: c });
      }
    }

    if (scope === 'all' || scope === 'settings') {
      // v3.0.4 — Surface each setting as a result. Score against the
      // full dot-path, the human description, and the current value
      // (stringified) so users can find e.g. "dark" or "Inter" too.
      const settings = readSettings();
      if (settings) {
        const flat = flattenSettings(settings);
        for (const s of flat) {
          const desc = SETTINGS_DESCRIPTIONS[s.id] || '';
          const valStr = s.value === null || s.value === undefined
            ? ''
            : typeof s.value === 'string'
              ? s.value
              : JSON.stringify(s.value);
          // Score against id (path) first, then description, then value.
          let best = 0;
          best = Math.max(best, scoreItem({ id: s.id }, ['id'], q));
          if (desc) best = Math.max(best, scoreItem({ desc }, ['desc'], q));
          if (valStr) best = Math.max(best, scoreItem({ val: valStr }, ['val'], q));
          if (best > 0) {
            results.push({
              type: 'setting',
              score: best,
              item: {
                id: s.id,
                path: s.id,
                label: s.id,
                desc,
                value: s.value,
              },
            });
          }
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return { query, results: results.slice(0, 50) };
  },
};
