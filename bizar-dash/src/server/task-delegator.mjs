/**
 * src/server/task-delegator.mjs
 *
 * v3.2.0 — Odin task delegation.
 *
 * Accepts a single "natural language" task from the user. Splits it into
 * 1-5 subtasks via heuristic rules (an LLM call would replace this in
 * v3.3), assigns each subtask to the best-fit agent based on tags /
 * keywords / category, and dispatches them to the background agent
 * infrastructure when available.
 *
 * The delegator is intentionally tolerant: a failure to enqueue a
 * background instance must NOT break the user-facing task creation.
 * Subtasks are always persisted to the regular tasks store first; the
 * background dispatch is best-effort.
 */

import { tasksStore } from './tasks-store.mjs';
import { agentsStore } from './agents-store.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const HOME = homedir();

// Background state directory — defaults to what the opencode plugin
// actually uses (see plugins/bizar/src/background-state.ts: stateDir
// defaults to `~/.cache/bizar` so instances live at
// `~/.cache/bizar/bg/<instanceId>.json`).
const BG_DIRS = [
  join(HOME, '.cache', 'bizar', 'bg'),
  join(HOME, '.config', 'opencode', 'bg'),
  join(HOME, '.bizar', 'bg'),
];

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Read-only enumeration of bg state files for diagnostics / debug.
 * Used by `dispatchToBackground` to pick a target state dir.
 */
function pickBgDir() {
  for (const dir of BG_DIRS) {
    if (existsSync(dir)) return dir;
  }
  return BG_DIRS[0];
}

