/**
 * src/server/memory-lightrag.mjs
 *
 * v4.1.0 — LightRAG orchestrator for the Bizar Memory Service.
 *
 * Owns the local LightRAG server lifecycle (start, stop, health check,
 * query, insert) and bridges it to the markdown vault. Designed so the
 * dashboard, the CLI, and tests can all call the same surface.
 *
 * Lifecycle:
 *   - isInstalled()       — checks `lightrag-server` is on PATH
 *   - isRunning()         — GET /health
 *   - startServer()       — spawn detached, poll /health for up to 30s
 *   - stopServer()        — read PID file, SIGTERM then SIGKILL
 *   - ensureRunning()     — idempotent wrapper: returns immediately if
 *                            the server is already healthy
 *   - reindexVault()      — top-level: resolve vault → list notes →
 *                            ensure server → insert each → write marker
 *   - query()             — POST /query on the running server
 *
 * The server is started as a detached child with `stdio: ['ignore',
 * 'pipe', 'pipe']`; stdout + stderr are tee'd to
 * `<workingDir>/lightrag.log`. The PID is written to
 * `<workingDir>/lightrag.pid` for orphan detection + graceful shutdown.
 *
 * IDs are deterministic: a note at `decisions/foo.md` in projectId
 * `bizarharness` gets id `bizar://bizarharness/decisions/foo.md`. Re-running
 * reindexVault is idempotent because the server keys by this id.
 */

import {
  spawn,
  execFile,
} from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
  readdirSync,
  statSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';

import { atomicWriteJson } from './routes/_shared.mjs';
import { parseFrontmatter } from './yaml.mjs';
import { warn as logWarn } from './logger.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * v4.7.0 — Per-site log rate limiter for hot-path catches.
 *
 * Several empty catches below sit on stdout/stderr `data` handlers
 * that can fire dozens of times per second when LightRAG is chatty
 * (or the disk is slow). Without rate-limiting, a transient disk
 * hiccup floods the log with thousands of identical warnings and
 * hides the real problem underneath.
 *
 * Returns true the first time it's called for a key within `intervalMs`,
 * then false until the window passes. Default 60s — matches the
 * "if it's still broken, say it again a minute later" pattern.
 */
const _lastLog = new Map();
function _rateLimit(key, intervalMs = 60_000) {
  const now = Date.now();
  const last = _lastLog.get(key) || 0;
  if (now - last < intervalMs) return false;
  _lastLog.set(key, now);
  return true;
}

function deepMerge(target, source) {
  const out = { ...target };
  if (source === null || source === undefined) return out;
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * Read the last `n` lines of a text file.
 */
function readLogTail(filePath, n = 30) {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    return lines.slice(-n);
  } catch (err) {
    console.warn('[lightrag] swallowed in readLogTail:', err?.message || err);
    return [];
  }
}

const KNOWN_LLM_BINDINGS = new Set(['ollama', 'openai', 'lollms', 'azure_openai', 'bedrock', 'gemini']);
const KNOWN_EMBEDDING_BINDINGS = new Set(['ollama', 'openai', 'azure_openai', 'bedrock', 'jina', 'gemini', 'voyageai']);

export const LIGHTRAG_DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 9621,
  workingDir: null,        // resolved at runtime
  timeoutMs: 30_000,
  pollMs: 1_000,
  startupTimeoutMs: 30_000,
  llmBinding: 'ollama',     // ollama | openai | lollms | azure_openai | bedrock | gemini
  embeddingBinding: 'ollama', // ollama | openai | azure_openai | bedrock | jina | gemini | voyageai
  // v4.6.0 — Default to free cline Zen models (no API key required).
  // Per-project overrides via .bizar/memory.json#lightrag.{llmModel,embeddingModel}
  // or env vars BIZAR_LIGHTRAG_LLM / BIZAR_LIGHTRAG_EMBEDDING.
  llmModel: 'cline/gpt-5-nano',
  embeddingModel: 'cline/text-embedding-3-small',
  llmBindingHost: null,    // for non-ollama bindings
  embeddingBindingHost: null,
  apiKey: 'env',           // 'env' means read from env var; any other string is written to file
  apiKeySource: 'env',      // 'env' | 'file'
  /** When true, reindex writes a marker file with full stats. */
  writeMarker: true,
});

/**
 * Deep-merge a patch into the lightrag block of .bizar/memory.json.
 *
 * Validates:
 *   - llmBinding must be in KNOWN_LLM_BINDINGS
 *   - embeddingBinding must be in KNOWN_EMBEDDING_BINDINGS
 *   - port must be 1–65535
 *
 * Returns { ok, config, error? }.  The returned config is the full
 * merged memory.json (not redacted).
 *
 * If apiKey is the literal string '<empty>' the field is set to ''.
 * The apiKey field is never validated here — the UI decides what to send.
 */
export function writeLightRAGConfig(projectRoot, patch) {
  const memPath = join(projectRoot, '.bizar', 'memory.json');
  let mem = {};
  if (existsSync(memPath)) {
    try {
      mem = JSON.parse(readFileSync(memPath, 'utf8'));
    } catch {
      return { ok: false, error: 'memory.json is corrupt', config: null };
    }
  }

  // Resolve workingDir in patch before validation
  const resolvedPatch = { ...patch };
  if (resolvedPatch.workingDir) {
    if (resolvedPatch.workingDir.startsWith('~')) {
      resolvedPatch.workingDir = join(homedir(), resolvedPatch.workingDir.slice(1));
    } else if (!resolvedPatch.workingDir.startsWith('/')) {
      resolvedPatch.workingDir = join(projectRoot, resolvedPatch.workingDir);
    }
  }

  // Validate llmBinding
  if (resolvedPatch.llmBinding !== undefined && !KNOWN_LLM_BINDINGS.has(resolvedPatch.llmBinding)) {
    return { ok: false, error: `llmBinding must be one of: ${[...KNOWN_LLM_BINDINGS].join(', ')}`, config: null };
  }
  // Validate embeddingBinding
  if (resolvedPatch.embeddingBinding !== undefined && !KNOWN_EMBEDDING_BINDINGS.has(resolvedPatch.embeddingBinding)) {
    return { ok: false, error: `embeddingBinding must be one of: ${[...KNOWN_EMBEDDING_BINDINGS].join(', ')}`, config: null };
  }
  // Validate port
  if (resolvedPatch.port !== undefined) {
    const port = parseInt(resolvedPatch.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be an integer between 1 and 65535', config: null };
    }
  }

  // Canonicalise '<empty>' → ''
  if (resolvedPatch.apiKey === '<empty>') resolvedPatch.apiKey = '';

  const existing = mem.lightrag || {};
  const merged = deepMerge(existing, resolvedPatch);
  mem.lightrag = merged;

  try {
    mkdirSync(dirname(memPath), { recursive: true });
    atomicWriteJson(memPath, mem);
    return { ok: true, config: mem };
  } catch (err) {
    return { ok: false, error: err.message, config: null };
  }
}

