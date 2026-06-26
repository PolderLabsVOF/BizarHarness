/**
 * src/cli/dashboard-ports.mjs
 *
 * v3.20.7 — Discover every running Bizar dashboard on this machine,
 * classify it as healthy / zombie / orphan / dead, and provide cleanup
 * helpers. Solves the long-standing "why is there a dashboard on
 * port 4321 that I can't reach but won't go away?" problem.
 *
 * We can't trust the port file (it tracks only the most-recent start,
 * written to the last successful boot). Use a combination of:
 *   1. Read the canonical PID from ~/.config/bizar/dashboard.pid
 *   2. Scan all node processes via `ps` for `bizar dash start` /
 *      `@polderlabs/bizar-dash/src/cli.mjs start`
 *   3. For each candidate PID, walk /proc/<pid>/fd → socket inodes →
 *      /proc/net/tcp to find its listening port (Linux only)
 *   4. TCP-probe each candidate port (1.5s timeout, transport-only)
 *   5. HTTP-probe each reachable port's /api/health endpoint
 *
 * Result classification:
 *   - 'healthy' PID alive + /api/health returns ok:true
 *   - 'zombie'  PID alive + port accepts TCP but health probe fails
 *              (request handler deadlock, event loop starved, etc.)
 *   - 'dead'    PID does not exist (orphaned port file)
 *   - 'orphan'  Port responds to health but no PID file knows about it
 *              (started by a different process, port file deleted)
 *
 * Exports:
 *   - findAllDashboards()  → DashboardInstance[]
 *   - killDashboard(pid, signal?) → boolean
 *   - summarize(instances) → friendly multi-line report
 *
 * Cross-platform: the /proc-fd walk is Linux-only. On macOS/Windows
 * we fall back to canonical-PID + port range scan.
 */
import { execSync, spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import net from 'node:net';

export const DEFAULT_PORT_START = 4321;
export const DEFAULT_PORT_END = 4530;
export const HEALTH_PROBE_TIMEOUT_MS = 1500;
export const TCP_PROBE_TIMEOUT_MS = 800;

const HOME = homedir();
const BIZAR_HOME = process.platform === 'win32'
  ? join(process.env.APPDATA || HOME, 'bizar')
  : join(HOME, '.config', 'bizar');
export const PID_FILE = join(BIZAR_HOME, 'dashboard.pid');
export const PORT_FILE = join(BIZAR_HOME, 'dashboard.port');

/**
 * @typedef {Object} DashboardInstance
 * @property {number|null} pid          PID of the node process (null if unknown)
 * @property {number|null} port         TCP port the dashboard listens on
 * @property {'healthy'|'zombie'|'dead'|'orphan'|'unknown'} state
 * @property {boolean}     portReachable  TCP probe succeeded
 * @property {boolean}     healthOk        /api/health returned ok:true
 * @property {string}      cmdline         Full process command line (or note)
 * @property {'pid-file'|'ps-scan'|'port-scan'} source  How we found it
 * @property {boolean}     isCanonical     Matches the PID file
 */

export function readCanonical() {
  let pid = null;
  let port = null;
  try {
    const v = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(v) && v > 0) pid = v;
  } catch { /* ignore */ }
  try {
    const v = parseInt(readFileSync(PORT_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(v) && v > 0 && v <= 65535) port = v;
  } catch { /* ignore */ }
  return { pid, port };
}

/** True if a PID is alive (signal 0 trick). */
export function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** TCP connect probe — auth-free, transport-only. */
export function tcpProbe(port, timeoutMs = TCP_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}

/** HTTP probe — returns true only if /api/health returns ok:true. */
export async function httpHealth(port, timeoutMs = HEALTH_PROBE_TIMEOUT_MS) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    let json = null;
    try { json = await res.json(); } catch { return false; }
    return json && json.ok === true;
  } catch {
    return false;
  }
}

/**
 * Find the listening TCP port for a PID by walking /proc/<pid>/fd and
 * matching socket inodes against /proc/net/tcp. Linux-only.
 * Returns null on other platforms or if the PID has no listening socket.
 */