export const taskDelegator = {
  /**
   * Submit a task to Odin. Odin analyzes, splits, and dispatches.
   *
   * @param {object} taskInput - { title, description, priority?, tags? }
   * @param {object} ctx - { projectRoot, projectId, broadcast }
   * @returns {Promise<{ main, subtasks }>}
   */
  async submit(taskInput, ctx = {}) {
    const broadcast = ctx.broadcast || (() => {});
    const projectId = ctx.projectId || null;

    const title = (taskInput.title || '').trim();
    if (!title) {
      throw new Error('title is required');
    }

    // 1. Create the main task. Persisted via the regular store so it
    //    shows up in /api/tasks and the UI immediately.
    const main = await tasksStore.create(projectId, {
      title,
      description: taskInput.description || '',
      status: 'queued',
      priority: ['low', 'normal', 'high'].includes(taskInput.priority)
        ? taskInput.priority
        : 'normal',
      tags: Array.isArray(taskInput.tags) ? taskInput.tags : [],
      assignee: 'odin',
      parent: null,
    });
    broadcast({ type: 'tasks:change', task: main });

    // 2. Odin analyzes and splits.
    const subtasks = await this.splitTask(main, ctx);

    // 3. For each subtask, match an agent and persist the assignment.
    const agents = agentsStore.list();
    for (const sub of subtasks) {
      const agent = this.matchAgent(sub, agents);
      sub.assignee = agent.name;
      const persisted = await tasksStore.update(projectId, sub.id, {
        assignee: agent.name,
      });
      if (persisted) {
        broadcast({ type: 'tasks:change', task: persisted });
      }
    }

    // 4. Flip the main task to `doing` and record its subtasks.
    main.subtasks = subtasks.map((s) => s.id);
    const moved = await tasksStore.update(projectId, main.id, {
      status: 'doing',
    });
    if (moved) {
      moved.subtasks = subtasks.map((s) => s.id);
      broadcast({ type: 'tasks:change', task: moved });
    }

    // 5. Best-effort dispatch to background infrastructure. Failures
    //    here are logged but never fail the request — the tasks are
    //    already saved and the user can re-dispatch manually.
    try {
      await this.dispatchToBackground(moved || main, subtasks, ctx, broadcast);
    } catch (err) {
      console.error('[task-delegator] dispatch failed:', err.message);
    }

    // 6. Audit activity.
    try {
      ctx.state?.appendActivity?.({
        kind: 'task.delegated',
        mainId: main.id,
        subtasks: subtasks.map((s) => s.id),
        title: main.title,
      });
      // Also write to the dashboard activity log so the Activity tab
      // sees the delegation event.
      try {
        const { activityLog } = await import('./activity-log.mjs');
        activityLog.append({
          kind: 'task.delegated',
          nodeId: `task:${main.id}`,
          mainId: main.id,
          subtaskIds: subtasks.map((s) => s.id),
          title: main.title,
        });
      } catch { /* best-effort */ }
    } catch {
      /* best-effort */
    }

    return { main: moved || main, subtasks };
  },

  /**
   * Split a task into 2-5 subtasks using heuristic rules.
   * The split is intentionally conservative — when no signal matches
   * the rule set we fall back to a single "do the work" subtask plus
   * an optional "verify" subtask if the title hints at testing.
   *
   * @param {Task} main
   * @param {object} ctx - { projectId, broadcast }
   * @returns {Promise<Task[]>}
   */
  async splitTask(main, ctx = {}) {
    const projectId = ctx.projectId || null;
    const broadcast = ctx.broadcast || (() => {});
    const title = (main.title || '').toLowerCase();
    const desc = (main.description || '').toLowerCase();
    const text = `${title} ${desc}`;

    const wantImpl = /\b(implement|build|create|add|write|develop|craft|code|ship)\b/.test(text);
    const wantTest = /\b(test|verify|validate|check|qa|cover|spec)\b/.test(text);
    const wantDocs = /\b(document|readme|docs|comment|explain|write[- ]up)\b/.test(text);
    const wantDesign = /\b(design|ui|ux|style|styling|theme|visual|layout|mockup)\b/.test(text);
    const wantResearch = /\b(research|find|explore|investigate|compare|survey|analyze)\b/.test(text);
    const wantRefactor = /\b(refactor|rework|restructure|clean[- ]up|reorganize)\b/.test(text);

    const fragments = [];

    if (wantImpl || wantRefactor) {
      fragments.push({
        key: 'impl',
        title: `Implement: ${main.title}`,
        description: main.description
          ? `Implement the core change. Source description:\n\n${main.description}`
          : `Implement: ${main.title}`,
        priority: main.priority || 'normal',
        assigneeHint: wantRefactor ? 'tyr' : 'tyr',
        tags: [...(main.tags || []), 'implementation'],
      });
    }
    if (wantTest) {
      fragments.push({
        key: 'test',
        title: `Test: ${main.title}`,
        description: `Write tests and verify: ${main.title}`,
        priority: 'normal',
        assigneeHint: 'thor',
        tags: [...(main.tags || []), 'testing'],
      });
    }
    if (wantDocs) {
      fragments.push({
        key: 'docs',
        title: `Document: ${main.title}`,
        description: `Write documentation for: ${main.title}`,
        priority: 'low',
        assigneeHint: 'heimdall',
        tags: [...(main.tags || []), 'docs'],
      });
    }
    if (wantDesign) {
      fragments.push({
        key: 'design',
        title: `Design: ${main.title}`,
        description: `Design work for: ${main.title}`,
        priority: main.priority || 'normal',
        assigneeHint: 'baldr',
        tags: [...(main.tags || []), 'design'],
      });
    }
    if (wantResearch) {
      fragments.push({
        key: 'research',
        title: `Research: ${main.title}`,
        description: `Research and summarize: ${main.title}`,
        priority: 'normal',
        assigneeHint: 'mimir',
        tags: [...(main.tags || []), 'research'],
      });
    }

    // Fallback when nothing matched: a single "do it" subtask.
    if (fragments.length === 0) {
      fragments.push({
        key: 'work',
        title: `Work on: ${main.title}`,
        description: main.description || main.title,
        priority: main.priority || 'normal',
        assigneeHint: 'tyr',
        tags: [...(main.tags || [])],
      });
    }

    // Hard cap at 5 subtasks — keep the board tidy.
    const limited = fragments.slice(0, 5);

    const subtasks = [];
    for (const f of limited) {
      const t = await tasksStore.create(projectId, {
        title: f.title,
        description: f.description,
        status: 'queued',
        priority: f.priority,
        tags: f.tags,
        assignee: f.assigneeHint,
        parent: main.id,
      });
      broadcast({ type: 'tasks:change', task: t });
      subtasks.push(t);
    }
    return subtasks;
  },

  /**
   * Match a subtask to the best agent. Returns a fallback agent if
   * nothing matches (never null).
   */
  matchAgent(task, agents) {
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const tags = (task.tags || []).map((t) => t.toLowerCase());

    // Priority rules. First match wins. Order matters.
    const rules = [
      { match: ['git', 'commit', 'pr', 'merge', 'branch', 'push'], agent: 'hermod' },
      { match: ['design', 'ui', 'ux', 'style', 'theme', 'visual', 'layout'], agent: 'baldr' },
      { match: ['research', 'find', 'explore', 'search', 'investigate'], agent: 'mimir' },
      { match: ['clarify', 'question', 'ask'], agent: 'vor' },
      { match: ['explain', 'how', 'why'], agent: 'frigg' },
      { match: ['test', 'verify', 'validate', 'check', 'qa'], agent: 'thor' },
      { match: ['document', 'doc', 'readme'], agent: 'heimdall' },
      { match: ['refactor', 'rework', 'restructure', 'cleanup'], agent: 'tyr' },
      { match: ['implement', 'build', 'create', 'add', 'code', 'fix'], agent: 'tyr' },
      { match: ['security', 'audit', 'review'], agent: 'forseti' },
      { match: ['simple', 'quick', 'small', 'easy'], agent: 'heimdall' },
      { match: ['complex', 'architect'], agent: 'tyr' },
    ];

    for (const rule of rules) {
      const hit =
        rule.match.some((m) => text.includes(m)) ||
        rule.match.some((m) => tags.includes(m));
      if (hit) {
        const agent = agents.find((a) => a.name === rule.agent);
        if (agent) return agent;
      }
    }

    // Honor any explicit assignee stored on the task.
    if (task.assignee) {
      const found = agents.find((a) => a.name === task.assignee);
      if (found) return found;
    }

    return agents.find((a) => a.name === 'tyr') || agents[0] || { name: 'tyr' };
  },

  /**
   * Best-effort dispatch to the background agent infrastructure.
   * Reads the plugin's bg state dir for visibility and tries to create
   * a new bg instance via the local CLI. Never throws.
   */
  async dispatchToBackground(main, subtasks, ctx, broadcast) {
    const projectRoot = ctx.projectRoot || process.cwd();
    const projectId = ctx.projectId || null;
    const bgDir = pickBgDir();

    // Try to import the plugin's CLI dynamically. If absent, just
    // mark subtasks as doing and rely on agent heartbeats.
    let cliAvailable = false;
    try {
      const { existsSync } = await import('node:fs');
      cliAvailable = existsSync(join(projectRoot, 'plugins', 'bizar', 'dist', 'cli.js'));
    } catch {
      cliAvailable = false;
    }

    for (const sub of subtasks) {
      try {
        let bgId = null;
        if (cliAvailable) {
          const cmd = `node "${join(projectRoot, 'plugins', 'bizar', 'dist', 'cli.js')}" bg enqueue --agent ${sub.assignee || 'tyr'} --task "${String(sub.title).replace(/"/g, '\\"')}" --description "${String(sub.description || '').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
          const out = execSync(cmd, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
          try {
            const parsed = JSON.parse(out);
            bgId = parsed.id || null;
          } catch {
            bgId = null;
          }
        }

        const metadata = { ...(sub.metadata || {}) };
        if (bgId) metadata.bgInstanceId = bgId;
        metadata.dispatchedAt = new Date().toISOString();

        const updated = await tasksStore.update(projectId, sub.id, {
          status: 'doing',
          metadata,
        });
        if (updated) {
          broadcast({ type: 'tasks:change', task: updated });
        }
      } catch (err) {
        // Don't crash the loop on a single failure.
        console.error(`[task-delegator] dispatch ${sub.id} failed:`, err.message);
      }
    }

    // Note the bg dir in activity so the dashboard can link to it.
    broadcast({
      type: 'tasks:change',
      task: { id: main.id, _bgDir: bgDir },
    });
  },

  /** For tests / introspection. */
  _BG_DIRS: BG_DIRS,
};

// ── Public helpers for routes that need to walk bg state ─────────────

/**
 * Read a bg instance file from any of the candidate bg dirs. Returns
 * null if not found.
 */
export function readBgInstance(instanceId) {
  for (const dir of BG_DIRS) {
    const file = join(dir, `${instanceId}.json`);
    if (existsSync(file)) {
      try {
        const raw = readFileSync(file, 'utf8');
        return { ...JSON.parse(raw), _bgDir: dir };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * List all bg instances across the candidate dirs.
 */
export function listBgInstances() {
  const out = [];
  for (const dir of BG_DIRS) {
    if (!existsSync(dir)) continue;
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const full = join(dir, f);
        const st = statSync(full);
        const data = JSON.parse(readFileSync(full, 'utf8'));
        out.push({ ...data, _bgDir: dir, _mtime: st.mtimeMs });
      } catch {
        /* skip corrupt */
      }
    }
  }
  out.sort((a, b) => (b.startedAt || b._mtime || 0) - (a.startedAt || a._mtime || 0));
  return out;
}

export { pickBgDir, BG_DIRS };