/**
 * Redact apiKey for safe return to the UI.
 * If apiKey is non-empty, replace with '***'.
 */
function redactLightRAG(cfg) {
  if (!cfg) return cfg;
  return {
    ...cfg,
    apiKey: cfg.apiKey && cfg.apiKey !== '' ? '***' : cfg.apiKey || undefined,
  };
}

/**
 * v5.x — Detect which LLM provider is available for LightRAG.
 *
 * Decision order:
 *   1. If `llmBinding === 'ollama'`, do a quick async probe of
 *      localhost:11434 (or the configured `llmBindingHost`).
 *      If reachable → ollama available. If unreachable but an API key
 *      is configured for OpenAI / Anthropic / MiniMax → use that instead.
 *   2. For cloud bindings (openai / anthropic / minimax / etc.),
 *      check whether the corresponding env var is set. If yes → available.
 *   3. If no provider is detectable, return null and the caller logs
 *      a warning and skips reindex.
 *
 * Returns { provider, available, detail } or null.
 */
export async function detectAvailableLLM(config) {
  const binding = config.llmBinding || 'ollama';

  if (binding === 'ollama') {
    const ollamaHost = config.llmBindingHost || 'http://localhost:11434';
    // Quick async probe — give it 1.5s to connect.
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${ollamaHost}/`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok || res.status < 500) {
        return { provider: 'ollama', available: true, detail: ollamaHost };
      }
    } catch {
      // Fall through — ollama not reachable.
    }
    // ollama not reachable; check for cloud API keys as fallback.
    const hasOpenAI = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2);
    const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY_2);
    const hasMinimax = !!(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY_2);
    if (hasOpenAI || hasAnthropic || hasMinimax) {
      const provider = hasOpenAI ? 'openai' : hasAnthropic ? 'anthropic' : 'minimax';
      return { provider, available: true, detail: `${provider} (ollama unreachable, using API key)` };
    }
    return null; // no ollama, no API key
  }

  // Cloud bindings — available if API key is set.
  const apiKeyEnvVars = {
    openai: ['OPENAI_API_KEY', 'OPENAI_API_KEY_2'],
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_2'],
    minimax: ['MINIMAX_API_KEY', 'MINIMAX_API_KEY_2'],
    azure_openai: ['AZURE_OPENAI_API_KEY'],
    gemini: ['GEMINI_API_KEY'],
  };
  const relevantKeys = apiKeyEnvVars[binding] || [];
  const hasKey = relevantKeys.some((k) => process.env[k]);
  if (hasKey) {
    return { provider: binding, available: true, detail: binding };
  }

  return null; // configured binding but no key detected
}

/**
 * Resolve the LightRAG config for a project.
 * Pulls from `.bizar/memory.json` (lightrag block) and applies defaults.
 *
 * @param {string} projectRoot
 * @returns {{ enabled: boolean, host: string, port: number, workingDir: string, timeoutMs: number, pollMs: number, startupTimeoutMs: number, llmModel: string, embeddingModel: string, writeMarker: boolean, llmBinding: string, embeddingBinding: string, llmBindingHost: string|null, embeddingBindingHost: string|null, apiKey: string, apiKeySource: 'env'|'file' }}
 */
export function resolveLightRAGConfig(projectRoot) {
  const path = join(projectRoot, '.bizar', 'memory.json');
  let userCfg = {};
  if (existsSync(path)) {
    try {
      userCfg = JSON.parse(readFileSync(path, 'utf8')).lightrag || {};
    } catch (err) {
      console.warn('[lightrag] swallowed in resolveLightRAGConfig.readMemoryJson:', err?.message || err);
      userCfg = {};
    }
  }
  // Resolve workingDir:
  //   - empty/missing → <projectRoot>/.bizar/lightrag (default)
  //   - starts with ~  → expand to $HOME
  //   - absolute       → use as-is
  //   - relative       → resolve against projectRoot
  let workingDir;
  if (!userCfg.workingDir) {
    workingDir = join(projectRoot, '.bizar', 'lightrag');
  } else if (userCfg.workingDir.startsWith('~')) {
    workingDir = join(homedir(), userCfg.workingDir.slice(1));
  } else if (userCfg.workingDir.startsWith('/')) {
    workingDir = userCfg.workingDir;
  } else {
    workingDir = join(projectRoot, userCfg.workingDir);
  }

  return {
    enabled: userCfg.enabled !== false,
    host: userCfg.host || LIGHTRAG_DEFAULTS.host,
    port: userCfg.port || LIGHTRAG_DEFAULTS.port,
    workingDir,
    timeoutMs: userCfg.timeoutMs || LIGHTRAG_DEFAULTS.timeoutMs,
    pollMs: userCfg.pollMs || LIGHTRAG_DEFAULTS.pollMs,
    startupTimeoutMs: userCfg.startupTimeoutMs || LIGHTRAG_DEFAULTS.startupTimeoutMs,
    llmBinding: userCfg.llmBinding || LIGHTRAG_DEFAULTS.llmBinding,
    embeddingBinding: userCfg.embeddingBinding || LIGHTRAG_DEFAULTS.embeddingBinding,
    llmBindingHost: userCfg.llmBindingHost || null,
    embeddingBindingHost: userCfg.embeddingBindingHost || null,
    llmModel: userCfg.llmModel || LIGHTRAG_DEFAULTS.llmModel,
    embeddingModel: userCfg.embeddingModel || LIGHTRAG_DEFAULTS.embeddingModel,
    apiKey: userCfg.apiKey !== undefined ? userCfg.apiKey : LIGHTRAG_DEFAULTS.apiKey,
    apiKeySource: userCfg.apiKeySource || LIGHTRAG_DEFAULTS.apiKeySource,
    writeMarker: userCfg.writeMarker !== false,
  };
}

// ── Process management ─────────────────────────────────────────────────────

/**
 * Detect whether `lightrag-server` is on PATH. Returns the absolute
 * path or null. Uses `which`-style probing (POSIX `command -v`) and
 * common install dirs.
 */
export async function findLightragBinary() {
  const candidates = [
    `${homedir()}/.local/bin/lightrag-server`,
    `${homedir()}/.cargo/bin/lightrag-server`,
    '/usr/local/bin/lightrag-server',
    '/usr/bin/lightrag-server',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // v10-S9 — was sync execFileSync which froze the Node event loop for up
  // to 3s during boot. Convert to async so the dashboard can keep
  // serving requests while the `command -v` probe runs.
  try {
    const path = (await new Promise((resolve, reject) => {
      execFile('command', ['-v', 'lightrag-server'], { timeout: 3000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      });
    }));
    if (path) return path;
  } catch (err) {
    // command returned non-zero — fall through
    console.warn('[lightrag] swallowed in findLightragBinary.which:', err?.message || err);
  }
  return null;
}

export async function isInstalled() {
  const found = (await findLightragBinary()) !== null;
  if (found) _lightragNotInstalled = false;
  return found;
}

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

function httpPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith('https:') ? https : http;
      const u = new URL(url);
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: 'POST',
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (chunk) => (buf += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: buf }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`timeout after ${timeoutMs}ms`));
      });
      req.write(data);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * v5.x — Flag set when LightRAG is confirmed not installed or explicitly
 * disabled. When true, isRunning() returns false immediately without
 * making any network request, preventing ECONNREFUSED log spam from a
 * binary that will never be present.
 *
 * Reset by findLightragBinary() succeeding (e.g. after user installs
 * the binary without restarting the dashboard).
 */
let _lightragNotInstalled = false;

export async function isRunning(config) {
  // Fast path: skip network check if we already know LightRAG is absent.
  // This suppresses the ECONNREFUSED log spam that otherwise occurs on every
  // poll when the binary is not on PATH.
  if (_lightragNotInstalled) return false;
  try {
    const res = await httpGet(`http://${config.host}:${config.port}/health`, 3000);
    return res.status === 200;
  } catch (err) {
    // Rate-limit: only log once per 60s to avoid flooding the console
    // when LightRAG health-check fails repeatedly.
    if (_rateLimit('isRunning.healthCheck', 60_000)) {
      console.warn('[lightrag] isRunning healthCheck failed:', err?.message || err);
    }
    return false;
  }
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false; // already dead
    throw err;
  }
}

