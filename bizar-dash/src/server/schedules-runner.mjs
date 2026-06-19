/**
 * src/server/schedules-runner.mjs
 *
 * v3.0.0 — Executes due schedules.
 *
 * Called by the service daemon (cli/service.mjs) on a tick. For each due
 * schedule, this module runs the action and records the result via
 * schedulesStore.recordRun().
 *
 * Action types:
 *   - command  → spawn a child process
 *   - agent    → log + append activity (we don't dispatch live agents from
 *               the service yet — that's wired in v3.1)
 *   - webhook  → POST JSON to the URL
 *
 * v3 keeps the runner minimal. Errors are caught and recorded; the loop
 * never throws.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from './projects-store.mjs';
import { schedulesStore } from './schedules-store.mjs';

const HOME = homedir();
const LOG_DIR = join(HOME, '.config', 'bizar');
const LOG_FILE = join(LOG_DIR, 'service.log');

function logLine(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

async function runAction(action) {
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
    // For v3 we just log; real agent dispatch lives in v3.1+
    logLine(`[schedule] agent dispatch (deferred to v3.1): ${action.target || '?'}`);
    return { ok: true, note: 'agent dispatch deferred to v3.1' };
  }
  throw new Error(`unknown action type: ${action.type}`);
}

function runCommand(action) {
  return new Promise((resolve) => {
    const target = action.target || '';
    if (!target) {
      resolve({ ok: false, error: 'empty command target' });
      return;
    }
    try {
      const child = spawn(target, {
        shell: true,
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
  const url = action.target;
  if (!url) return { ok: false, error: 'empty webhook URL' };
  try {
    const r = await fetch(url, {
      method: action.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: action.body ? JSON.stringify(action.body) : undefined,
    });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const schedulesRunner = {
  LOG_FILE,

  /** Run all currently-due schedules for every project. */
  async tick() {
    const reg = projectsStore.list();
    const fired = [];
    for (const project of reg.projects) {
      const due = schedulesStore.due(project.id, Date.now());
      for (const sched of due) {
        const result = await this.runOne(project.id, sched);
        fired.push({ projectId: project.id, scheduleId: sched.id, ...result });
      }
    }
    return fired;
  },

  /** Run a single schedule immediately and record the result. */
  async runOne(projectId, sched) {
    const startedAt = new Date().toISOString();
    logLine(
      `[${startedAt}] run ${projectId}/${sched.id} (${sched.type}: ${sched.schedule})`,
    );
    try {
      const res = await runAction(sched.action);
      const updated = schedulesStore.recordRun(projectId, sched.id, {
        result: res.ok ? 'success' : 'error',
        error: res.error || null,
      });
      logLine(
        `[${new Date().toISOString()}] done ${projectId}/${sched.id} → ${res.ok ? 'success' : 'error: ' + res.error}`,
      );
      return { ok: res.ok, schedule: updated, runResult: res };
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
