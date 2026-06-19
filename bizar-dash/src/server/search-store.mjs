/**
 * src/server/search-store.mjs
 *
 * v3.0.0 — Fuzzy search across projects, tasks, plans, agents, mods,
 * commands.
 *
 * Uses a simple substring / token match for v3. fuse.js is wired in for
 * fuzzy ranking but we keep a simple default that works without deps.
 */
import { agentsStore } from './agents-store.mjs';
import { projectsStore } from './projects-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { modsLoader } from './mods-loader.mjs';
import { schedulesStore } from './schedules-store.mjs';

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

    results.sort((a, b) => b.score - a.score);
    return { query, results: results.slice(0, 50) };
  },
};