/**
 * Read PID file and check liveness. Returns { pid, alive }.
 */
function readPidAlive(pidFile) {
  if (!existsSync(pidFile)) return { pid: null, alive: false };
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return { pid: null, alive: false };
    const alive = killPid(pid, 0); // signal 0 = probe
    return { pid, alive };
  } catch (err) {
    console.warn('[lightrag] swallowed in readPidAlive:', err?.message || err);
    return { pid: null, alive: false };
  }
}

/**
 * Start the LightRAG server as a detached child.
 * Returns { ok, pid, logPath, error? }.
 */
export async function startServer(config, { logger } = {}) {
  const log = (...a) => logger?.info?.('[lightrag]', ...a) || logger?.log?.(...a) || console.log('[lightrag]', ...a);
  const err = (...a) => logger?.warn?.('[lightrag]', ...a) || console.error('[lightrag]', ...a);

  // Idempotent: if PID file has a live PID, do nothing.
  const pidFile = join(config.workingDir, 'lightrag.pid');
  const logFile = join(config.workingDir, 'lightrag.log');
  mkdirSync(config.workingDir, { recursive: true });
  const { pid: existing, alive: existingAlive } = readPidAlive(pidFile);
  if (existingAlive) {
    log(`server already running (pid ${existing})`);
    return { ok: true, pid: existing, logPath: logFile, alreadyRunning: true };
  }
  // Stale PID file → clean up.
  if (existing && !existingAlive) {
    try {
      unlinkSync(pidFile);
    } catch (err) {
      console.warn('[lightrag] swallowed in startServer.unlinkStalePid:', err?.message || err);
    }
  }

  if (!(await findLightragBinary())) {
    _lightragNotInstalled = true;
    return {
      ok: false,
      error:
        'lightrag-server not installed. Run `uv tool install "lightrag-hku[api]"` to install.',
    };
  }

  // Spawn detached so the parent's lifetime doesn't drag the server down.
  const bin = await findLightragBinary();
  log(`starting ${bin} on http://${config.host}:${config.port} (working-dir ${config.workingDir})`);

  const child = spawn(
    bin,
    [
      '--host', config.host,
      '--port', String(config.port),
      '--working-dir', config.workingDir,
      '--llm-binding', config.llmBinding || 'ollama',
      '--embedding-binding', config.embeddingBinding || 'ollama',
    ],
    {
      cwd: config.workingDir,
      env: {
        ...process.env,
        HOST: config.host,
        PORT: String(config.port),
        WORKING_DIR: config.workingDir,
        LLM_MODEL: config.llmModel,
        EMBEDDING_MODEL: config.embeddingModel,
        LLM_BINDING: config.llmBinding || 'ollama',
        EMBEDDING_BINDING: config.embeddingBinding || 'ollama',
        ...(config.llmBindingHost ? { LLM_BINDING_HOST: config.llmBindingHost } : {}),
        ...(config.embeddingBindingHost ? { EMBEDDING_BINDING_HOST: config.embeddingBindingHost } : {}),
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // Detach the child so it survives the parent exiting.
  child.unref();

  // Tee stdout + stderr to log file.
  let fd = -1;
  try {
    fd = openSync(logFile, 'a');
    child.stdout?.on('data', (d) => {
      try { writeSync(fd, d); } catch (err) {
        if (_rateLimit('lightrag-write-stdout')) logWarn('lightrag stream write failed (stdout)', { module: 'lightrag', err: err?.message || String(err) });
      }
    });
    child.stderr?.on('data', (d) => {
      try { writeSync(fd, d); } catch (err) {
        if (_rateLimit('lightrag-write-stderr')) logWarn('lightrag stream write failed (stderr)', { module: 'lightrag', err: err?.message || String(err) });
      }
    });
    child.on('exit', (code, signal) => {
      try { closeSync(fd); } catch (err) {
        if (_rateLimit('lightrag-close-fd')) logWarn('lightrag close fd failed', { module: 'lightrag', err: err?.message || String(err) });
      }
      try { unlinkSync(pidFile); } catch (err) {
        if (_rateLimit('lightrag-exit-unlink')) logWarn('lightrag pid unlink failed', { module: 'lightrag', err: err?.message || String(err) });
      }
      log(`lightrag-server exited (code=${code}, signal=${signal})`);
    });
  } catch (openErr) {
    err(`failed to open log file ${logFile}: ${openErr.message}`);
  }

  writeFileSync(pidFile, String(child.pid));

  // Poll /health until ready or timeout.
  const deadline = Date.now() + config.startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await isRunning(config)) {
      log(`lightrag-server ready on http://${config.host}:${config.port}`);
      return { ok: true, pid: child.pid, logPath: logFile };
    }
    await new Promise((r) => setTimeout(r, config.pollMs));
  }

  return {
    ok: false,
    pid: child.pid,
    logPath: logFile,
    error: `started but /health did not respond within ${config.startupTimeoutMs}ms`,
  };
}

/**
 * Stop the LightRAG server. SIGTERM, then SIGKILL after 5s.
 */
export async function stopServer(config, { logger } = {}) {
  const log = (...a) => logger?.info?.('[lightrag]', ...a) || console.log('[lightrag]', ...a);
  const pidFile = join(config.workingDir, 'lightrag.pid');
  const { pid, alive } = readPidAlive(pidFile);
  if (!pid || !alive) {
    try { unlinkSync(pidFile); } catch (err) {
      if (_rateLimit('lightrag-stop-notrunning-unlink')) logWarn('lightrag pid unlink failed (not running)', { module: 'lightrag', err: err?.message || String(err) });
    }
    return { ok: true, message: 'not running' };
  }
  log(`stopping lightrag-server (pid ${pid})`);
  killPid(pid, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 5000));
  if (killPid(pid, 0)) {
    log(`escalating to SIGKILL (pid ${pid})`);
    killPid(pid, 'SIGKILL');
  }
  try { unlinkSync(pidFile); } catch (err) {
    if (_rateLimit('lightrag-stop-unlink')) logWarn('lightrag pid unlink failed (stop)', { module: 'lightrag', err: err?.message || String(err) });
  }
  return { ok: true, message: 'stopped' };
}

