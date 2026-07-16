/**
 * src/server/diagnostics-store.mjs
 *
 * v3.0.0 — Health check, version info, and last-N errors.
 * v6.0.0 — Doctor surface: full system snapshot (`collectDiagnostics()`),
 *          per-check dispatch (`runCheck(name)`), and a timestamped
 *          recent-errors feed (`getRecentErrors({ since })`) for the
 *          Doctor page in the dashboard.
 *
 * The legacy `snapshot()` and `health()` methods are preserved so the
 * v3 `/api/diagnostics` routes keep working unchanged. The Doctor routes
 * call the richer `collectDiagnostics()` / `runCheck()` / `health()`.
 */
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectsStore } from './projects-store.mjs';
import { modsLoader } from './mods-loader.mjs';
import { agentsStore } from './agents-store.mjs';
import { providersStore, mcpsStore } from './providers-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { schedulesStore } from './schedules-store.mjs';

const HOME = homedir();
const SERVICE_LOG = join(HOME, '.config', 'bizar', 'service.log');
const SERVICE_PID = join(HOME, '.config', 'bizar', 'service.pid');
const DASH_PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');

const startedAt = Date.now();

function dashboardVersion() {
  try {
    return JSON.parse(readFileSync(DASH_PACKAGE_JSON, 'utf8'))?.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

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

/**
 * v6.0.0 — Timestamped error feed. Reads the recent service log and
 * returns entries whose `[ts]` prefix (if any) is >= `since`. Each
 * entry carries a parsed epoch ms to make filtering cheap for the
 * UI's "last hour" widget.
 *
 * Capped at 200 entries to keep the response bounded — the dashboard
 * only ever displays ~30. Returns `[]` on any read failure so the UI
 * can render an empty state instead of crashing.
 *
 * @param {{ since?: number, limit?: number }} opts
 * @returns {Array<{ line: string, ts: string | null, tsMs: number | null }>}
 */
export function getRecentErrors({ since = 0, limit = 200 } = {}) {
  if (!existsSync(SERVICE_LOG)) return [];
  try {
    const text = readFileSync(SERVICE_LOG, 'utf8');
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (!/\b(failed|error|err)\b/i.test(line)) continue;
      const tsStr = parseLogTs(line);
      const tsMs = tsStr ? Date.parse(tsStr) : null;
      if (since && tsMs !== null && tsMs < since) continue;
      out.push({ line, ts: tsStr, tsMs });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * v6.0.0 — Generic TCP probe used by the Doctor page.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{ running: boolean, port?: number, error?: string }>}
 */
async function probeTcp(host, port, timeoutMs = 800) {
  // Lazy import so unit tests that don't need TCP probing still load
  // the module under environments that can't resolve `node:net`.
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      resolve(ok ? { running: true, port } : { running: false, error: error || 'unreachable' });
    };
    const sock = connect(port, host);
    const timer = setTimeout(() => {
      sock.destroy();
      finish(false, 'timeout');
    }, timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      finish(true);
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      finish(false, err.message);
    });
  });
}

/**
 * v6.0.0 — LightRAG port probe. The dashboard doesn't always have a
 * lightrag server running, so the probe is best-effort. Returns the
 * port from settings if known, plus a `running` boolean.
 *
 * @returns {Promise<{ running: boolean, port?: number, error?: string }>}
 */
async function probeLightRAG() {
  try {
    // Avoid a hard dependency on the memory router module: just read
    // the same `.bizar/memory.json` it would consult. Fall back to
    // a no-port default.
    const cfgPath = join(HOME, '.config', 'bizar', 'memory.json');
    let port = 0;
    if (existsSync(cfgPath)) {
      try {
        const parsed = JSON.parse(readFileSync(cfgPath, 'utf8'));
        port = Number(parsed?.lightrag?.port || 0);
      } catch { /* malformed JSON — ignore */ }
    }
    if (!port) return { running: false, port: undefined, error: 'port unknown' };
    return await probeTcp('127.0.0.1', port, 800);
  } catch (err) {
    return { running: false, error: err.message };
  }
}

