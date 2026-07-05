/**
 * src/server/schedules-runner.mjs
 *
 * v3.9.0 — Executes due schedules.
 *
 * Called by the service daemon (cli/service.mjs) on a tick. For each due
 * schedule, this module runs the action and records the result via
 * schedulesStore.recordRun().
 *
 * Action types:
 *   - command  → spawn a child process
 *   - agent    → submit via taskDelegator (Odin split-and-dispatch).
 *               Honors `budgetCheck.skipIfBudgetLow` to skip when too
 *               many bg tasks are already running.
 *   - webhook  → POST JSON to the URL
 *
 * Errors are caught and recorded; the loop never throws.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isIP } from 'node:net';
import { projectsStore } from './projects-store.mjs';
import { schedulesStore } from './schedules-store.mjs';
import { Cron } from 'croner';

const HOME = homedir();
const LOG_DIR = join(HOME, '.config', 'bizar');
const LOG_FILE = join(LOG_DIR, 'service.log');
const ALLOW_PRIVATE_WEBHOOKS = process.env.BIZAR_DASHBOARD_ALLOW_PRIVATE_WEBHOOKS === '1';
const SHELL_META = /[;&|`$<>\n\r]/;

// ── Internal schedules ─────────────────────────────────────────────────────
//
// v4.8.0 — Builtin schedules registered at module load. These are NOT
// persisted in the schedules-store; they live in-memory here and are
// checked alongside the project schedules during tick(). When a builtin
// schedule fires, the runner dispatches directly to the handler without
// going through the task delegator or action runner.

/** @type {Array<{ id: string, name: string, schedule: string, type: string, timezone: string, enabled: boolean, builtin: boolean, handler?: Function, lastRun: string|null, nextRun: string|null }>} */
const internalSchedules = [];

/**
 * Register an internal schedule that is evaluated during tick().
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {string} spec.cron      — cron expression
 * @param {string} [spec.timezone='UTC']
 * @param {Function} [spec.handler] — optional direct-call handler for builtin schedules
 */
export function registerInternalSchedule(spec) {
  const tz = spec.timezone || 'UTC';
  let nextRun = null;
  if (spec.cron) {
    try {
      const job = new Cron(spec.cron, { timezone: tz });
      const n = job.nextRun();
      nextRun = n ? n.toISOString() : null;
    } catch { /* invalid cron */ }
  }
  // Remove existing entry with same id (for hot-reload)
  const existing = internalSchedules.findIndex((s) => s.id === spec.id);
  const entry = {
    id: spec.id,
    name: spec.name || spec.id,
    schedule: spec.cron || '',
    type: 'cron',
    timezone: tz,
    enabled: true,
    builtin: true,
    handler: spec.handler || null,
    lastRun: null,
    nextRun,
  };
  if (existing >= 0) {
    internalSchedules[existing] = { ...internalSchedules[existing], ...entry };
  } else {
    internalSchedules.push(entry);
  }
}

/**
 * Recompute nextRun for all internal schedules (called on system clock
 * changes or after midnight).
 */
export function recomputeInternalSchedules() {
  for (const s of internalSchedules) {
    if (s.type === 'cron' && s.schedule) {
      try {
        const job = new Cron(s.schedule, { timezone: s.timezone || 'UTC' });
        const n = job.nextRun();
        s.nextRun = n ? n.toISOString() : null;
      } catch {
        s.nextRun = null;
      }
    }
  }
}

