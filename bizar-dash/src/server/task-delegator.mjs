/**
 * src/server/task-delegator.mjs
 *
 * v3.5.2 — Odin task delegation.
 *
 * Accepts a single "natural language" task from the user. Splits it into
 * 1-5 subtasks via heuristic rules (an LLM call would replace this in
 * v3.3), assigns each subtask to the best-fit agent based on tags /
 * keywords / category, and dispatches them to the background agent
 * infrastructure when available.
 *
 * v3.5.1 — agents.maxParallel cap applied here. Background dispatch is
 * limited to the configured number of concurrent instances; overflow
 * subtasks are marked queued and dispatched as slots free up.
 *
 * The delegator is intentionally tolerant: a failure to enqueue a
 * background instance must NOT break the user-facing task creation.
 * Subtasks are always persisted to the regular tasks store first; the
 * background dispatch is best-effort.
 *
 * v3.5.4 (bug: dispatch stuck) — Dispatch path replaced. The previous
 * implementation shell-executed `node plugins/bizar/dist/cli.js bg enqueue`,
 * but the plugin is a Bun-native TS project with no compiled `dist/`,
 * so the exec always failed. The silent try/catch around execSync meant
 * the failure was invisible to both the user and the dashboard log.
 *
 * New path:
 *   1. Read the plugin's serve-info file (port + password + worktree).
 *   2. POST /api/session on the plugin's opencode serve child.
 *   3. POST /api/session/{id}/prompt to fire the task prompt.
 *   4. Write a state file under ~/.cache/bizar/bg/ so the dashboard's
 *      background-store can list and kill it.
 *
 * If serve-info is missing (plugin not running) we log a clear warning
 * at startup AND surface the dispatch failure in the `/submit` response,
 * so the user can re-dispatch manually with `/api/tasks/:id/start`
 * after the plugin is up.
 */

import { tasksStore } from './tasks-store.mjs';
import { agentsStore } from './agents-store.mjs';
import { notificationsStore } from './notifications-store.mjs';
import { backgroundStore } from './background-store.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

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

function genShortHex(bytes = 6) {
  return randomBytes(bytes).toString('hex');
}

/**
 * v3.5.4 — Synthesize the prompt text for a subtask. Combines the
 * subtask title and description in the same shape the plugin's own
 * `bizar_spawn_background` tool uses internally, so an opencode agent
 * receives the same brief whether it was dispatched via MCP or via
 * the dashboard's HTTP bridge.
 */
function buildPromptText(sub) {
  const parts = [];
  parts.push(`# ${sub.title || 'Subtask'}`);
  if (sub.description) parts.push(String(sub.description).trim());
  parts.push('');
  parts.push('---');
  parts.push(`Subtask ID: ${sub.id}`);
  parts.push(`Assigned agent: ${sub.assignee || 'tyr'}`);
  parts.push(`Parent task ID: ${sub.parent || '(none)'}`);
  return parts.join('\n');
}

/**
 * v3.5.4 — Write a per-instance state file under BG_DIRS so the
 * dashboard's `backgroundStore.list()` and `kill()` paths find this
 * bg instance. The shape matches what `background-state.ts` writes
 * so the existing merge + dedupe logic works without changes.
 *
 * Idempotent: writes are atomic via tmp + rename. Failures are logged
 * but do NOT throw — the opencode session is already running.
 */