/**
 * v6.0.0 — Probe whether the cline plugin's `serve-info.json` is
 * reachable on disk and parseable. The dashboard reads serve-info to
 * dispatch agent tasks; if it's missing or stale, the Doctor page
 * flags it as a warning (not a failure) since some installs don't use
 * the plugin.
 */
function clineServeInfo() {
  const candidates = [
    join(HOME, '.cache', 'bizar', 'serve.json'),
    join(HOME, '.cache', 'bizar', 'serve-info.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const port = Number(raw?.port || 0);
      return { reachable: true, path, port: port || undefined, baseUrl: raw?.baseUrl || null };
    } catch (err) {
      return { reachable: false, path, error: err.message };
    }
  }
  return { reachable: false, path: null };
}

/**
 * v6.0.0 — Aggregate counts across every dashboard store. The Doctor
 * page surfaces this as a one-line-per-row table. All counts return
 * 0 (never throw) when the underlying store is empty or unreachable,
 * so a partial outage still gives the operator a useful readout.
 */
function collectCounts() {
  const projects = projectsStore.list();
  const active = projectsStore.active();
  const tasks = active ? tasksStore.loadTasks(active.id) : [];
  const schedules = active ? schedulesStore.list(active.id) : [];
  let workspacesCount = 0;
  try {
    // listWorkspaces is async and requires a userId — fall back to the
    // index file size if we can't resolve one cheaply.
    const indexPath = join(HOME, '.config', 'bizar', 'workspaces', 'index.json');
    if (existsSync(indexPath)) {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
      workspacesCount = Array.isArray(parsed?.workspaces) ? parsed.workspaces.length : 0;
    }
  } catch { /* ignore */ }
  let voiceNotes = 0;
  try {
    const voiceDir = join(HOME, '.config', 'bizar', 'voice');
    if (existsSync(voiceDir)) {
      voiceNotes = readdirSync(voiceDir).filter((f) => f.endsWith('.json')).length;
    }
  } catch { /* ignore */ }
  let evalRuns = 0;
  try {
    const evalDir = join(HOME, '.config', 'bizar', 'eval');
    if (existsSync(evalDir)) {
      evalRuns = readdirSync(evalDir).filter((f) => f.endsWith('.json')).length;
    }
  } catch { /* ignore */ }
  let backups = 0;
  try {
    const backupDir = join(HOME, '.local', 'share', 'bizar', 'backups');
    if (existsSync(backupDir)) {
      backups = readdirSync(backupDir).filter((f) => f.startsWith('bizar-')).length;
    }
  } catch { /* ignore */ }
  return {
    tasks: tasks.length,
    schedules: schedules.length,
    mods: modsLoader.list().length,
    providers: providersStore.list().length,
    mcps: mcpsStore.list().length,
    agents: agentsStore.list().length,
    projects: projects.projects.length,
    activeProject: active?.id || null,
    workspaces: workspacesCount,
    voiceNotes,
    evalRuns,
    backups,
  };
}

/**
 * v6.0.0 — Static config-health checks. Each check is a name +
 * `{ status, message }` pair. `status` is `ok` / `warn` / `fail`,
 * matching the `DoctorCheck` shape consumed by the frontend.
 *
 * Used by `health()` and exposed individually via `runCheck(name)`.
 */
async function runConfigChecks() {
  const clineConfig = providersStore.CLINE_JSON;
  const agentsDir = agentsStore.AGENTS_DIR;
  const checks = [];
  checks.push({
    name: 'cline-config',
    status: existsSync(clineConfig) ? 'ok' : 'fail',
    message: existsSync(clineConfig) ? `present at ${clineConfig}` : `${clineConfig} not found`,
  });
  checks.push({
    name: 'cline-agents',
    status: existsSync(agentsDir) ? 'ok' : 'warn',
    message: existsSync(agentsDir) ? `${agentsDir} present` : `${agentsDir} missing — agents will fall back to defaults`,
  });
  const bizarHome = join(HOME, '.config', 'bizar');
  checks.push({
    name: 'bizar-home',
    status: existsSync(bizarHome) ? 'ok' : 'fail',
    message: existsSync(bizarHome) ? bizarHome : `${bizarHome} missing`,
  });
  const memoryConfig = join(HOME, '.config', 'bizar', 'memory.json');
  checks.push({
    name: 'memory-config',
    status: existsSync(memoryConfig) ? 'ok' : 'warn',
    message: existsSync(memoryConfig) ? 'memory.json configured' : 'no memory.json — running with defaults',
  });
  return checks;
}

