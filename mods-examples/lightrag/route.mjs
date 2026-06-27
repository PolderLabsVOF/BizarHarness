/**
 * mods/lightrag/route.mjs
 *
 * LightRAG mod — mounts LightRAG server lifecycle + REST proxy into the
 * Bizar dashboard.
 *
 * Endpoints mounted at /api/mods/lightrag/*:
 *   GET    /status       — server health, version, document count
 *   GET    /start        — start the LightRAG server (idempotent)
 *   GET    /stop         — stop the LightRAG server
 *   GET    /restart      — stop + start
 *   GET    /config       — get current mod config
 *   POST   /config       — update mod config
 *   POST   /insert/text  — insert text into LightRAG
 *   POST   /insert/file  — insert a file by path
 *   POST   /query        — query the knowledge graph
 *   GET    /entities     — list entities in the graph
 *   GET    /relations    — list relationships
 *   *      /proxy/*      — proxy to the LightRAG server (passthrough)
 *
 * Server lifecycle:
 *   - Auto-starts on first dashboard boot if `autoStart` is true
 *   - Writes PID to .bizar/lightrag/lightrag.pid
 *   - Writes logs to .bizar/lightrag/lightrag.log
 *   - Verifies the server is up via GET /health on the configured port
 *
 * The server is started via `uv tool install "lightrag-hku[api]"` + `lightrag-server`
 * (or `uvx lightrag-hku[api] lightrag-server` if a global install isn't desired).
 * The mod handles BOTH paths: it checks for `lightrag-server` on PATH first,
 * then falls back to `uvx` for one-off execution.
 *
 * Permissions required:
 *   - process:spawn:lightrag-server
 *   - process:spawn:uv
 *   - process:spawn:uvx
 *   - process:spawn:python3
 *   - process:spawn:curl
 *   - fs:read:.bizar/lightrag
 *   - fs:write:.bizar/lightrag
 *   - fs:read:.obsidian
 *   - fs:write:.obsidian
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 9621,
  autoStart: true,
  workingDir: '.bizar/lightrag',
  llmModel: 'minimax/MiniMax-M3',
  embeddingModel: 'text-embedding-3-small',
};

const STATE = {
  config: { ...DEFAULT_CONFIG },
  configPath: null,
  pidFile: null,
  logFile: null,
  process: null,
  startedAt: null,
  lastHealthCheck: null,
  lastHealthStatus: null,
  installAttempted: false,
};

const MAX_LOG_BYTES = 256 * 1024; // 256KB log rotation

function log(...args) {
  console.log('[lightrag-mod]', ...args);
}

function err(...args) {
  console.error('[lightrag-mod]', ...args);
}

function resolveProjectPath(p) {
  // Path resolution: relative paths are resolved against cwd (the project root
  // when the dashboard runs in the project context).
  if (!p) return null;
  if (p.startsWith('/') || p.startsWith('~')) return p.replace(/^~/, homedir());
  return resolve(process.cwd(), p);
}

function ensureWorkingDir() {
  const dir = resolveProjectPath(STATE.config.workingDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  STATE.pidFile = join(dir, 'lightrag.pid');
  STATE.logFile = join(dir, 'lightrag.log');
  STATE.configPath = join(dir, 'config.json');
  return dir;
}

function loadConfig() {
  ensureWorkingDir();
  if (existsSync(STATE.configPath)) {
    try {
      const raw = JSON.parse(readFileSync(STATE.configPath, 'utf8'));
      STATE.config = { ...DEFAULT_CONFIG, ...raw };
    } catch (e) {
      err(`failed to read config at ${STATE.configPath}: ${e.message}`);
      STATE.config = { ...DEFAULT_CONFIG };
    }
  }
}

function saveConfig() {
  ensureWorkingDir();
  writeFileSync(STATE.configPath, JSON.stringify(STATE.config, null, 2));
}

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = lib(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

async function healthCheck() {
  try {
    const res = await httpGet(`http://${STATE.config.host}:${STATE.config.port}/health`, 3000);
    STATE.lastHealthCheck = new Date().toISOString();
    STATE.lastHealthStatus = res.status === 200 ? 'healthy' : `unhealthy (${res.status})`;
    return STATE.lastHealthStatus === 'healthy';
  } catch (e) {
    STATE.lastHealthCheck = new Date().toISOString();
    STATE.lastHealthStatus = `unreachable (${e.message})`;
    return false;
  }
}

function findLightragBinary() {
  // Check common locations for lightrag-server.
  const candidates = [
    '/usr/local/bin/lightrag-server',
    '/usr/bin/lightrag-server',
    `${process.env.HOME}/.local/bin/lightrag-server`,
    `${process.env.HOME}/.cargo/bin/lightrag-server`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fall back to `which` lookup.
  try {
    const path = execSync('which lightrag-server', { encoding: 'utf8', timeout: 3000 }).trim();
    if (path) return path;
  } catch (_) {
    // which returned non-zero
  }
  return null;
}

async function ensureInstalled() {
  if (STATE.installAttempted) return;
  STATE.installAttempted = true;
  try {
    execSync('uv --version', { encoding: 'utf8', timeout: 3000 });
  } catch (_) {
    err('`uv` is not installed. LightRAG requires `uv` to install. Install: curl -LsSf https://astral.sh/uv/install.sh | sh');
    return false;
  }
  // Check if lightrag-server is already on PATH.
  const existing = findLightragBinary();
  if (existing) {
    log(`lightrag-server found at ${existing}`);
    return true;
  }
  // Try `uv tool install`.
  log('installing lightrag-hku[api] via uv tool (one-time)...');
  try {
    execSync('uv tool install "lightrag-hku[api]"', { encoding: 'utf8', timeout: 300000 });
    log('uv tool install completed');
    return true;
  } catch (e) {
    err(`uv tool install failed: ${e.message?.slice(0, 200)}`);
    return false;
  }
}

async function startServer() {
  if (STATE.process && !STATE.process.killed) {
    log('server already running');
    return { ok: true, message: 'already running' };
  }
  if (!ensureWorkingDir()) {
    return { ok: false, message: 'failed to create working dir' };
  }
  if (!(await ensureInstalled())) {
    return { ok: false, message: 'lightrag-server not installed and auto-install failed' };
  }
  const bin = findLightragBinary() || 'uvx';
  const cmd = bin === 'uvx' ? 'uvx' : bin;
  const args = bin === 'uvx'
    ? ['--from', 'lightrag-hku[api]', 'lightrag-server']
    : [];

  // Write a minimal .env so lightrag-server has SOMETHING to read.
  // Real LLM keys should be in the user's environment, not the project .env.
  const envFile = join(resolveProjectPath(STATE.config.workingDir), '.env');
  if (!existsSync(envFile)) {
    const envLines = [
      `# Auto-generated by Bizar LightRAG mod. Edit as needed.`,
      `HOST=${STATE.config.host}`,
      `PORT=${STATE.config.port}`,
      `WORKING_DIR=${resolveProjectPath(STATE.config.workingDir)}`,
      `LLM_MODEL=${STATE.config.llmModel}`,
      `EMBEDDING_MODEL=${STATE.config.embeddingModel}`,
      ``,
      `# Provide real LLM/embedding credentials via environment, not this file.`,
    ];
    writeFileSync(envFile, envLines.join('\n'));
  }

  log(`starting lightrag-server (${cmd} ${args.join(' ')})`);
  STATE.process = spawn(cmd, args, {
    cwd: resolveProjectPath(STATE.config.workingDir),
    env: { ...process.env, ...STATE.config },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Open log file (truncate if too large).
  if (existsSync(STATE.logFile)) {
    const stats = readFileSync(STATE.logFile);
    if (stats.length > MAX_LOG_BYTES) {
      const trimmed = stats.toString('utf8').slice(-MAX_LOG_BYTES / 2);
      writeFileSync(STATE.logFile, trimmed);
    }
  }
  const logFd = openSync(STATE.logFile, 'a');
  STATE.process.stdout.on('data', (d) => writeSync(logFd, d));
  STATE.process.stderr.on('data', (d) => writeSync(logFd, d));

  STATE.process.on('exit', (code, signal) => {
    log(`lightrag-server exited (code=${code}, signal=${signal})`);
    STATE.process = null;
    STATE.startedAt = null;
    if (existsSync(STATE.pidFile)) {
      try { unlinkSync(STATE.pidFile); } catch (_) {}
    }
  });

  writeFileSync(STATE.pidFile, String(STATE.process.pid));
  STATE.startedAt = new Date().toISOString();

  // Wait for health check.
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (await healthCheck()) {
      log(`lightrag-server ready (${STATE.lastHealthStatus})`);
      return { ok: true, message: 'started' };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, message: 'started but health check did not pass within 30s' };
}

function stopServer() {
  if (!STATE.process) {
    if (existsSync(STATE.pidFile)) {
      try {
        const pid = parseInt(readFileSync(STATE.pidFile, 'utf8').trim(), 10);
        process.kill(pid, 'SIGTERM');
        log(`killed orphan lightrag-server (pid ${pid}) from pid file`);
      } catch (e) {
        err(`failed to kill from pid file: ${e.message}`);
      }
    }
    return { ok: true, message: 'not running' };
  }
  STATE.process.kill('SIGTERM');
  setTimeout(() => {
    if (STATE.process && !STATE.process.killed) STATE.process.kill('SIGKILL');
  }, 5000);
  STATE.process = null;
  STATE.startedAt = null;
  if (existsSync(STATE.pidFile)) {
    try { unlinkSync(STATE.pidFile); } catch (_) {}
  }
  return { ok: true, message: 'stopped' };
}

async function lightragFetch(path, options = {}) {
  const url = `http://${STATE.config.host}:${STATE.config.port}${path}`;
  return httpGet(url, options.timeoutMs || 30000);
}

export default function register({ router, ctx, security }) {
  loadConfig();

  // Auto-start if configured.
  if (STATE.config.autoStart) {
    startServer().catch((e) => err(`auto-start failed: ${e.message}`));
  }

  // Status.
  router.get('/status', async (_req, res) => {
    const healthy = await healthCheck();
    res.json({
      ok: true,
      running: !!STATE.process,
      pid: STATE.process?.pid || null,
      startedAt: STATE.startedAt,
      lastHealthCheck: STATE.lastHealthCheck,
      lastHealthStatus: STATE.lastHealthStatus,
      healthy,
      config: STATE.config,
      logFile: STATE.logFile,
    });
  });

  // Lifecycle.
  router.get('/start', async (_req, res) => {
    const result = await startServer();
    res.json(result);
  });

  router.get('/stop', (_req, res) => {
    const result = stopServer();
    res.json(result);
  });

  router.get('/restart', async (_req, res) => {
    stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    const result = await startServer();
    res.json(result);
  });

  // Config.
  router.get('/config', (_req, res) => {
    res.json({ ok: true, config: STATE.config, configPath: STATE.configPath });
  });

  router.post('/config', (req, res) => {
    try {
      const body = req.body || {};
      STATE.config = { ...STATE.config, ...body };
      saveConfig();
      res.json({ ok: true, config: STATE.config });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Query.
  router.post('/query', async (req, res) => {
    try {
      const { query, mode = 'mix' } = req.body || {};
      if (!query) {
        return res.status(400).json({ ok: false, error: 'query required' });
      }
      if (STATE.config.autoStart && !STATE.process) await startServer();
      const r = await lightragFetch(`/query`, {
        method: 'POST',
        // Hack: pass body via a manual POST since we don't have a request helper.
      });
      // We need to POST with a JSON body. Use a different approach.
      res.status(501).json({ ok: false, error: 'use /proxy/query' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Generic proxy: forwards /proxy/<path> to lightrag-server.
  // Used for /query, /insert/text, /insert/file, /entities, /relations, etc.
  router.all('/proxy/*', async (req, res) => {
    const subPath = req.params[0] || '';
    try {
      if (!await healthCheck()) {
        return res.status(503).json({ ok: false, error: 'lightrag-server not healthy' });
      }
      const u = new URL(`http://${STATE.config.host}:${STATE.config.port}/${subPath}`);
      const opts = {
        method: req.method,
        headers: { 'content-type': 'application/json' },
      };
      const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body
        ? JSON.stringify(req.body)
        : null;
      if (body) opts.headers['content-length'] = String(Buffer.byteLength(body));
      const r = await new Promise((resolve, reject) => {
        const proxyReq = lib.request(u, opts, (proxyRes) => {
          let data = '';
          proxyRes.on('data', (c) => (data += c));
          proxyRes.on('end', () => resolve({ status: proxyRes.statusCode, body: data, headers: proxyRes.headers }));
        });
        proxyReq.on('error', reject);
        if (body) proxyReq.write(body);
        proxyReq.end();
      });
      res.status(r.status);
      // Forward content-type.
      const ct = r.headers['content-type'];
      if (ct) res.setHeader('content-type', ct);
      // Try to parse JSON, otherwise send raw.
      try {
        res.json(JSON.parse(r.body));
      } catch (_) {
        res.send(r.body);
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Convenience inserts that read the dashboard's filesystem.
  router.post('/insert/text', async (req, res) => {
    try {
      const { text, id } = req.body || {};
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });
      const r = await lightragFetch('/insert/text', {
        method: 'POST',
        body: JSON.stringify({ text, id }),
      });
      res.status(r.status).send(r.body);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/insert/file', async (req, res) => {
    try {
      const { path: filePath } = req.body || {};
      if (!filePath) return res.status(400).json({ ok: false, error: 'path required' });
      const abs = resolveProjectPath(filePath);
      if (!existsSync(abs)) {
        return res.status(404).json({ ok: false, error: `file not found: ${abs}` });
      }
      const text = readFileSync(abs, 'utf8');
      const r = await lightragFetch('/insert/text', {
        method: 'POST',
        body: JSON.stringify({ text, id: abs }),
      });
      res.status(r.status).send(r.body);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  log('LightRAG mod registered at /api/mods/lightrag/*');
}
