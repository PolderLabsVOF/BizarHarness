/**
 * src/server/headroom.mjs
 *
 * v1.0.0 — Headroom CLI integration for the Bizar dashboard.
 *
 * Headroom (headroom-ai) is a context compression layer that sits between
 * opencode and LLM providers. It compresses tool outputs, logs, RAG chunks,
 * and conversation history by 60–95% before they reach the model.
 *
 * This module wraps the `headroom` CLI and exposes:
 *   - getHeadroomStatus()       — live status (installed, version, proxy, wrapped)
 *   - getHeadroomStats()        — compression statistics
 *   - installHeadroom()         — pip/npm install
 *   - wrapOpencode()           — run `headroom wrap opencode`
 *   - unwrapOpencode()          — run `headroom unwrap opencode`
 *   - startProxy()              — spawn `headroom proxy` as detached child
 *   - stopProxy()               — kill the proxy process
 *   - getOpencodeConfig()       — read opencode.json headroom status
 *   - withHeadroomProxy(url)    — prepend Headroom proxy URL if enabled
 *   - headroomStartupHook()     — auto-install/start/wrap on dashboard boot
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readSettings } from './routes/_shared.mjs';

// ── Constants ────────────────────────────────────────────────────────────────

const HOME = homedir();
const BIZAR_CACHE = join(HOME, '.cache', 'bizar');
const HEADROOM_PORT_FILE = join(BIZAR_CACHE, 'headroom.port');
const OPENCODE_JSON = join(HOME, '.config', 'opencode', 'opencode.json');
const DEFAULT_HEADROOM_PORT = 8787;
const DEFAULT_HEADROOM_HOST = '127.0.0.1';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run a command, capture stdout + stderr, resolve with exit code.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeout?: number, cwd?: string, env?: Record<string, string> }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const { timeout = 30000, cwd = HOME, env = process.env } = opts;
    // shell:false avoids DEP0190 deprecation warning and is safe because
    // args are already a proper array (not interpolated into a command string).
    const child = spawn(cmd, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

/**
 * Safe read of Headroom port from the cached file.
 * @returns {number | null}
 */