// v4.8.0 — Auto-register the weekly digest cron at module load.
registerInternalSchedule({
  id: 'bizar-internal-weekly-digest',
  name: 'Weekly digest',
  cron: '0 0 * * 0',
  timezone: 'UTC',
  handler: async () => {
    logLine('[digest] Weekly digest cron fired — generating…');
    try {
      const { generateAndSave } = await import('./digest-store.mjs');
      const projectRoot = process.env.BIZAR_PROJECT_ROOT || process.cwd();
      const result = await generateAndSave({ projectRoot });
      logLine(`[digest] Weekly digest generated: ${result.weekStart} (${result.saveResult.paths.length} file(s))`);
      return { ok: true, result };
    } catch (err) {
      logLine(`[digest] Weekly digest generation failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  },
});

function logLine(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.warn('swallowed in schedule log append:', err.message);
  }
}

function parseCommandTarget(action) {
  if (action?.command && Array.isArray(action?.args)) {
    return {
      command: String(action.command).trim(),
      args: action.args.map((arg) => String(arg)),
    };
  }
  const target = String(action?.target || '').trim();
  if (!target) return { error: 'empty command target' };
  if (SHELL_META.test(target)) {
    return { error: 'shell metacharacters are not allowed in schedule command targets' };
  }
  const parts = target.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { error: 'empty command target' };
  return { command: parts[0], args: parts.slice(1) };
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1') return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    if (host.startsWith('127.')) return true;
    if (host.startsWith('10.')) return true;
    if (host.startsWith('192.168.')) return true;
    if (host.startsWith('169.254.')) return true;
    const octets = host.split('.').map((part) => Number(part));
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    return false;
  }
  if (ipVersion === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  }
  return host.endsWith('.local');
}

function validateWebhookTarget(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'webhook URL must use http or https' };
    }
    if (url.username || url.password) {
      return { error: 'webhook URL must not embed credentials' };
    }
    if (!ALLOW_PRIVATE_WEBHOOKS && isPrivateHostname(url.hostname)) {
      return { error: 'private, loopback, and .local webhook targets are blocked by default' };
    }
    return { url };
  } catch {
    return { error: 'invalid webhook URL' };
  }
}

async function runAction(action, ctx = {}) {
  if (!action || typeof action !== 'object') {
    throw new Error('invalid action');
  }
  if (action.type === 'command') {
    return runCommand(action);
  }
  if (action.type === 'webhook') {
    return runWebhook(action);
  }
  if (action.type === 'agent') {
    return runAgentAction(action, ctx);
  }
  if (action.type === 'eval-run') {
    return runEvalAction(action, ctx);
  }
  throw new Error(`unknown action type: ${action.type}`);
}

/**
 * Dispatch an `agent` schedule action via the dashboard's task delegator.
 * Mirrors the contract used by /api/tasks/submit: Odin analyzes the prompt,
 * splits into subtasks, and dispatches each to a matched agent.
 *
 * The delegator's `submit()` returns `{ main, subtasks, dispatch }`. We
 * treat the call as successful when `main` was persisted AND Odin
 * produced at least one subtask. Subtask dispatch errors are surfaced as
 * the `error` field of the returned shape so the schedule's `lastError`
 * reflects the dispatch outcome, not just "the task was created".
 *
 * Lazy import keeps this module loadable when the task delegator is not
 * yet initialised (e.g. during unit tests).
 *
 * @param {object} action
 * @param {object} [ctx]  Optional ctx (projectId, broadcast). Passed through.
 * @returns {Promise<{ ok: boolean, taskId?: string, subtaskCount?: number, error?: string }>}
 */
async function runAgentAction(action, ctx = {}) {
  const title =
    action.title ||
    action.name ||
    (typeof action.target === 'string' && action.target.trim()) ||
    'Scheduled task';
  const prompt =
    action.prompt ||
    (action.body && typeof action.body === 'object' && action.body.prompt) ||
    (typeof action.target === 'string' ? action.target.trim() : '') ||
    'Run scheduled task.';
  const projectId = ctx.projectId || null;
  try {
    const { taskDelegator } = await import('./task-delegator.mjs');
    const result = await taskDelegator.submit(
      {
        title,
        description: prompt,
        tags: ['scheduled'],
        priority: 'normal',
      },
      {
        projectId,
        broadcast: ctx.broadcast || (() => {}),
      },
    );
    const mainOk = !!(result && result.main && result.main.id);
    const subtaskCount = (result && Array.isArray(result.subtasks)) ? result.subtasks.length : 0;
    const dispatchErrors = result && result.dispatch && Array.isArray(result.dispatch.errors)
      ? result.dispatch.errors
      : [];
    const dispatchErrMsg = dispatchErrors.length > 0
      ? dispatchErrors.map((e) => e && e.message).filter(Boolean).join('; ') || 'dispatch error'
      : null;
    if (!mainOk) {
      return { ok: false, error: 'task delegator did not persist a main task' };
    }
    if (subtaskCount === 0) {
      return { ok: false, taskId: result.main.id, error: 'no subtasks produced' };
    }
    return {
      ok: dispatchErrors.length === 0,
      taskId: result.main.id,
      subtaskCount,
      error: dispatchErrMsg || undefined,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Budget pre-flight: count in-flight bg tasks (running + pending) and
 * skip the schedule if the count meets or exceeds `maxConcurrent`.
 * Returns `{ skip: true, reason }` to skip, or `{ skip: false }` to
 * continue with the run.
 *
 * Lazy-imports backgroundStore so this module can be loaded even when
 * the bg subsystem hasn't booted yet.
 *
 * @param {{ skipIfBudgetLow?: boolean, maxConcurrent?: number }|undefined} budgetCheck
 * @returns {Promise<{ skip: boolean, reason?: string, running?: number, cap?: number }>}
 */
async function checkBudget(budgetCheck) {
  if (!budgetCheck || !budgetCheck.skipIfBudgetLow) {
    return { skip: false };
  }
  const cap = Number.isFinite(budgetCheck.maxConcurrent) ? budgetCheck.maxConcurrent : 6;
  let running = 0;
  try {
    const { backgroundStore } = await import('./background-store.mjs');
    const list = backgroundStore.list();
    running = list.filter(
      (b) => b && (b.status === 'running' || b.status === 'pending'),
    ).length;
  } catch (err) {
    // If the bg subsystem is unreachable we treat that as "no tasks
    // running" — better to over-fire a schedule than to silently skip.
    logLine(`[schedule] budget check failed: ${err.message || err}`);
    return { skip: false };
  }
  if (running >= cap) {
    return {
      skip: true,
      reason: `budget: ${running} concurrent >= ${cap}`,
      running,
      cap,
    };
  }
  return { skip: false, running, cap };
}

function runCommand(action) {
  return new Promise((resolve) => {
    const parsed = parseCommandTarget(action);
    if (parsed.error) {
      resolve({ ok: false, error: parsed.error });
      return;
    }
    try {
      const child = spawn(parsed.command, parsed.args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => (stdout += b.toString()));
      child.stderr.on('data', (b) => (stderr += b.toString()));
      child.on('error', (err) => {
        resolve({ ok: false, error: err.message, stdout, stderr });
      });
      child.on('close', (code) => {
        resolve({
          ok: code === 0,
          error: code === 0 ? null : `exit ${code}`,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
        });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

async function runWebhook(action) {
  const validated = validateWebhookTarget(action.target);
  if (validated.error) return { ok: false, error: validated.error };
  const method = String(action.method || 'POST').toUpperCase();
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
  if (!allowedMethods.has(method)) {
    return { ok: false, error: `unsupported webhook method: ${method}` };
  }
  try {
    const r = await fetch(validated.url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: action.body && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(action.body) : undefined,
      redirect: 'manual',
    });
    if (r.status >= 300 && r.status < 400) {
      return { ok: false, status: r.status, error: 'redirect responses are blocked for webhooks' };
    }
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runEvalAction(action, ctx = {}) {
  const logger = ctx.logger || {
    info: (msg, meta) => console.log(`[eval-run] ${msg}`, meta || ''),
    error: (msg, meta) => console.error(`[eval-run] ${msg}`, meta || ''),
  };
  try {
    const { runSuite } = await import('./eval.mjs');
    const { saveRun, buildRunId } = await import('./eval-store.mjs');
    const { chatCompletion } = await import('./minimax.mjs');

    const runId = buildRunId();
    const startedAt = new Date().toISOString();

    const llmCall = async (prompt, opts = {}) => {
      const result = await chatCompletion({ prompt, model: 'MiniMax-M3' });
      if (!result.ok) throw new Error(result.message || 'llm call failed');
      return {
        content: result.content,
        usage: {
          inputTokens: result.usage?.prompt_tokens ?? 0,
          outputTokens: result.usage?.completion_tokens ?? 0,
          totalTokens: result.usage?.total_tokens ?? 0,
        },
      };
    };

    const result = await runSuite(action.suitePath, {
      llmCall,
      concurrency: 5,
      timeoutMs: 120_000,
      agent: action.agent,
    });

    const finishedAt = new Date().toISOString();
    const run = {
      id: runId,
      startedAt,
      finishedAt,
      suitePath: action.suitePath,
      total: result.total,
      passed: result.passed,
      failed: result.failed,
      results: result.results,
    };

    await saveRun(run);
    logger.info('scheduled eval completed', {
      suite: action.suitePath,
      passed: result.passed,
      total: result.total,
    });
    return { ok: result.failed === 0, passed: result.passed, failed: result.failed, total: result.total };
  } catch (err) {
    logger.error('scheduled eval failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export const schedulesRunner = {
  LOG_FILE,

  /** Run all currently-due schedules for every project. */
  async tick() {
    const reg = projectsStore.list();
    const fired = [];
    const projectIds = new Set(reg.projects.map((project) => project.id));
    try {
      if (schedulesStore.list('default').length > 0) projectIds.add('default');
    } catch (err) {
      console.warn('swallowed in schedules due-list:', err.message);
    }
    let skipped = 0;

    // Project schedules
    for (const projectId of projectIds) {
      const due = schedulesStore.due(projectId, Date.now());
      for (const sched of due) {
        const result = await this.runOne(projectId, sched);
        if (result && result.skipped) skipped += 1;
        fired.push({ projectId, scheduleId: sched.id, ...result });
      }
    }

    // v4.8.0 — Internal (builtin) schedules
    const now = Date.now();
    for (const sched of internalSchedules) {
      if (!sched.enabled) continue;
      if (!sched.nextRun) continue;
      if (new Date(sched.nextRun).getTime() > now) continue;
      const startedAt = new Date().toISOString();
      logLine(`[${startedAt}] run internal ${sched.id} (${sched.name})`);
      try {
        if (typeof sched.handler === 'function') {
          const res = await sched.handler();
          sched.lastRun = new Date().toISOString();
          // Recompute nextRun
          if (sched.schedule) {
            try {
              const job = new Cron(sched.schedule, { timezone: sched.timezone || 'UTC' });
              const n = job.nextRun();
              sched.nextRun = n ? n.toISOString() : null;
            } catch {
              sched.nextRun = null;
            }
          }
          logLine(`[${new Date().toISOString()}] done internal ${sched.id} → ${res.ok ? 'success' : 'error'}`);
          fired.push({ projectId: 'internal', scheduleId: sched.id, ok: res.ok, runResult: res });
        }
      } catch (err) {
        logLine(`[${new Date().toISOString()}] failed internal ${sched.id}: ${err.message}`);
        fired.push({ projectId: 'internal', scheduleId: sched.id, ok: false, runResult: { error: err.message } });
      }
    }

    if (skipped > 0) {
      logLine(`[schedule] tick: ${skipped} skipped by budget pre-flight`);
    }
    return fired;
  },

  /** Run a single schedule immediately and record the result. */
  async runOne(projectId, sched) {
    const startedAt = new Date().toISOString();
    logLine(
      `[${startedAt}] run ${projectId}/${sched.id} (${sched.type}: ${sched.schedule})`,
    );
    // Budget pre-flight — only applies to agent actions with a budget
    // gate. A skip records a `skipped` result and does NOT advance
    // `nextRun` (the schedule keeps firing on the same cadence).
    if (sched && sched.action && sched.action.type === 'agent') {
      try {
        const budget = await checkBudget(sched.budgetCheck);
        if (budget.skip) {
          logLine(`[schedule] budget check: ${budget.reason}, skipping ${sched.id}`);
          const updated = schedulesStore.recordRun(projectId, sched.id, {
            result: 'skipped',
            error: budget.reason || 'budget exhausted',
          });
          return { ok: true, skipped: true, schedule: updated, runResult: { skipped: true, ...budget } };
        }
      } catch (err) {
        // A failing budget check must NOT block the schedule — log and
        // proceed with the action.
        logLine(`[schedule] budget check threw: ${err.message || err}`);
      }
    }
    try {
      const res = await runAction(sched.action, { projectId });
      // The runner distinguishes "ran but skipped by budget" (ok:true,
      // skipped:true) from "ran successfully" (ok:true, no skip) and
      // "ran and errored" (ok:false).
      const result = res && res.skipped
        ? 'skipped'
        : res.ok
          ? 'success'
          : 'error';
      const updated = schedulesStore.recordRun(projectId, sched.id, {
        result,
        error: res.error || null,
      });
      const suffix = result === 'success'
        ? 'success'
        : result === 'skipped'
          ? `skipped: ${res.error || 'budget'}`
          : `error: ${res.error}`;
      logLine(
        `[${new Date().toISOString()}] done ${projectId}/${sched.id} → ${suffix}`,
      );
      return { ok: res.ok, skipped: result === 'skipped', schedule: updated, runResult: res };
    } catch (err) {
      const updated = schedulesStore.recordRun(projectId, sched.id, {
        result: 'error',
        error: err.message || String(err),
      });
      logLine(
        `[${new Date().toISOString()}] failed ${projectId}/${sched.id}: ${err.message}`,
      );
      return { ok: false, schedule: updated, runResult: { error: err.message } };
    }
  },
};
