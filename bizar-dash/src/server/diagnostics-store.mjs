/**
 * src/server/diagnostics-store.mjs
 *
 * v3.0.0 — Health check, version info, and last-N errors.
 *
 * Returns a single snapshot for the diagnostics card in the dashboard.
 */
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { projectsStore } from './projects-store.mjs';
import { modsLoader } from './mods-loader.mjs';
import { agentsStore } from './agents-store.mjs';
import { providersStore, mcpsStore } from './providers-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { schedulesStore } from './schedules-store.mjs';

const HOME = homedir();
const SERVICE_LOG = join(HOME, '.config', 'bizar', 'service.log');
const SERVICE_PID = join(HOME, '.config', 'bizar', 'service.pid');

const startedAt = Date.now();

function readRecentErrors() {
  if (!existsSync(SERVICE_LOG)) return [];
  try {
    const text = readFileSync(SERVICE_LOG, 'utf8');
    const lines = text.split(/\r?\n/);
    const errors = [];
    for (let i = lines.length - 1; i >= 0 && errors.length < 10; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (/\b(failed|error|err)\b/i.test(line)) {
        errors.push({ line, ts: parseLogTs(line) });
      }
    }
    return errors;
  } catch {
    return [];
  }
}

function parseLogTs(line) {
  const m = /^\[([^\]]+)\]/.exec(line);
  return m ? m[1] : null;
}

function checkPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serviceStatus() {
  if (!existsSync(SERVICE_PID)) return { running: false };
  try {
    const pid = parseInt(readFileSync(SERVICE_PID, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return { running: false, error: 'bad PID file' };
    const alive = checkPidAlive(pid);
    return { running: alive, pid, pidFile: SERVICE_PID };
  } catch (err) {
    return { running: false, error: err.message };
  }
}

export const diagnosticsStore = {
  /** Build the full diagnostics snapshot. */
  snapshot(extra = {}) {
    const projects = projectsStore.list();
    const active = projectsStore.active();
    const tasks = active ? tasksStore.loadTasks(active.id) : [];
    const schedules = active ? schedulesStore.list(active.id) : [];
    return {
      version: '3.4.1',
      uptimeMs: Date.now() - startedAt,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed,
        heapTotal: process.memoryUsage().heapTotal,
      },
      counts: {
        agents: agentsStore.list().length,
        plans: 0, // plans are not in our scope yet; leave at 0
        tasks: tasks.length,
        projects: projects.projects.length,
        activeProject: active?.id || null,
        mods: modsLoader.list().length,
        schedules: schedules.length,
        providers: providersStore.list().length,
        mcps: mcpsStore.list().length,
      },
      errors: readRecentErrors(),
      service: serviceStatus(),
      ...extra,
    };
  },

  /** Run a set of health checks and return per-subsystem status. */
  health() {
    const checks = [];
    const projectsFile = projectsStore.PROJECTS_FILE;
    checks.push({
      name: 'projects-registry',
      ok: existsSync(dirname(projectsFile)),
      detail: dirname(projectsFile),
    });
    checks.push({
      name: 'opencode-agents',
      ok: existsSync(agentsStore.AGENTS_DIR),
      detail: agentsStore.AGENTS_DIR,
    });
    checks.push({
      name: 'opencode-config',
      ok: existsSync(providersStore.OPENCODE_JSON),
      detail: providersStore.OPENCODE_JSON,
    });
    const modsDir = modsLoader.MOD_DIR || modsLoader.MOD_DIR;
    checks.push({
      name: 'mods-dir',
      ok: true, // the dir is auto-created; this is informational
      detail: modsLoader.MOD_DIR || modsLoader.MOD_DIR,
    });
    return {
      ts: new Date().toISOString(),
      checks,
    };
  },
};

// Add MOD_DIR alias for older access
modsLoader.MOD_DIR = modsLoader.MOD_DIR || modsLoader.MODS_DIR;