function readHeadroomPort() {
  try {
    if (!existsSync(HEADROOM_PORT_FILE)) return null;
    const port = parseInt(readFileSync(HEADROOM_PORT_FILE, 'utf8').trim(), 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Check if a TCP port is in use (quick probe).
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
async function isPortInUse(port, host = '127.0.0.1') {
  const { connect } = await import('node:net');
  return new Promise((resolve) => {
    const s = connect({ port, host, timeout: 1000 }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

/**
 * Read the proxy PID from the port file comment (if any), or try to find
 * it via /proc. Returns null if not determinable.
 * @param {number} port
 * @returns {Promise<number | null>}
 */
async function findProxyPid(port) {
  // Try reading from the pid file (same dir as port file)
  const pidFile = join(BIZAR_CACHE, 'headroom.pid');
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch { /* ignore */ }

  // Try to find process listening on the port via /proc/net/tcp (Linux only).
  // On macOS/Windows /proc does not exist — return null early to avoid noisy errors.
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const netTcp = readFileSync('/proc/net/tcp', 'utf8');
    const portHex = port.toString(16).toUpperCase().padStart(4, '0');
    const lines = netTcp.split('\n');
    for (const line of lines.slice(1)) {
      // Format: sl  local_address rem_address   st tx_queue rx_queue ... inode
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const local = parts[1];
      const localPortHex = local.split(':')[1];
      if (localPortHex?.toUpperCase() === portHex) {
        // Try to get PID from the socket inode
        const inode = parts[9];
        if (inode && inode !== '0') {
          // Scan /proc/*/fd/* for socket inodes
          const { readdirSync, readlinkSync } = await import('node:fs');
          const procDir = '/proc';
          const pids = readdirSync(procDir).filter(
            (n) => /^\d+$/.test(n) && !isNaN(parseInt(n, 10)),
          );
          for (const pid of pids) {
            try {
              const fdDir = join(procDir, pid, 'fd');
              const fds = readdirSync(fdDir);
              for (const fd of fds) {
                try {
                  const link = readlinkSync(join(fdDir, fd));
                  if (link.includes(`socket:[${inode}]`)) {
                    return parseInt(pid, 10);
                  }
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
          }
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Get the live Headroom status.
 *
 * @returns {Promise<{
 *   installed: boolean,
 *   version: string | null,
 *   proxyRunning: boolean,
 *   proxyPort: number | null,
 *   proxyPid: number | null,
 *   wrapped: boolean,
 *   configPath: string | null,
 *   healthy: 'ok' | 'warn' | 'fail',
 *   messages: string[],
 * }>}
 */
export async function getHeadroomStatus() {
  const messages = [];
  let healthy = 'ok';

  // 1. Check if headroom binary is on PATH
  const { stdout: versionOut, exitCode: versionCode } = await runCmd('headroom', ['--version']);
  const installed = versionCode === 0 && versionOut.length > 0;
  const version = installed ? versionOut.replace(/^headroom\s+/i, '').trim() : null;

  if (!installed) {
    messages.push('Headroom is not installed. Run `pip install "headroom-ai[all]"` or enable auto-install in Settings.');
    healthy = 'warn';
  }

  // 2. Check proxy port
  const proxyPort = readHeadroomPort();
  let proxyRunning = false;
  let proxyPid = null;

  if (proxyPort) {
    proxyRunning = await isPortInUse(proxyPort);
    if (proxyRunning) {
      proxyPid = await findProxyPid(proxyPort);
      messages.push(`Proxy running on ${proxyPort}${proxyPid ? ` (PID ${proxyPid})` : ''}.`);
    } else {
      messages.push(`Proxy port ${proxyPort} is not in use (stale port file).`);
      healthy = healthy === 'ok' ? 'warn' : healthy;
    }
  } else {
    messages.push('Proxy not started yet.');
  }

  // 3. Check if opencode is wrapped (opencode.json has headroom provider)
  const { configPath, hasHeadroomProvider } = await getOpencodeConfig();
  const wrapped = hasHeadroomProvider;

  if (!wrapped && installed) {
    messages.push('opencode is not wrapped with Headroom. Run `headroom wrap opencode` or use Settings.');
    healthy = healthy === 'ok' ? 'warn' : healthy;
  } else if (wrapped) {
    messages.push('opencode is wrapped with Headroom.');
  }

  if (healthy === 'ok') {
    messages.push('Headroom is healthy.');
  }

  return {
    installed,
    version,
    proxyRunning,
    proxyPort,
    proxyPid,
    wrapped,
    configPath,
    healthy,
    messages,
  };
}

// ── Stats ───────────────────────────────────────────────────────────────────

/**
 * Get Headroom compression statistics.
 *
 * @param {{ hours?: number }} [opts]
 * @returns {Promise<{
 *   tokensSaved: number,
 *   compressionRatio: number,
 *   cacheHits: number,
 *   transforms: number,
 *   raw: object,
 * } | { error: string }>}
 */
export async function getHeadroomStats({ hours = 24 } = {}) {
  const { stdout, stderr, exitCode } = await runCmd(
    'headroom',
    ['perf', '--hours', String(hours), '--format', 'json'],
    { timeout: 15000 },
  );

  if (exitCode !== 0) {
    return { error: stderr || `headroom perf failed with exit code ${exitCode}` };
  }

  try {
    const raw = JSON.parse(stdout);
    return {
      tokensSaved: raw.tokens_saved ?? raw.tokensSaved ?? 0,
      compressionRatio: raw.compression_ratio ?? raw.compressionRatio ?? 0,
      cacheHits: raw.cache_hits ?? raw.cacheHits ?? 0,
      transforms: raw.transforms ?? 0,
      raw,
    };
  } catch {
    return { error: `Failed to parse headroom perf JSON: ${stdout.slice(0, 200)}` };
  }
}

// ── Install ─────────────────────────────────────────────────────────────────

/**
 * Install Headroom via pip (preferred) or npm fallback.
 *
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, installed: boolean, version: string | null, method: string }>}
 */
export async function installHeadroom({ force = false } = {}) {
  // Check if already installed
  if (!force) {
    const { exitCode } = await runCmd('headroom', ['--version'], { timeout: 5000 });
    if (exitCode === 0) {
      const { stdout } = await runCmd('headroom', ['--version'], { timeout: 5000 });
      return { ok: true, installed: true, version: stdout.trim() || null, method: 'already-installed' };
    }
  }

  // Try pip first
  try {
    const { stdout: pipOut, exitCode: pipCode } = await runCmd(
      'pip',
      ['install', '--user', 'headroom-ai[all]'],
      { timeout: 120000 },
    );
    if (pipCode === 0) {
      const { stdout: verOut } = await runCmd('headroom', ['--version'], { timeout: 5000 });
      return {
        ok: true,
        installed: true,
        version: verOut.trim() || null,
        method: 'pip',
      };
    }
  } catch { /* fall through */ }

  // Fall back to npm
  try {
    const { stdout: npmOut, exitCode: npmCode } = await runCmd(
      'npm',
      ['install', '-g', 'headroom-ai'],
      { timeout: 120000 },
    );
    if (npmCode === 0) {
      const { stdout: verOut } = await runCmd('headroom', ['--version'], { timeout: 5000 });
      return {
        ok: true,
        installed: true,
        version: verOut.trim() || null,
        method: 'npm',
      };
    }
  } catch { /* fall through */ }

  return { ok: false, installed: false, version: null, method: 'none' };
}

// ── Wrap / Unwrap ───────────────────────────────────────────────────────────

/**
 * Run `headroom wrap opencode --port <port>` and persist the port.
 *
 * @param {{ port?: number }} [opts]
 * @returns {Promise<{ ok: boolean, port: number, pid?: number, log: string }>}
 */
export async function wrapOpencode({ port = DEFAULT_HEADROOM_PORT } = {}) {
  mkdirSync(BIZAR_CACHE, { recursive: true });
  writeFileSync(HEADROOM_PORT_FILE, String(port), 'utf8');

  const { stdout, stderr, exitCode } = await runCmd(
    'headroom',
    ['wrap', 'opencode', '--port', String(port)],
    { timeout: 30000 },
  );

  const ok = exitCode === 0;
  return {
    ok,
    port,
    log: ok ? stdout : `${stdout}\n${stderr}`.trim(),
  };
}

/**
 * Run `headroom unwrap opencode`.
 *
 * @returns {Promise<{ ok: boolean, log: string }>}
 */
export async function unwrapOpencode() {
  const { stdout, stderr, exitCode } = await runCmd(
    'headroom',
    ['unwrap', 'opencode'],
    { timeout: 30000 },
  );

  return { ok: exitCode === 0, log: `${stdout}\n${stderr}`.trim() };
}

// ── Proxy process management ────────────────────────────────────────────────

/** @type {Map<number, { pid: number }>} */
const _proxyProcesses = new Map();

/**
 * Start the Headroom proxy as a detached child process.
 *
 * @param {{ port?: number, host?: string }} [opts]
 * @returns {Promise<{ ok: boolean, pid: number | null, port: number, logPath: string }>}
 */
export async function startProxy({ port = DEFAULT_HEADROOM_PORT, host = DEFAULT_HEADROOM_HOST } = {}) {
  mkdirSync(BIZAR_CACHE, { recursive: true });
  writeFileSync(HEADROOM_PORT_FILE, String(port), 'utf8');

  const logPath = join(BIZAR_CACHE, `headroom-proxy-${port}.log`);

  return new Promise((resolve) => {
    const child = spawn(
      'headroom',
      ['proxy', '--port', String(port), '--host', host],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        cwd: HOME,
      },
    );

    let logWritten = false;
    function writeLog(text) {
      if (!logWritten) {
        try {
          writeFileSync(logPath, text, 'utf8');
          logWritten = true;
        } catch { /* ignore */ }
      }
    }

    child.stdout?.on('data', (d) => writeLog(d.toString()));
    child.stderr?.on('data', (d) => writeLog(d.toString()));

    child.on('error', (err) => {
      writeLog(`spawn error: ${err.message}`);
      resolve({ ok: false, pid: null, port, logPath });
    });

    // Give it a moment to fail
    setTimeout(() => {
      const pid = child.pid;
      if (pid) {
        _proxyProcesses.set(port, { pid });
        // Write PID file
        try {
          writeFileSync(join(BIZAR_CACHE, 'headroom.pid'), String(pid), 'utf8');
        } catch { /* ignore */ }
        resolve({ ok: true, pid, port, logPath });
      } else {
        resolve({ ok: false, pid: null, port, logPath });
      }
    }, 2000);
  });
}

/**
 * Stop the Headroom proxy process.
 *
 * @returns {Promise<{ ok: boolean, killed: number[] }>}
 */
export async function stopProxy() {
  const port = readHeadroomPort() || DEFAULT_HEADROOM_PORT;
  const killed = [];

  // Try PID file first
  const pidFile = join(BIZAR_CACHE, 'headroom.pid');
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
          killed.push(pid);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // Also kill by port lookup
  const pid = await findProxyPid(port);
  if (pid && !killed.includes(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      killed.push(pid);
    } catch { /* ignore */ }
  }

  // Try SIGKILL if SIGTERM didn't work
  for (const p of killed) {
    try {
      process.kill(p, 0); // check if still alive
    } catch {
      // process is gone
    }
  }

  // Clean up PID file
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  try { require('node:fs').unlinkSync(pidFile); } catch { /* ignore */ }
  _proxyProcesses.delete(port);

  return { ok: killed.length > 0, killed };
}

// ── Opencode config ─────────────────────────────────────────────────────────

/**
 * Read opencode.json and check for Headroom provider entry.
 *
 * @returns {Promise<{ configPath: string, hasHeadroomProvider: boolean, baseURL: string | null }>}
 */
export async function getOpencodeConfig() {
  const configPath = OPENCODE_JSON;
  if (!existsSync(configPath)) {
    return { configPath, hasHeadroomProvider: false, baseURL: null };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    const providers = raw?.provider || raw?.providers || {};
    const headroomProvider = providers?.headroom;
    const hasHeadroomProvider = Boolean(headroomProvider);
    const baseURL = headroomProvider?.baseURL || headroomProvider?.options?.baseURL || null;

    return { configPath, hasHeadroomProvider, baseURL };
  } catch {
    return { configPath, hasHeadroomProvider: false, baseURL: null };
  }
}

// ── Headroom proxy URL helper ───────────────────────────────────────────────

/**
 * If Headroom is enabled and the proxy is running, return the proxy URL
 * prepended to the given original URL. Otherwise returns the URL unchanged.
 *
 * Usage:
 *   const url = withHeadroomProxy('https://api.anthropic.com/v1/messages');
 *   // if headroom proxy is on 8787 → 'http://127.0.0.1:8787/v1/https://api.anthropic.com/v1/messages'
 *
 * This is a URL transformation: headroom proxy expects the target URL as
 * the path. We just return the transformed URL string; callers apply it.
 *
 * @param {string} url
 * @param {{ port?: number }} [opts]
 * @returns {string}
 */
export function withHeadroomProxy(url, { port = DEFAULT_HEADROOM_PORT } = {}) {
  // eslint-disable-next-line no-sync
  const settings = (() => {
    try {
      const s = readSettings();
      return s?.data?.headroom;
    } catch {
      return null;
    }
  })();

  if (!settings?.enabled) return url;
  if (!url) return url;

  // Only proxy OpenAI-compatible URLs (most providers use this)
  try {
    const parsed = new URL(url);
    // Don't re-proxy already-proxied URLs
    if (parsed.host === '127.0.0.1' || parsed.host === 'localhost') return url;
    const proxyBase = `http://${DEFAULT_HEADROOM_HOST}:${port}`;
    return `${proxyBase}/v1/${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

// ── Startup hook ───────────────────────────────────────────────────────────

/**
 * Headroom startup hook — called by server.mjs on dashboard boot.
 *
 * If `headroom.autoInstall` is true and Headroom is missing: install.
 * If `headroom.autoStart` is true and proxy isn't running: start proxy.
 * If `headroom.autoWrap` is true and opencode isn't wrapped: wrap.
 * If `headroom.routeAllProviders` is true: configure providers to use proxy.
 *
 * All errors are caught and logged — startup must not fail if Headroom
 * has issues.
 *
 * @param {import('../web/lib/types').HeadroomSettings} headroomSettings
 * @returns {Promise<{ installed: boolean, wrapped: boolean, proxied: boolean }>}
 */
export async function headroomStartupHook(headroomSettings) {
  const result = { installed: false, wrapped: false, proxied: false };

  try {
    const status = await getHeadroomStatus();

    // 1. Auto-install
    if (headroomSettings.autoInstall && !status.installed) {
      try {
        const inst = await installHeadroom();
        result.installed = inst.installed;
        if (inst.installed) {
          console.log('[headroom] Installed via', inst.method, inst.version || '');
        }
      } catch (err) {
        console.warn('[headroom] Auto-install failed:', err?.message || err);
      }
    } else {
      result.installed = status.installed;
    }

    // Re-check status after potential install
    const statusAfter = await getHeadroomStatus();

    // 2. Auto-start proxy
    if (headroomSettings.autoStart && !statusAfter.proxyRunning) {
      try {
        const port = headroomSettings.port || DEFAULT_HEADROOM_PORT;
        const host = headroomSettings.host || DEFAULT_HEADROOM_HOST;
        await startProxy({ port, host });
        console.log(`[headroom] Proxy started on ${host}:${port}`);
      } catch (err) {
        console.warn('[headroom] Auto-start proxy failed:', err?.message || err);
      }
    }

    // 3. Auto-wrap opencode
    if (headroomSettings.autoWrap && !statusAfter.wrapped) {
      try {
        const port = headroomSettings.port || DEFAULT_HEADROOM_PORT;
        const wrapped = await wrapOpencode({ port });
        result.wrapped = wrapped.ok;
        if (wrapped.ok) {
          console.log('[headroom] opencode wrapped on port', port);
        }
      } catch (err) {
        console.warn('[headroom] Auto-wrap failed:', err?.message || err);
      }
    } else {
      result.wrapped = statusAfter.wrapped;
    }

    // 4. Route all providers (handled at the provider level — mark flag)
    result.proxied = headroomSettings.routeAllProviders;
    if (headroomSettings.routeAllProviders) {
      console.log('[headroom] routeAllProviders enabled — configure provider baseURLs to point at the proxy');
    }
  } catch (err) {
    // Never let headroom failures crash the dashboard startup
    console.warn('[headroom] Startup hook error:', err?.message || err);
  }

  return result;
}