/**
 * Idempotent: returns immediately if the server is healthy. Otherwise
 * starts it. Returns { ok, started, pid?, error? }.
 *
 * v5.x — Before starting, calls `detectAvailableLLM` to check whether
 * the configured LLM provider is reachable. If no provider is detected
 * (ollama unreachable + no API key), returns { ok: false } with a
 * descriptive error rather than starting LightRAG in a broken state.
 */
export async function ensureRunning(config, opts) {
  if (!config.enabled) {
    return { ok: false, started: false, error: 'lightrag disabled in .bizar/memory.json' };
  }
  if (await isRunning(config)) {
    return { ok: true, started: false };
  }
  // v5.x — probe LLM availability before attempting to start.
  const llm = await detectAvailableLLM(config);
  if (!llm) {
    const binding = config.llmBinding || 'ollama';
    return {
      ok: false,
      started: false,
      error: `lightrag cannot start: ${binding} is not reachable and no API key is configured. `
        + `Set an API key env var (OPENAI_API_KEY, ANTHROPIC_API_KEY, or MINIMAX_API_KEY) `
        + `or ensure ollama is running, then try again.`,
    };
  }
  const r = await startServer(config, opts);
  return { ok: r.ok, started: r.ok, pid: r.pid, error: r.error };
}

/**
 * v5.x — LightRAG startup hook (issue #6).
 *
 * Called by server.mjs on dashboard boot (and exposed via
 * `bizar lightrag autostart`). Reads the active project from
 * `state.projectRoot` (or whatever is passed in), resolves the
 * LightRAG config, and starts the server if the user's settings
 * allow it.
 *
 * Decision flow:
 *   1. Resolve config from .bizar/memory.json — if `lightrag.enabled`
 *      is `false`, skip silently (return ok=true, started=false,
 *      reason='disabled').
 *   2. Read the env override `BIZAR_LIGHTRAG_AUTOSTART` — if set to
 *      '0' / 'false' / 'no', skip.
 *   3. Check if the server is already running — if so, return
 *      ok=true, started=false, reason='already-running'.
 *   4. Probe LLM availability (detectAvailableLLM) — if unreachable
 *      AND no API key is configured, log a clear warning but still
 *      attempt to start the server (the user may have installed
 *      ollama mid-session or configured a key after boot).
 *   5. Call `startServer(config)` and return its result.
 *
 * Errors are caught and logged as warnings — startup must not fail
 * the dashboard just because LightRAG couldn't be started (the user
 * may not have the binary installed, may be running the dashboard
 * in an environment where LightRAG isn't needed, etc.).
 *
 * @param {string} projectRoot — path to the active project root
 *   (where `.bizar/memory.json` lives). When omitted, the hook
 *   returns ok=false with reason='no-project' (the caller didn't
 *   tell us where to look).
 * @param {{ logger?: { info?: Function, warn?: Function } }} [opts]
 * @returns {Promise<{ ok: boolean, started: boolean, pid?: number|null, reason?: string, error?: string }>}
 */