/**
 * v6.0.0 — Service health checks. TCP probe for lightrag
 * (best-effort), cline plugin file probe, and the dashboard itself
 * (always `ok` — we're running because we got here).
 */
async function runServiceChecks() {
  const lightrag = await probeLightRAG();
  const serveInfo = clineServeInfo();
  const checks = [
    {
      name: 'dashboard',
      status: 'ok',
      message: `running on pid ${process.pid}, up ${Math.floor(process.uptime())}s`,
    },
    {
      name: 'lightrag',
      status: lightrag.running ? 'ok' : 'warn',
      message: lightrag.running
        ? `running on port ${lightrag.port}`
        : `not running${lightrag.port ? ` on port ${lightrag.port}` : ''}${lightrag.error ? ` (${lightrag.error})` : ''}`,
    },
    {
      name: 'cline',
      status: serveInfo.reachable ? 'ok' : 'warn',
      message: serveInfo.reachable
        ? `serve-info at ${serveInfo.path}${serveInfo.port ? ` (port ${serveInfo.port})` : ''}`
        : `serve-info missing${serveInfo.error ? `: ${serveInfo.error}` : ''} — plugin may not be running`,
    },
  ];
  return checks;
}

/**
 * v6.0.0 — Overall system checks. Pure: no I/O, no probes. Reports
 * Node version, platform, arch, and uptime.
 */
function runSystemChecks() {
  return [
    {
      name: 'node',
      status: 'ok',
      message: `${process.version} on ${process.platform}/${process.arch}`,
    },
    {
      name: 'uptime',
      status: 'ok',
      message: `${Math.floor(process.uptime())}s`,
    },
    {
      name: 'memory',
      status: process.memoryUsage().rss < 512 * 1024 * 1024 ? 'ok' : 'warn',
      message: `rss ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`,
    },
  ];
}

/**
 * v6.0.0 — Run a single named check. Returns a single
 * `{ name, status, message }` entry, or `null` if the name is unknown.
 * Used by `POST /api/doctor/check`.
 *
 * @param {string} name
 * @returns {Promise<{ name: string, status: string, message: string } | { name: string, status: 'fail', message: string, error: string }>}
 */
export async function runCheck(name) {
  if (!name || typeof name !== 'string') {
    return { name: String(name || ''), status: 'fail', message: 'unknown check', error: 'checkName required' };
  }
  const system = runSystemChecks();
  const config = await runConfigChecks();
  const services = await runServiceChecks();
  const all = [...system, ...config, ...services];
  const hit = all.find((c) => c.name === name);
  if (!hit) {
    return {
      name,
      status: 'fail',
      message: 'unknown check',
      error: `no check named "${name}". Available: ${all.map((c) => c.name).join(', ')}`,
    };
  }
  return hit;
}

/**
 * v6.0.0 — Top-level health rollup. Aggregates every check group,
 * collapses to a single `ok | warn | fail` status, and returns the
 * structured list of issues so the UI can show "3 warnings" without
 * having to re-derive the math client-side.
 *
 * @returns {Promise<{ status: 'ok'|'warn'|'fail', issues: Array<{ name: string, status: string, message: string }>, groups: Record<string, Array<{ name: string, status: string, message: string }>>, ts: string }>}
 */