export function pidListeningPort(pid) {
  if (process.platform !== 'linux') return null;
  try {
    const fdDir = `/proc/${pid}/fd`;
    if (!existsSync(fdDir)) return null;
    const inodes = new Set();
    for (const fd of readdirSync(fdDir)) {
      try {
        const target = readlinkSync(join(fdDir, fd));
        const m = target.match(/socket:\[(\d+)\]/);
        if (m) inodes.add(m[1]);
      } catch { /* stale fd — ignore */ }
    }
    if (inodes.size === 0) return null;
    const tcp = readFileSync('/proc/net/tcp', 'utf8');
    // 127.0.0.1 in little-endian hex = 0100007F
    // 0.0.0.0     in little-endian hex = 00000000
    const LOCAL_IPS = new Set(['0100007F', '00000000']);
    for (const line of tcp.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const local = cols[1];
      if (!local.includes(':')) continue;
      const [ipHex, portHex] = local.split(':');
      if (!LOCAL_IPS.has(ipHex)) continue;
      const port = parseInt(portHex, 16);
      const inode = cols[9];
      if (inodes.has(inode)) return port;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * `ps`-based fallback to find every node process whose argv mentions
 * the Bizar dashboard CLI. Returns a list of { pid, cmdline }.
 *
 * v3.20.14 — tightened the pattern + added an explicit cmdline
 * re-verification step that the caller MUST do before trusting the
 * match. The previous version matched anything containing the substring
 * "bizar dash" or "@polderlabs/bizar-dash/src/cli.mjs" — which is fine
 * for finding real dashboards but breaks when:
 *   - The PID is recycled to a different process between ps-scan and
 *     `pidAlive(pid)` (Linux recycles PIDs in milliseconds).
 *   - A previous run wrote a stale `dashboard.pid` file referencing a
 *     PID that's now owned by an unrelated process (chrome-headless-shell
 *     renderer, ssh session, etc.).
 *   - The cmdline contains a path that no longer exists on disk
 *     (e.g. /home/drb0rk/.local/npm/bin/bizar after a clean npm install).
 *
 * The fix: only record a ps-scan match if the cmdline actually looks
 * like a node-launched Bizar dashboard CLI. The `cmdlineLooksLikeDashboard`
 * helper does the structural check (node binary + cli.mjs OR a known
 * `bizar` bin path + `dash start`). Then the caller's `pidAlive`
 * step re-reads /proc/<pid>/cmdline and calls the same helper to
 * confirm the PID hasn't been recycled.
 *
 * Skips our own process (the runner) so the CLI doesn't see itself.
 */
export function psScanDashboards() {
  const out = new Map(); // pid → cmdline
  if (process.platform === 'win32') {
    // tasklist | findstr — too platform-specific for now; users on
    // Windows who hit this can restart their machine. The canonical
    // PID file path still works on Windows.
    return out;
  }
  try {
    const result = execSync(
      // Match `bizar dash` or `@polderlabs/bizar-dash/src/cli.mjs`. The
      // pipe through grep -v grep is still needed to suppress grep's
      // own argv from matching the regex.
      `ps -eo pid=,args= 2>/dev/null | grep -E '(bizar[ ]+dash|@polderlabs/bizar-dash/src/cli\\.mjs)' | grep -v grep || true`,
      { encoding: 'utf8', timeout: 5000 },
    );
    for (const line of result.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: "<pid> <args...>" — pid is the first whitespace-delimited token.
      const m = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (!Number.isFinite(pid)) continue;
      if (pid === process.pid) continue; // skip our own process
      const cmdline = m[2].trim();
      // Structural check: only keep matches that look like a real
      // dashboard launch. Anything else is a false positive (PID
      // recycled, or a process whose argv happens to contain the
      // words "bizar dash" — e.g. a stale node process or a shell
      // command that includes the words in a comment).
      if (!cmdlineLooksLikeDashboard(cmdline)) continue;
      out.set(pid, cmdline);
    }
  } catch {
    // ps not available — fall back to canonical only
  }
  return out;
}

/**
 * Structural check: does this cmdline look like a Bizar dashboard
 * launch? We accept:
 *   - `node <anything>/@polderlabs/bizar-dash/src/cli.mjs [start|tui|...]`
 *   - `<path>/bizar dash <subcommand>` where `<path>` is a real-looking
 *     filesystem path (contains `/` or starts with `.`).
 *
 * Reject anything that doesn't match those patterns (e.g. a `bash -c`
 * shell command whose body mentions `bizar dash` in a comment).
 *
 * Implementation note: we anchor the `bizar` bin to a path-like prefix
 * by requiring it to be preceded by either the start of the cmdline,
 * a `/`, or a `\`. This rejects strings like
 * `bash -c "echo I want to run bizar dash start"` where `bizar dash
 * start` is mid-string inside a quoted argument — the `bizar` is
 * preceded by a space, not by a path separator.
 */
export function cmdlineLooksLikeDashboard(cmdline) {
  if (!cmdline || typeof cmdline !== 'string') return false;
  // Direct CLI invocation: @polderlabs/bizar-dash/src/cli.mjs <verb>
  if (/\/@polderlabs\/bizar-dash\/src\/cli\.mjs\b/.test(cmdline)) return true;
  // Wrapped via the `bizar` bin: <path>/bizar dash <subcommand>.
  // - The `bizar` token must be preceded by a path separator (so it's
  //   a binary path, not an arbitrary word in a comment).
  // - The `dash` and subcommand must be whitespace-delimited argv.
  if (/(?:^|[\/\\])\S*bizar\s+dash\s+(?:start|tui|stop|status|cleanup)\b/.test(cmdline)) return true;
  return false;
}

/**
 * Re-read /proc/<pid>/cmdline and verify the cmdline still looks like
 * a dashboard launch. Linux recycles PIDs aggressively — between
 * `psScanDashboards` returning a PID and `pidAlive(pid)` succeeding,
 * the PID may have been reassigned to an unrelated process. We catch
 * that by reading /proc/<pid>/cmdline fresh and re-applying the
 * structural check. Returns the cmdline string on success, null on
 * failure (PID dead, /proc unreadable, or cmdline no longer matches).
 */
export function verifyCmdlineAtProbeTime(pid) {
  if (!pid) return null;
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (cmdlineLooksLikeDashboard(cmdline)) return cmdline;
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover every Bizar dashboard process on this machine.
 *
 * @param {Object} opts
 * @param {number} [opts.portStart=4321]   Start of port scan range
 * @param {number} [opts.portEnd=4530]     End of port scan range
 * @param {boolean} [opts.scanPorts=true]  If true, probe ports in [start, end] for orphans
 * @returns {Promise<DashboardInstance[]>}
 */
export async function findAllDashboards({
  portStart = DEFAULT_PORT_START,
  portEnd = DEFAULT_PORT_END,
  scanPorts = true,
} = {}) {
  const canonical = readCanonical();
  /** @type {Map<number, DashboardInstance>} */
  const byPid = new Map();

  // 1. Canonical PID — even if dead, record it so the user can clean up.
  if (canonical.pid) {
    const alive = pidAlive(canonical.pid);
    let cmdline = '';
    try { cmdline = readFileSync(`/proc/${canonical.pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch {}
    if (!cmdline) cmdline = '(no /proc entry — process likely exited)';
    // v3.20.14 — only treat the canonical PID as canonical if the
    // current cmdline still looks like a dashboard launch. A recycled
    // PID (now owned by chrome, ssh, etc.) should NOT count as the
    // canonical dashboard — the PID file is stale.
    const cmdlineMatches = cmdlineLooksLikeDashboard(cmdline);
    byPid.set(canonical.pid, {
      pid: canonical.pid,
      port: canonical.port,
      // If PID is alive but cmdline is no longer a dashboard, the PID
      // has been recycled. Mark as 'dead' so cleanup clears the
      // stale PID file. Same if PID is genuinely dead.
      state: alive && cmdlineMatches ? 'unknown' : 'dead',
      portReachable: false,
      healthOk: false,
      cmdline,
      // Only canonical if PID file path AND cmdline both look real.
      // This prevents the "Found 1 dashboard: [healthy] pid 938619
      // from ps-scan" trap where the PID file's PID has been recycled
      // to an unrelated process.
      isCanonical: cmdlineMatches,
      source: 'pid-file',
    });
  }

  // 2. ps scan — find every node process running the dashboard CLI.
  const psResults = psScanDashboards();
  for (const [pid, cmdline] of psResults) {
    if (byPid.has(pid)) {
      // Already known — backfill cmdline if it was empty.
      const existing = byPid.get(pid);
      if (!existing.cmdline || existing.cmdline.startsWith('(')) {
        existing.cmdline = cmdline;
      }
      continue;
    }
    byPid.set(pid, {
      pid,
      port: null,
      state: 'unknown',
      portReachable: false,
      healthOk: false,
      cmdline,
      source: 'ps-scan',
      isCanonical: false,
    });
  }

  // 3. Probe each PID's listening port + health.
  for (const inst of byPid.values()) {
    if (!pidAlive(inst.pid)) {
      inst.state = 'dead';
      continue;
    }
    // v3.20.14 — re-read /proc/<pid>/cmdline fresh and re-verify it
    // still looks like a dashboard launch. Linux recycles PIDs
    // aggressively; a PID that matched ps-scan a moment ago may
    // now belong to an unrelated process (chrome-headless-shell
    // renderer, ssh session, etc.). If the cmdline no longer matches
    // the dashboard pattern, the PID is recycled — mark it dead.
    if (inst.source === 'ps-scan') {
      const fresh = verifyCmdlineAtProbeTime(inst.pid);
      if (fresh === null) {
        inst.state = 'dead';
        continue;
      }
      // Update cmdline in case it changed (the argv we saw at scan time
      // might have been a stale /proc snapshot — extremely rare but
      // possible during a process exec).
      if (fresh !== inst.cmdline) inst.cmdline = fresh;
    }
    // Resolve port: prefer /proc fd walk; fall back to canonical port for PID file match.
    if (!inst.port) {
      const discovered = pidListeningPort(inst.pid);
      if (discovered) inst.port = discovered;
    }
    if (!inst.port) continue; // can't probe without a port
    inst.portReachable = await tcpProbe(inst.port);
    if (!inst.portReachable) continue;
    inst.healthOk = await httpHealth(inst.port);
    inst.state = inst.healthOk ? 'healthy' : 'zombie';
  }

  // 4. Port-range scan for orphans — ports that respond to health but
  //    no PID claimed them.
  if (scanPorts) {
    const claimed = new Set(
      Array.from(byPid.values()).filter(i => i.port).map(i => i.port),
    );
    for (let p = portStart; p <= portEnd; p++) {
      if (claimed.has(p)) continue;
      const reachable = await tcpProbe(p);
      if (!reachable) continue;
      const healthOk = await httpHealth(p);
      if (!healthOk) continue;
      // We found a port responding to /api/health that no PID claimed.
      // This is an orphan — typically started by a different user or
      // after the port file was deleted.
      byPid.set(-p, {
        pid: null,
        port: p,
        state: 'orphan',
        portReachable: true,
        healthOk: true,
        cmdline: '(unknown — no PID claimed this port)',
        source: 'port-scan',
        isCanonical: false,
      });
    }
  }

  return Array.from(byPid.values()).sort((a, b) => {
    // Canonical first, then by port, then by pid
    if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
    if (a.port !== b.port) return (a.port || 0) - (b.port || 0);
    return (a.pid || 0) - (b.pid || 0);
  });
}

/**
 * Send a signal to a PID. Returns true if the signal was delivered.
 * `signal` defaults to 'SIGTERM' (graceful). Use 'SIGKILL' for stuck procs.
 */
export function killDashboard(pid, signal = 'SIGTERM') {
  if (!pid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the canonical PID/port files (only if the PID is dead or matches).
 */
export function clearCanonicalFiles(onlyIfPid = null) {
  if (onlyIfPid !== null) {
    const canonical = readCanonical();
    if (canonical.pid !== onlyIfPid) return false;
  }
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  try { unlinkSync(PORT_FILE); } catch { /* ignore */ }
  return true;
}

/**
 * Wait for a PID to exit (poll). Returns true if it exited within
 * `timeoutMs`, false otherwise.
 */
export async function waitForExit(pid, timeoutMs = 5000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return !pidAlive(pid);
}

/**
 * Render a friendly multi-line summary of dashboard instances for the CLI.
 */
export function summarize(instances) {
  if (!instances.length) {
    return 'No dashboards detected.';
  }
  const lines = [];
  lines.push(`Found ${instances.length} dashboard${instances.length === 1 ? '' : 's'}:`);
  lines.push('');
  for (const inst of instances) {
    const tag = inst.isCanonical ? '★ canonical' : '  ';
    const stateTag = `[${inst.state.padEnd(8)}]`;
    const portStr = inst.port ? `:${inst.port}` : '(no port)';
    const pidStr = inst.pid ? `pid ${inst.pid}` : 'pid ?';
    lines.push(`  ${tag} ${stateTag} ${pidStr.padEnd(12)} ${portStr.padEnd(10)} ${inst.source}`);
    if (inst.cmdline) {
      const cl = inst.cmdline.length > 100 ? inst.cmdline.slice(0, 97) + '...' : inst.cmdline;
      lines.push(`             ${cl}`);
    }
  }
  return lines.join('\n');
}
