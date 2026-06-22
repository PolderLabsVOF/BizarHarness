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
import { isIP } from 'node:net';
import { projectsStore } from './projects-store.mjs';
import { schedulesStore } from './schedules-store.mjs';

const HOME = homedir();
const LOG_DIR = join(HOME, '.config', 'bizar');
const LOG_FILE = join(LOG_DIR, 'service.log');
const ALLOW_PRIVATE_WEBHOOKS = process.env.BIZAR_DASHBOARD_ALLOW_PRIVATE_WEBHOOKS === '1';
const SHELL_META = /[;&|`$<>\n\r]/;

function logLine(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch {
    /* ignore */
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

export const schedulesRunner = {
  LOG_FILE,

  /** Run all currently-due schedules for every project. */
  async tick() {
    const reg = projectsStore.list();
    const fired = [];
    const projectIds = new Set(reg.projects.map((project) => project.id));
    try {
      if (schedulesStore.list('default').length > 0) projectIds.add('default');
    } catch {
      /* ignore */
    }
    for (const projectId of projectIds) {
      const due = schedulesStore.due(projectId, Date.now());
      for (const sched of due) {
        const result = await this.runOne(projectId, sched);
        fired.push({ projectId, scheduleId: sched.id, ...result });
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