export async function lightragStartupHook(projectRoot, opts = {}) {
  const log = (...a) => opts?.logger?.info?.('[lightrag]', ...a) || console.log('[lightrag]', ...a);
  const warn = (...a) => opts?.logger?.warn?.('[lightrag]', ...a) || console.warn('[lightrag]', ...a);

  // 1. No project → can't resolve config.
  if (!projectRoot || typeof projectRoot !== 'string') {
    return { ok: false, started: false, reason: 'no-project' };
  }

  // 2. Resolve config (from .bizar/memory.json).
  let config;
  try {
    config = resolveLightRAGConfig(projectRoot);
  } catch (err) {
    warn('startup hook: failed to resolve config:', err?.message || err);
    return { ok: false, started: false, error: err?.message || String(err) };
  }

  // 3. Check lightrag.enabled flag.
  if (config.enabled === false) {
    _lightragNotInstalled = true;
    log('startup hook: lightrag disabled in .bizar/memory.json, skipping');
    return { ok: true, started: false, reason: 'disabled' };
  }

  // 4. Check env-var override.
  const envAuto = process.env.BIZAR_LIGHTRAG_AUTOSTART;
  if (typeof envAuto === 'string' && /^(0|false|no|off)$/i.test(envAuto.trim())) {
    _lightragNotInstalled = true;
    log(`startup hook: BIZAR_LIGHTRAG_AUTOSTART=${envAuto}, skipping`);
    return { ok: true, started: false, reason: 'env-disabled' };
  }

  // 5. Already running? Nothing to do.
  try {
    if (await isRunning(config)) {
      log('startup hook: lightrag already running');
      return { ok: true, started: false, reason: 'already-running' };
    }
  } catch (err) {
    warn('startup hook: isRunning probe failed:', err?.message || err);
  }

  // 6. Probe LLM availability — log a warning if unreachable + no API key,
  //    but still attempt to start (user may have installed ollama mid-session).
  const llm = await detectAvailableLLM(config);
  if (!llm) {
    const binding = config.llmBinding || 'ollama';
    warn(
      `startup hook: ${binding} is not reachable and no API key is configured. ` +
        `LightRAG may start in a degraded state. ` +
        `Set an API key env var (OPENAI_API_KEY, ANTHROPIC_API_KEY, or MINIMAX_API_KEY) ` +
        `or ensure ollama is running.`,
    );
  } else {
    log(`startup hook: LLM detected: ${llm.provider} (${llm.detail})`);
  }

  // 7. Try to start — still attempt even if LLM probe failed (see step 6 note).
  try {
    const r = await startServer(config, opts);
    if (r.ok) {
      if (r.alreadyRunning) {
        log(`startup hook: lightrag already running (pid=${r.pid})`);
        return { ok: true, started: false, reason: 'already-running', pid: r.pid };
      }
      log(`startup hook: lightrag started (pid=${r.pid})`);
      return { ok: true, started: true, pid: r.pid };
    }
    warn(`startup hook: start failed: ${r.error || 'unknown'}`);
    return { ok: false, started: false, error: r.error || 'start failed' };
  } catch (err) {
    // Catch-all: dashboard boot must not fail because LightRAG couldn't
    // start. Common causes: binary missing (lightrag-server not on PATH),
    // port already in use, working-dir not writable.
    warn('startup hook: caught error:', err?.message || err);
    return { ok: false, started: false, error: err?.message || String(err) };
  }
}

// ── Document insertion ────────────────────────────────────────────────────

/**
 * Build a deterministic id for a note: `bizar://<projectId>/<relPath>`.
 * The `bizar://` URI scheme is internal — LightRAG uses it as a stable key.
 */
function buildDocId(projectId, relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `bizar://${projectId}/${normalized}`;
}

/**
 * Build the document text LightRAG will index. We prefix with metadata
 * lines so semantic queries can return "what kind of note was this?"
 * context even when only a snippet survives the chunker.
 */
function buildDocText(projectId, relPath, note) {
  const fm = note.frontmatter || {};
  const tags = Array.isArray(fm.tags) ? fm.tags.join(', ') : (fm.tags || '');
  const lines = [
    `Source: bizar://${projectId}/${relPath.replace(/^\/+/, '')}`,
    `Project: ${fm.project_id || projectId}`,
    `Type: ${fm.type || 'unknown'}`,
    `Status: ${fm.status || 'unknown'}`,
    `Confidence: ${fm.confidence || 'unknown'}`,
    `Tags: ${tags}`,
    `Memory ID: ${fm.memory_id || ''}`,
    '',
    note.body || '',
  ];
  return lines.join('\n');
}

/**
 * Insert one note into LightRAG. Returns { ok, trackId, error? }.
 *
 * LightRAG's HTTP API for inserting a single document is
 * `POST /documents` (text in body, optional `file_source` for tracking).
 * We send: { text, file_source: docId }.
 */
export async function insertNote(config, projectId, note) {
  if (!note?.relPath) return { ok: false, error: 'note.relPath required' };
  const docId = buildDocId(projectId, note.relPath);
  const text = buildDocText(projectId, note.relPath, note);

  const url = `http://${config.host}:${config.port}/documents/text`;
  const body = {
    text,
    file_source: docId,
  };
  try {
    const res = await httpPost(url, body, config.timeoutMs);
    if (res.status >= 200 && res.status < 300) {
      let parsed;
      try { parsed = JSON.parse(res.body); } catch { parsed = { raw: res.body }; }
      return { ok: true, trackId: docId, response: parsed };
    }
    return { ok: false, trackId: docId, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, trackId: docId, error: err.message };
  }
}

/**
 * Insert all notes. Returns aggregate { inserted, failed, durationMs }.
 *
 * Sequential insertion — LightRAG's API is request-per-document and
 * concurrent inserts may overwhelm the embedder. For 100+ notes we
 * could batch; for the BizarHarness KB (15-30 notes), sequential is fine.
 */
export async function insertAllNotes(config, projectId, notes, { logger } = {}) {
  const log = (...a) => logger?.info?.('[lightrag]', ...a) || logger?.log?.(...a) || console.log('[lightrag]', ...a);
  const start = Date.now();
  let inserted = 0;
  let failed = 0;
  const failures = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const r = await insertNote(config, projectId, note);
    if (r.ok) {
      inserted++;
    } else {
      failed++;
      failures.push({ relPath: note.relPath, error: r.error });
    }
    if ((i + 1) % 10 === 0 || i === notes.length - 1) {
      log(`progress: ${i + 1}/${notes.length} (inserted=${inserted}, failed=${failed})`);
    }
  }
  return { inserted, failed, failures, durationMs: Date.now() - start };
}

// ── Top-level orchestrators ────────────────────────────────────────────────

/**
 * Reindex the entire vault into LightRAG.
 *
 * 1. Resolve config + vault.
 * 2. List notes from disk.
 * 3. Ensure server is running (auto-start).
 * 4. Insert each note.
 * 5. Write marker file with stats.
 *
 * Returns { ok, started, inserted, failed, failures, durationMs, startedAt,
 *          markerPath, error? }.
 */