export async function health() {
  const system = runSystemChecks();
  const config = await runConfigChecks();
  const services = await runServiceChecks();
  const groups = { system, config, services };
  const flat = [...system, ...config, ...services];
  const issues = flat.filter((c) => c.status !== 'ok');
  let status = 'ok';
  if (issues.some((c) => c.status === 'fail')) status = 'fail';
  else if (issues.length > 0) status = 'warn';
  return { ts: new Date().toISOString(), status, issues, groups };
}

/**
 * v6.0.0 — Full Doctor snapshot. One call collects everything the
 * Doctor page renders, with bounded response size so the dashboard
 * auto-refresh (every 30s) stays cheap.
 *
 * @returns {Promise<{
 *   timestamp: string,
 *   bizarVersion: string,
 *   nodeVersion: string,
 *   platform: string,
 *   arch: string,
 *   uptime: number,
 *   memory: NodeJS.MemoryUsage,
 *   disk: { exists: boolean, path: string, sizeBytes: number },
 *   services: { dashboard: object, lightrag: object, cline: object },
 *   counts: ReturnType<typeof collectCounts>,
 *   recentErrors: ReturnType<typeof getRecentErrors>,
 *   configHealth: Array<{ name: string, status: string, message: string }>,
 *   cline: { configExists: boolean, agentsDir: string, agentFiles: string[], dashboardConnected: boolean },
 *   checks: { system: Array, config: Array, services: Array },
 *   health: { status: string, issues: Array }
 * }>}
 */
export async function collectDiagnostics() {
  const counts = collectCounts();
  const system = runSystemChecks();
  const config = await runConfigChecks();
  const services = await runServiceChecks();
  const rollup = { system, config, services };
  const flat = [...system, ...config, ...services];
  const issues = flat.filter((c) => c.status !== 'ok');
  let status = 'ok';
  if (issues.some((c) => c.status === 'fail')) status = 'fail';
  else if (issues.length > 0) status = 'warn';
  const lightrag = await probeLightRAG();
  const serveInfo = clineServeInfo();
  const clineConfig = providersStore.CLINE_JSON;
  const agentsDir = agentsStore.AGENTS_DIR;
  let agentFiles = [];
  try {
    if (existsSync(agentsDir)) {
      agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    }
  } catch { /* ignore */ }
  const dashboardLogPath = join(HOME, '.config', 'bizar', 'dashboard.log');
  const disk = {
    path: join(HOME, '.config'),
    exists: existsSync(join(HOME, '.config')),
    sizeBytes: 0,
  };
  try {
    if (disk.exists) disk.sizeBytes = statSync(join(HOME, '.config')).size;
  } catch { /* ignore */ }
  const dashboardLogExists = existsSync(dashboardLogPath);
  return {
    timestamp: new Date().toISOString(),
    bizarVersion: dashboardVersion(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    disk,
    services: {
      dashboard: {
        running: true,
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        logPath: dashboardLogPath,
        logExists: dashboardLogExists,
      },
      lightrag,
      cline: serveInfo,
    },
    counts,
    recentErrors: getRecentErrors({ since: Date.now() - 3600_000, limit: 50 }),
    configHealth: config,
    cline: {
      configExists: existsSync(clineConfig),
      configPath: clineConfig,
      agentsDir,
      agentFiles,
      dashboardConnected: serveInfo.reachable,
    },
    checks: rollup,
    health: {
      status,
      issues,
    },
  };
}

export const diagnosticsStore = {
  /** Build the full diagnostics snapshot. */
  snapshot(extra = {}) {
    const projects = projectsStore.list();
    const active = projectsStore.active();
    const tasks = active ? tasksStore.loadTasks(active.id) : [];
    const schedules = active ? schedulesStore.list(active.id) : [];
    return {
      version: dashboardVersion(),
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
      name: 'cline-agents',
      ok: existsSync(agentsStore.AGENTS_DIR),
      detail: agentsStore.AGENTS_DIR,
    });
    checks.push({
      name: 'cline-config',
      ok: existsSync(providersStore.CLINE_JSON),
      detail: providersStore.CLINE_JSON,
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