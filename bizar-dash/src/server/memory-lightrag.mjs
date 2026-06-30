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
  execFileSync,
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
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';

import { atomicWriteJson } from './routes/_shared.mjs';
import { parseFrontmatter } from './yaml.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  } catch {
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
  llmModel: 'minimax/MiniMax-M3',
  embeddingModel: 'text-embedding-3-small',
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
    } catch {
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
export function findLightragBinary() {
  const candidates = [
    `${homedir()}/.local/bin/lightrag-server`,
    `${homedir()}/.cargo/bin/lightrag-server`,
    '/usr/local/bin/lightrag-server',
    '/usr/bin/lightrag-server',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const path = execFileSync('command', ['-v', 'lightrag-server'], {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    if (path) return path;
  } catch {
    // command returned non-zero — fall through
  }
  return null;
}

export async function isInstalled() {
  return findLightragBinary() !== null;
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

export async function isRunning(config) {
  try {
    const res = await httpGet(`http://${config.host}:${config.port}/health`, 3000);
    return res.status === 200;
  } catch {
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
  } catch {
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
    } catch {}
  }

  if (!findLightragBinary()) {
    return {
      ok: false,
      error:
        'lightrag-server not installed. Run `uv tool install "lightrag-hku[api]"` to install.',
    };
  }

  // Spawn detached so the parent's lifetime doesn't drag the server down.
  const bin = findLightragBinary();
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
    child.stdout?.on('data', (d) => { try { writeSync(fd, d); } catch {} });
    child.stderr?.on('data', (d) => { try { writeSync(fd, d); } catch {} });
    child.on('exit', (code, signal) => {
      try { closeSync(fd); } catch {}
      try { unlinkSync(pidFile); } catch {}
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
    try { unlinkSync(pidFile); } catch {}
    return { ok: true, message: 'not running' };
  }
  log(`stopping lightrag-server (pid ${pid})`);
  killPid(pid, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 5000));
  if (killPid(pid, 0)) {
    log(`escalating to SIGKILL (pid ${pid})`);
    killPid(pid, 'SIGKILL');
  }
  try { unlinkSync(pidFile); } catch {}
  return { ok: true, message: 'stopped' };
}

/**
 * Idempotent: returns immediately if the server is healthy. Otherwise
 * starts it. Returns { ok, started, pid?, error? }.
 */
export async function ensureRunning(config, opts) {
  if (!config.enabled) {
    return { ok: false, started: false, error: 'lightrag disabled in .bizar/memory.json' };
  }
  if (await isRunning(config)) {
    return { ok: true, started: false };
  }
  const r = await startServer(config, opts);
  return { ok: r.ok, started: r.ok, pid: r.pid, error: r.error };
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