function writeBgStateFile(instanceId, payload) {
  const dir = pickBgDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`[task-delegator] cannot create bg dir ${dir}: ${err.message}`);
    return null;
  }
  const file = join(dir, `${instanceId}.json`);
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    try {
      renameSync(tmp, file);
    } catch {
      writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    }
    return file;
  } catch (err) {
    console.warn(`[task-delegator] failed to write bg state file ${file}: ${err.message}`);
    return null;
  }
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
      metadata: { progress: 0, currentStep: 'Queued for delegation', progressHistory: [{ ts: new Date().toISOString(), progress: 0, step: 'Queued for delegation' }] },
    });
    broadcast({ type: 'tasks:change', task: main });

    // v3.3.0 — Drop a notification that the user submitted a task.
    try {
      notificationsStore.add({
        severity: 'info',
        source: 'odin',
        title: 'Task submitted',
        message: `Odin is splitting "${title}" into subtasks.`,
        link: null,
        meta: { taskId: main.id },
      }, { broadcast });
    } catch { /* best-effort */ }

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
      metadata: { progress: 10, currentStep: `Split into ${subtasks.length} subtask(s)`, startedAt: new Date().toISOString() },
    });
    if (moved) {
      moved.subtasks = subtasks.map((s) => s.id);
      broadcast({ type: 'tasks:change', task: moved });
    }

    // 5. Best-effort dispatch to background infrastructure. We collect
    //    per-subtask errors instead of swallowing them so the response
    //    includes `dispatchErrors[]`. The HTTP caller (and the UI toast)
    //    can then surface "X subtasks could not be dispatched" instead
    //    of a silent success.
    const dispatchResult = { dispatched: [], errors: [], warnings: [] };
    try {
      const r = await this.dispatchToBackground(moved || main, subtasks, ctx, broadcast);
      if (r && typeof r === 'object') {
        if (Array.isArray(r.dispatched)) dispatchResult.dispatched = r.dispatched;
        if (Array.isArray(r.errors)) dispatchResult.errors = r.errors;
        if (Array.isArray(r.warnings)) dispatchResult.warnings = r.warnings;
      }
    } catch (err) {
      console.error('[task-delegator] dispatch crashed:', err.message);
      dispatchResult.errors.push({ kind: 'fatal', message: err.message || String(err) });
    }

    if (dispatchResult.errors.length > 0) {
      try {
        notificationsStore.add({
          severity: 'warning',
          source: 'odin',
          title: 'Dispatch incomplete',
          message: `${dispatchResult.errors.length} subtask(s) could not be dispatched. Use POST /api/tasks/:id/start to retry.`,
          meta: { mainId: main.id, errors: dispatchResult.errors.slice(0, 5) },
        }, { broadcast });
      } catch { /* best-effort */ }
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

    return { main: moved || main, subtasks, dispatch: dispatchResult };
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
   * v3.5.4 (bug: dispatch stuck) — Best-effort dispatch to the background
   * agent infrastructure. Talks to the plugin's opencode serve child via
   * HTTP (createSession + sendPrompt) and writes a per-instance state
   * file under BG_DIRS so the dashboard's `backgroundStore.list()` and
   * `kill()` paths find the instance.
   *
   * Replaces the previous `execSync('node plugins/bizar/dist/cli.js …')`
   * path which silently failed because the plugin is a Bun-native TS
   * project with no compiled `dist/`.
   *
   * Returns a structured `{ dispatched: string[], errors: Array<…>, warnings: Array<…> }`
   * so the caller (and `/api/tasks/submit`) can surface failures to the
   * user instead of swallowing them.
   *
   * v3.5.1 — Respects agents.maxParallel: caps concurrent dispatches to
   * the configured limit; overflow subtasks are queued until a slot
   * frees up.
   *
   * @returns {Promise<{ dispatched: string[], errors: Array<{ subtaskId: string, kind: string, message: string }>, warnings: string[] }>}
   */
  async dispatchToBackground(main, subtasks, ctx, broadcast) {
    const projectRoot = ctx.projectRoot || process.cwd();
    const projectId = ctx.projectId || null;
    const bgDir = pickBgDir();
    const result = { dispatched: [], errors: [], warnings: [] };

    // v3.5.1 — Read agents.maxParallel from settings (default 6).
    const SETTINGS_FILE = join(HOME, '.config', 'bizar', 'settings.json');
    let maxParallel = 6;
    try {
      if (existsSync(SETTINGS_FILE)) {
        const raw = readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(raw);
        maxParallel = settings?.agents?.maxParallel ?? 6;
      }
    } catch {
      maxParallel = 6;
    }

    // Count currently running bg instances across all candidate dirs.
    // v3.5.4 (bug #5) — `list()` is now async because it merges
    // opencode-direct sessions via fetch.
    const runningInstances = (await backgroundStore.list()).filter(
      (b) => b.status === 'running' || b.status === 'pending',
    );
    const runningCount = runningInstances.length;
    const slotsAvailable = Math.max(0, maxParallel - runningCount);

    // v3.5.4 (bug: dispatch stuck) — Resolve the opencode serve child
    // the plugin owns. If the plugin is not running we record a warning
    // and skip the actual spawn (subtasks still flip to `doing` so the
    // user can see them, but `metadata.dispatchPending = true` tells
    // them to retry via `/api/tasks/:id/start` once the plugin is up).
    let serveInfo = null;
    let serveReachable = false;
    try {
      const { readServeInfo, pingOpencodeServe } = await import('./serve-info.mjs');
      serveInfo = readServeInfo();
      if (!serveInfo) {
        result.warnings.push('serve-info not found — the bizar plugin is not running. Tasks will be marked queued; retry via POST /api/tasks/:id/start once the plugin is up.');
        console.warn('[task-delegator] serve-info missing — plugin may not be running. Dispatch will be deferred.');
      } else {
        serveReachable = await pingOpencodeServe(serveInfo);
        if (!serveReachable) {
          result.warnings.push(`opencode serve at ${serveInfo.baseUrl} is not reachable. Tasks will be marked queued; retry via POST /api/tasks/:id/start.`);
          console.warn(`[task-delegator] opencode serve not reachable at ${serveInfo.baseUrl}`);
        }
      }
    } catch (err) {
      result.warnings.push(`could not load serve-info helper: ${err.message}`);
      console.warn('[task-delegator] serve-info helper failed:', err.message);
    }

    // Split: first N get dispatched now, rest are queued.
    const toDispatch = subtasks.slice(0, slotsAvailable);
    const toQueue = subtasks.slice(slotsAvailable);

    for (const sub of toQueue) {
      const metadata = {
        ...(sub.metadata || {}),
        waitingForSlot: true,
        queuedAt: new Date().toISOString(),
        maxParallel,
      };
      await tasksStore.update(projectId, sub.id, {
        status: 'queued',
        metadata,
      });
      broadcast({
        type: 'tasks:change',
        task: { id: sub.id, status: 'queued', metadata },
      });
    }

    // v3.5.4 (bug: dispatch stuck) — Per-subtask dispatch path. We
    // collect errors instead of swallowing them. Two failure modes:
    //   - serveInfo/serveReachable missing: mark dispatchPending so
    //     the UI shows "Awaiting dispatch" and `/api/tasks/:id/start`
    //     can retry.
    //   - HTTP error: record error message so the API response carries
    //     it.
    for (const sub of toDispatch) {
      const startedAt = new Date().toISOString();
      let bgInstanceId = null;
      let sessionId = null;
      let dispatchError = null;
      let dispatchPending = false;

      if (serveInfo && serveReachable) {
        try {
          const { createOpencodeSession, sendOpencodePrompt } = await import('./serve-info.mjs');
          // 1. Create the opencode session owned by the requested agent.
          const create = await createOpencodeSession(
            serveInfo,
            { title: sub.title || 'subtask', agent: sub.assignee || 'tyr', parentID: sub.parent || undefined },
            serveInfo.worktree,
          );
          if (!create.ok) {
            dispatchError = create.error || 'createOpencodeSession failed';
          } else {
            sessionId = create.sessionId;
            // 2. Fire the prompt.
            const promptText = buildPromptText(sub);
            const send = await sendOpencodePrompt(
              serveInfo,
              {
                sessionId,
                agent: sub.assignee || 'tyr',
                text: promptText,
              },
              serveInfo.worktree,
            );
            if (!send.ok) {
              dispatchError = send.error || 'sendOpencodePrompt failed';
            } else {
              // v3.5.5 — Wrap the agent run in a tmux session so
              // operators can `tmux attach -t bizar-bg-<id>` and watch
              // the opencode process in real time. We shell out a
              // `tail -f` against the opencode log file; opencode
              // serves its session on the plugin's opencode serve
              // child, so the tail is a passive monitor rather than
              // a redundant runner. Failures are silent — the agent
              // dispatch itself succeeded; tmux is a nice-to-have.
              try {
                const logFile = join(serveInfo.worktree || process.cwd(), '.bizar', 'opencode.log');
                const tmuxRes = backgroundStore.spawnTmuxFor(
                  `bg_${sessionId.slice(0, 16)}`,
                  { command: 'tail', args: ['-n', '200', '-F', logFile] },
                  serveInfo.worktree,
                );
                if (tmuxRes.ok) {
                  // We do not fail the dispatch when tmux is missing.
                  if (tmuxRes.note) {
                    // pre-existing session, no log
                  }
                }
              } catch (err) {
                // Silent — tmux is best-effort.
                console.warn(`[task-delegator] tmux wrap failed: ${err.message}`);
              }
            }
          }
        } catch (err) {
          dispatchError = err instanceof Error ? err.message : String(err);
        }
      } else {
        // Plugin not running — leave the subtask marked queued with a
        // dispatchPending flag. The UI surfaces this and the user can
        // retry via POST /api/tasks/:id/start.
        dispatchPending = true;
      }

      // v3.5.4 (bug: dispatch stuck) — Generate a bg instance ID even on
      // failure so the dashboard can track attempts. Successful dispatches
      // get a deterministic id derived from the opencode session ID.
      bgInstanceId = sessionId
        ? `bg_${sessionId.slice(0, 16)}`
        : `bg_${genShortHex(8)}`;

      // 3. Always write the bg state file so the dashboard's background
      //    list reflects every dispatch attempt (success or failure).
      writeBgStateFile(bgInstanceId, {
        instanceId: bgInstanceId,
        sessionId: sessionId || null,
        projectId,
        worktree: serveInfo?.worktree || projectRoot || null,
        agent: sub.assignee || 'tyr',
        parentAgent: 'odin',
        status: dispatchError ? 'failed' : 'pending',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        toolCallCount: 0,
        promptPreview: (sub.title || '').slice(0, 200),
        taskId: sub.id,
        mainTaskId: main?.id || null,
        dispatchPending,
        error: dispatchError || null,
      });

      const metadata = { ...(sub.metadata || {}) };
      if (bgInstanceId) metadata.bgInstanceId = bgInstanceId;
      metadata.dispatchedAt = startedAt;
      metadata.progress = dispatchError ? 0 : 5;
      metadata.currentStep = dispatchError
        ? `Dispatch failed: ${dispatchError}`
        : (dispatchPending ? 'Awaiting dispatch (plugin offline)' : `Dispatched (${bgInstanceId})`);
      metadata.progressHistory = [
        ...(metadata.progressHistory || []),
        {
          ts: startedAt,
          progress: metadata.progress,
          step: metadata.currentStep,
          agent: sub.assignee || null,
          ...(dispatchError ? { error: dispatchError } : {}),
        },
      ];
      metadata.startedAt = metadata.startedAt || startedAt;
      if (dispatchError) metadata.dispatchError = dispatchError;
      if (dispatchPending) metadata.dispatchPending = true;

      // v3.5.4 (bug: dispatch stuck) — Mark as queued (not doing) when
      // dispatch failed or is pending, so the task doesn't sit forever
      // at 5% doing. The UI can still show "Dispatch pending" via the
      // metadata flag.
      const newStatus = dispatchError || dispatchPending ? 'queued' : 'doing';
      const updated = await tasksStore.update(projectId, sub.id, {
        status: newStatus,
        metadata,
      });
      if (updated) {
        broadcast({ type: 'tasks:change', task: updated });
        if (!dispatchError && !dispatchPending) {
          broadcast({
            type: 'task:progress',
            taskId: sub.id,
            progress: 5,
            step: metadata.currentStep,
            agent: sub.assignee || null,
          });
        }
      }

      if (dispatchError) {
        result.errors.push({ subtaskId: sub.id, kind: 'spawn_failed', message: dispatchError });
        console.error(`[task-delegator] dispatch ${sub.id} failed:`, dispatchError);
      } else if (dispatchPending) {
        // Pending is not an error — just record which subtasks are
        // waiting for the plugin to come up.
        result.warnings.push(`subtask ${sub.id} awaiting plugin (${sub.assignee || 'tyr'})`);
      } else {
        result.dispatched.push(bgInstanceId);
      }
    }

    // Note the bg dir in activity so the dashboard can link to it.
    broadcast({
      type: 'tasks:change',
      task: { id: main.id, _bgDir: bgDir },
    });

    return result;
  },

  /**
   * v3.5.4 — Dispatch a single queued task. Used by POST /api/tasks/:id/start
   * to retry dispatch after the plugin comes up. Resolves to the same
   * structured result as `dispatchToBackground`. Loads the task first so
   * the caller doesn't need to know the storage layer.
   *
   * @param {string} taskId
   * @param {object} ctx - { projectId, projectRoot, broadcast }
   * @returns {Promise<{ ok: boolean, task?: object, errors: Array<…>, warnings: Array<…> }>}
   */
  async dispatchSingleTask(taskId, ctx = {}) {
    const projectId = ctx.projectId || null;
    const broadcast = ctx.broadcast || (() => {});
    const all = await tasksStore.loadTasks(projectId, { includeArchived: false });
    const task = all.find((t) => t.id === taskId);
    if (!task) {
      return { ok: false, errors: [{ subtaskId: taskId, kind: 'not_found', message: 'task not found' }], warnings: [] };
    }
    if (task.status !== 'queued') {
      return {
        ok: false,
        task,
        errors: [{ subtaskId: taskId, kind: 'invalid_status', message: `task is '${task.status}', must be 'queued' to start` }],
        warnings: [],
      };
    }

    // The task may be a subtask (has parent) or a top-level delegated
    // task. We dispatch as a single-item subtask list so the same code
    // path handles both.
    const asSubtask = {
      id: task.id,
      title: task.title,
      description: task.description,
      assignee: task.assignee || 'tyr',
      parent: task.parent || null,
    };
    const synthMain = { id: task.id };
    const result = await this.dispatchToBackground(synthMain, [asSubtask], ctx, broadcast);
    const reloaded = await tasksStore.loadTasks(projectId, { includeArchived: false });
    const refreshed = reloaded.find((t) => t.id === taskId) || task;
    return {
      ok: result.errors.length === 0,
      task: refreshed,
      dispatched: result.dispatched,
      errors: result.errors,
      warnings: result.warnings,
    };
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