export async function reindexVault(projectRoot, opts = {}) {
  const startedAt = new Date().toISOString();
  // Resolve config + vault by reading memory.json directly to avoid
  // pulling in memory-store (which itself imports this module — would cycle).
  const config = resolveLightRAGConfig(projectRoot);
  if (!config.enabled) {
    return { ok: false, started: false, error: 'lightrag disabled in .bizar/memory.json' };
  }

  // Ensure vault dir exists; list notes.
  const memPath = join(projectRoot, '.bizar', 'memory.json');
  if (!existsSync(memPath)) {
    return { ok: false, error: 'memory not initialized — run `bizar memory init` first' };
  }
  const mem = JSON.parse(readFileSync(memPath, 'utf8'));
  const mode = mem.memoryRepo?.mode || 'local-only';
  let vaultRoot;
  let projectId = mem.projectId || basename(projectRoot);
  if (mode === 'local-only') {
    vaultRoot = join(projectRoot, '.obsidian');
  } else {
    const rawPath = mem.memoryRepo?.path || '';
    let expanded;
    if (!rawPath) {
      expanded = join(projectRoot, '.bizar', 'memory');
    } else if (rawPath.startsWith('~')) {
      expanded = join(homedir(), rawPath.slice(1));
    } else if (rawPath.startsWith('/')) {
      expanded = rawPath;
    } else {
      expanded = join(projectRoot, rawPath);
    }
    vaultRoot = join(expanded, 'projects', projectId);
  }
  if (!existsSync(vaultRoot)) {
    return { ok: false, error: `vault not found at ${vaultRoot} — run \`bizar memory init\`` };
  }

  // Collect all .md files in vault (skip dotfiles).
  const notes = [];
  function walk(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.name.endsWith('.md')) {
        const raw = readFileSync(full, 'utf8');
        const { frontmatter, body } = parseFrontmatter(raw);
        notes.push({ relPath: rel, frontmatter, body });
      }
    }
  }
  walk(vaultRoot, '');

  // Always write a marker (even on failure) so `bizar memory status`
  // can report when the last attempt was.
  const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
  mkdirSync(cacheDir, { recursive: true });
  const markerPath = join(cacheDir, 'last-reindex.json');
  const writeMarker = (extra) => {
    if (!config.writeMarker) return;
    const marker = {
      attemptedAt: startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      ok: false,
      noteCount: notes.length,
      inserted: 0,
      failed: 0,
      failures: [],
      lightrag: {
        host: config.host,
        port: config.port,
        workingDir: config.workingDir,
      },
      ...extra,
    };
    atomicWriteJson(markerPath, marker);
  };

  // Ensure server is up.
  const runResult = await ensureRunning(config, opts);
  if (!runResult.ok) {
    const reason = runResult.error || 'lightrag not running';
    writeMarker({ error: reason, ok: false });
    return {
      ok: false,
      started: false,
      error: reason,
      noteCount: notes.length,
      markerPath,
      startedAt,
    };
  }

  // Insert all notes.
  const result = await insertAllNotes(config, projectId, notes, opts);

  // Write success marker.
  writeMarker({
    durationMs: result.durationMs,
    ok: result.failed === 0,
    started: runResult.started,
    pid: runResult.pid,
    projectId,
    vaultRoot,
    inserted: result.inserted,
    failed: result.failed,
    failures: result.failures.slice(0, 50),
  });

  return {
    ok: result.failed === 0,
    started: runResult.started,
    pid: runResult.pid,
    inserted: result.inserted,
    failed: result.failed,
    failures: result.failures,
    durationMs: result.durationMs,
    noteCount: notes.length,
    markerPath,
    startedAt,
  };
}

/**
 * v5.x — Re-index a single note into LightRAG.
 *
 * Use this for incremental updates (e.g. after a note is written or
 * updated via the REST API). Unlike `reindexVault` which walks the entire
 * vault, this only inserts one document.
 *
 * Returns { ok, inserted, failed, error? }.
 */
export async function reindexSingleNote(projectRoot, relPath, opts = {}) {
  const config = resolveLightRAGConfig(projectRoot);
  if (!config.enabled) {
    return { ok: false, error: 'lightrag disabled' };
  }

  // Resolve vault path (same logic as reindexVault).
  const memPath = join(projectRoot, '.bizar', 'memory.json');
  if (!existsSync(memPath)) {
    return { ok: false, error: 'memory not initialized' };
  }
  const mem = JSON.parse(readFileSync(memPath, 'utf8'));
  const mode = mem.memoryRepo?.mode || 'local-only';
  let vaultRoot;
  const projectId = mem.projectId || basename(projectRoot);
  if (mode === 'local-only') {
    vaultRoot = join(projectRoot, '.obsidian');
  } else {
    const rawPath = mem.memoryRepo?.path || '';
    let expanded;
    if (!rawPath) {
      expanded = join(projectRoot, '.bizar', 'memory');
    } else if (rawPath.startsWith('~')) {
      expanded = join(homedir(), rawPath.slice(1));
    } else if (rawPath.startsWith('/')) {
      expanded = rawPath;
    } else {
      expanded = join(projectRoot, rawPath);
    }
    vaultRoot = join(expanded, 'projects', projectId);
  }

  const fullPath = join(vaultRoot, relPath);
  if (!fullPath.startsWith(vaultRoot)) {
    return { ok: false, error: 'path traversal attempt blocked' };
  }
  if (!existsSync(fullPath)) {
    return { ok: false, error: `note not found: ${relPath}` };
  }

  // Ensure server is running (uses the same LLM-detection logic as reindexVault).
  const runResult = await ensureRunning(config, opts);
  if (!runResult.ok) {
    return { ok: false, error: runResult.error || 'lightrag server unavailable' };
  }

  const raw = readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  const note = { relPath, frontmatter, body };
  const r = await insertNote(config, projectId, note);

  return {
    ok: r.ok,
    inserted: r.ok ? 1 : 0,
    failed: r.ok ? 0 : 1,
    error: r.error,
  };
}

/**
 * Query LightRAG. Returns { ok, mode, response, error? }.
 *
 * LightRAG's `/query` endpoint accepts:
 *   { query: string, mode?: 'local'|'global'|'hybrid'|'mix', top_k?: number,
 *     conversation_history?: [], user_prompt?: string, response_type?: string }
 */
export async function query(config, question, { mode = 'mix', topK = 10 } = {}) {
  if (!config.enabled) {
    return { ok: false, error: 'lightrag disabled in .bizar/memory.json' };
  }
  if (!(await isRunning(config))) {
    return { ok: false, error: 'lightrag server not running — run `bizar memory reindex` first' };
  }
  const url = `http://${config.host}:${config.port}/query`;
  try {
    const res = await httpPost(url, {
      query: question,
      mode,
      top_k: topK,
      response_type: 'Multiple Paragraphs',
    }, config.timeoutMs);
    if (res.status >= 200 && res.status < 300) {
      let parsed;
      try { parsed = JSON.parse(res.body); } catch { parsed = { response: res.body }; }
      return { ok: true, mode, response: parsed };
    }
    return { ok: false, mode, error: `HTTP ${res.status}: ${res.body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, mode, error: err.message };
  }
}

// ── v4.7.0 — Memory tab helpers ─────────────────────────────────────────────
//
// Lightweight status / stats / rebuild helpers used by the dedicated Memory
// view. The full reindexVault path above already produces a marker file with
// most of the numbers we want; these helpers are thin wrappers around it.

/**
 * Aggregate stats for the Memory → LightRAG panel.
 *
 * Pulls from:
 *   - the last-reindex.json marker file (writeMarker: true leaves it)
 *   - the configured working dir (where chunks/index files live)
 *   - the running server (PID, alive)
 *
 * Returns a defensive default when nothing has been indexed yet.
 *
 * @param {string} projectRoot
 * @returns {{
 *   running: boolean,
 *   pid: number|null,
 *   host: string,
 *   port: number,
 *   workingDir: string,
 *   lastReindexAt: string|null,
 *   lastReindexOk: boolean|null,
 *   lastReindexInserted: number|null,
 *   lastReindexFailed: number|null,
 *   noteCount: number,
 *   indexedApprox: number,
 *   queryCountLast24h: number,
 *   avgResponseMs: number|null,
 *   error?: string,
 * }}
 */
export async function stats(projectRoot) {
  const config = resolveLightRAGConfig(projectRoot);
  const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
  const markerPath = join(cacheDir, 'last-reindex.json');
  const running = await isRunning(config);
  let pid = null;
  const pidFile = join(config.workingDir, 'lightrag.pid');
  if (existsSync(pidFile)) {
    const parsed = parseIntSafe(readFileSync(pidFile, 'utf8'));
    if (parsed !== null && parsed > 0) {
      try {
        process.kill(parsed, 0);
        pid = parsed;
      } catch (err) {
        console.warn('[lightrag] swallowed in stats.pidProbe:', err?.message || err);
        pid = null;
      }
    }
  }

  let lastReindexAt = null;
  let lastReindexOk = null;
  let lastReindexInserted = null;
  let lastReindexFailed = null;
  if (existsSync(markerPath)) {
    try {
      const m = JSON.parse(readFileSync(markerPath, 'utf8'));
      lastReindexAt = m.finishedAt || m.attemptedAt || null;
      lastReindexOk = m.ok === true;
      lastReindexInserted = typeof m.inserted === 'number' ? m.inserted : null;
      lastReindexFailed = typeof m.failed === 'number' ? m.failed : null;
    } catch (err) {
      console.warn('[lightrag] swallowed in stats.markerRead:', err?.message || err);
    }
  }

  // Approximate the indexed chunk count from the on-disk KV store. LightRAG
  // writes its chunks to <workingDir>/kv_store_*.json. We sum the lengths of
  // the document store as a proxy for "indexed documents"; this is best-effort
  // and clearly labeled as approximate.
  let indexedApprox = 0;
  try {
    const docStore = join(config.workingDir, 'kv_store_doc_status.json');
    const fullDocs = join(config.workingDir, 'kv_store_full_docs.json');
    for (const p of [docStore, fullDocs]) {
      if (existsSync(p)) {
        try {
          const obj = JSON.parse(readFileSync(p, 'utf8'));
          indexedApprox += Object.keys(obj || {}).length;
        } catch (err) {
          console.warn('[lightrag] swallowed in stats.kvStoreRead:', err?.message || err);
        }
      }
    }
  } catch (err) {
    console.warn('[lightrag] swallowed in stats.kvStoreScan:', err?.message || err);
  }

  // Note count = listNotes from the vault.
  let noteCount = 0;
  try {
    const memPath = join(projectRoot, '.bizar', 'memory.json');
    if (existsSync(memPath)) {
      const mem = JSON.parse(readFileSync(memPath, 'utf8'));
      const projectId = mem.projectId || '';
      const mode = mem.memoryRepo?.mode || 'local-only';
      let vaultRoot;
      if (mode === 'local-only') {
        vaultRoot = join(projectRoot, '.obsidian');
      } else {
        const raw = mem.memoryRepo?.path || '';
        let expanded;
        if (!raw) expanded = join(projectRoot, '.bizar', 'memory');
        else if (raw.startsWith('~')) expanded = join(homedir(), raw.slice(1));
        else if (raw.startsWith('/')) expanded = raw;
        else expanded = join(projectRoot, raw);
        vaultRoot = join(expanded, 'projects', projectId);
      }
      if (existsSync(vaultRoot)) {
        const { readdirSync } = await import('node:fs');
        function walk(dir) {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue;
            const full = join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.md')) noteCount++;
          }
        }
        walk(vaultRoot);
      }
    }
  } catch (err) {
    console.warn('[lightrag] swallowed in stats.noteCount:', err?.message || err);
  }

  // Query stats: best-effort — LightRAG's /query endpoint doesn't expose
  // query counts in the open-core build. We track our own running counter
  // in a sidecar JSON file.
  const queryLogPath = join(cacheDir, 'lightrag-query-log.jsonl');
  let queryCountLast24h = 0;
  let totalResponseMs = 0;
  let counted = 0;
  if (existsSync(queryLogPath)) {
    try {
      const lines = readFileSync(queryLogPath, 'utf8').split('\n').filter(Boolean);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (typeof rec.ts === 'number' && rec.ts >= cutoff) {
            queryCountLast24h++;
            if (typeof rec.ms === 'number' && Number.isFinite(rec.ms)) {
              totalResponseMs += rec.ms;
              counted++;
            }
          }
        } catch (err) {
          console.warn('[lightrag] swallowed in stats.queryLogLine:', err?.message || err);
        }
      }
    } catch (err) {
      console.warn('[lightrag] swallowed in stats.queryLogRead:', err?.message || err);
    }
  }
  const avgResponseMs = counted > 0 ? Math.round(totalResponseMs / counted) : null;

  return {
    running,
    pid: running ? pid : null,
    host: config.host,
    port: config.port,
    workingDir: config.workingDir,
    lastReindexAt,
    lastReindexOk,
    lastReindexInserted,
    lastReindexFailed,
    noteCount,
    indexedApprox,
    queryCountLast24h,
    avgResponseMs,
  };
}

function parseIntSafe(s) {
  const n = parseInt(String(s || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Record a query for stats tracking. Called by the /query endpoint so the
 * Memory tab can show usage. Best-effort; never throws.
 *
 * @param {string} projectRoot
 * @param {number} durationMs
 */
export function recordQuery(projectRoot, durationMs) {
  try {
    const cacheDir = join(projectRoot, '.bizar', 'memory-cache');
    mkdirSync(cacheDir, { recursive: true });
    const path = join(cacheDir, 'lightrag-query-log.jsonl');
    appendFileSafe(path, JSON.stringify({ ts: Date.now(), ms: Math.max(0, Math.round(durationMs)) }) + '\n');
    // Truncate if file grows past 5MB — keep last ~50k queries.
    try {
      const st = statMaybe(path);
      if (st && st.size > 5 * 1024 * 1024) {
        const content = readFileSync(path, 'utf8');
        const lines = content.split('\n');
        const keep = lines.slice(-50000).join('\n');
        writeFileSync(path, keep);
      }
    } catch (err) {
      console.warn('[lightrag] swallowed in recordQuery.truncate:', err?.message || err);
    }
  } catch (err) {
    console.warn('[lightrag] swallowed in recordQuery:', err?.message || err);
  }
}

function appendFileSafe(path, content) {
  try {
    appendFileSync(path, content);
  } catch (err) {
    console.warn('[lightrag] appendFileSync failed, falling back to read+write:', err?.message || err);
    try {
      const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
      writeFileSync(path, cur + content);
    } catch (err2) {
      console.warn('[lightrag] swallowed in appendFileSafe.manualWrite:', err2?.message || err2);
    }
  }
}

function statMaybe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Get a graph representation of the LightRAG index.
 *
 * If `root` is given, fetches entities reachable within `depth` hops
 * from that entity via LightRAG's /graph endpoint. Otherwise returns
 * all entities up to `limit`.
 *
 * Falls back to reading .bizar/memory/lightrag/kv_store_*.json directly
 * when the LightRAG server is unavailable.
 *
 * @param {{ projectRoot: string, root?: string|null, depth?: number, limit?: number }}
 * @returns {Promise<{nodes: Array<{id:string,label:string,type:string,size:number,group:string}>, edges: Array<{source:string,target:string,type:string,weight:number}>}>}
 */
export async function getLightRAGGraph({ projectRoot, root = null, depth = 2, limit = 200 }) {
  const config = resolveLightRAGConfig(projectRoot);

  // Attempt to query the running server.
  if (await isRunning(config)) {
    try {
      const nodes = [];
      const edges = [];

      if (root) {
        // Use LightRAG's /graph endpoint with root entity.
        const url = `http://${config.host}:${config.port}/graph?root=${encodeURIComponent(root)}&depth=${depth}&limit=${limit}`;
        const res = await httpGet(url, config.timeoutMs);
        if (res.status === 200) {
          let parsed;
          try { parsed = JSON.parse(res.body); } catch { parsed = {}; }
          // LightRAG /graph shape varies; normalise to our contract.
          // LightRAG returns { entities: [...], relations: [...] } or similar.
          const ents = parsed.entities || parsed.nodes || [];
          const rels = parsed.relations || parsed.edges || [];
          for (const e of ents.slice(0, limit)) {
            const id = String(e.id || e.name || JSON.stringify(e));
            nodes.push({
              id,
              label: String(e.label || e.name || id).slice(0, 60),
              type: String(e.type || 'entity'),
              size: Number(e.size || 1),
              group: String(e.group || e.type || 'default'),
            });
          }
          for (const r of rels) {
            edges.push({
              source: String(r.source || r.from || r.src || ''),
              target: String(r.target || r.to || r.dst || ''),
              type: String(r.type || 'related'),
              weight: Number(r.weight || 1),
            });
          }
          return { nodes, edges };
        }
      } else {
        // Return all entities from kv_store_full_docs.json.
        const docsPath = join(config.workingDir, 'kv_store_full_docs.json');
        if (existsSync(docsPath)) {
          try {
            const docs = JSON.parse(readFileSync(docsPath, 'utf8'));
            const keys = Object.keys(docs || {}).slice(0, limit);
            // Group by top-level path segment as a proxy for group.
            for (const k of keys) {
              const parts = k.replace(/^bizar:\/\//, '').split('/');
              const group = parts.length > 1 ? parts[0] : 'root';
              nodes.push({
                id: k,
                label: parts[parts.length - 1].replace(/[_-]/g, ' '),
                type: 'note',
                size: 1,
                group,
              });
            }
            return { nodes, edges };
          } catch (err) {
            console.warn('[lightrag] getLightRAGGraph fallback read failed:', err?.message);
          }
        }
      }
    } catch (err) {
      console.warn('[lightrag] getLightRAGGraph server query failed, falling back:', err?.message);
    }
  }

  // Fallback: read kv_store files directly.
  const nodes = [];
  const edges = [];
  try {
    const docsPath = join(config.workingDir, 'kv_store_full_docs.json');
    if (existsSync(docsPath)) {
      const docs = JSON.parse(readFileSync(docsPath, 'utf8'));
      const keys = Object.keys(docs || {}).slice(0, limit);
      for (const k of keys) {
        const parts = k.replace(/^bizar:\/\//, '').split('/');
        const group = parts.length > 1 ? parts[0] : 'root';
        nodes.push({
          id: k,
          label: parts[parts.length - 1].replace(/[_-]/g, ' '),
          type: 'note',
          size: 1,
          group,
        });
      }
    }
  } catch (err) {
    console.warn('[lightrag] getLightRAGGraph fallback read error:', err?.message);
  }
  return { nodes, edges };
}

/**
 * Rebuild the graph from scratch. Stops the server, wipes the working dir,
 * and re-runs reindexVault. Returns { ok, started, error?, markerPath? }.
 *
 * Idempotent: safe to call when the server is already stopped.
 *
 * @param {string} projectRoot
 * @param {{ logger?: { info?: Function, warn?: Function } }} [opts]
 */
export async function rebuildGraph(projectRoot, opts = {}) {
  const config = resolveLightRAGConfig(projectRoot);
  // Stop server first.
  await stopServer(config, opts).catch(() => {});
  // Wipe the working dir contents (preserve the dir itself).
  try {
    const { readdirSync } = await import('node:fs');
    if (existsSync(config.workingDir)) {
      for (const e of readdirSync(config.workingDir)) {
        try {
          unlinkSync(join(config.workingDir, e));
        } catch (err) {
          console.warn('[lightrag] swallowed in rebuildGraph.unlinkEntry:', err?.message || err);
        }
      }
    }
  } catch (err) {
    console.warn('[lightrag] swallowed in rebuildGraph.wipe:', err?.message || err);
  }
  // Reindex from scratch.
  return reindexVault(projectRoot, opts);
}