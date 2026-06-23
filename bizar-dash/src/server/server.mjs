/**
 * src/server/server.mjs
 *
 * v3.0.0 — Express + WebSocket server for the Bizar dashboard.
 *
 * Wires the v3 API router, the file watcher, the WebSocket layer, and
 * the static frontend (Vite-built React SPA from `dist/`) into a single
 * HTTP + WS pair.
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname as pathDirname } from 'node:path';
import { createApiRouter } from './api.mjs';
import { createState } from './state.mjs';
import { createWatcher } from './watcher.mjs';
import { modsLoader } from './mods-loader.mjs';
import { projectsStore } from './projects-store.mjs';
import { agentsStore } from './agents-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { schedulesStore } from './schedules-store.mjs';
import { providersStore, mcpsStore } from './providers-store.mjs';
import { homedir } from 'node:os';
import { startBgPoller, stopBgPoller } from './bg-poller.mjs';
import { startDialogPoller } from './dialog-poller.mjs';
import {
  checkWebSocketAuth,
  isAllowedDashboardOrigin,
  isAllowedDashboardOriginForRequest,
} from './auth.mjs';
import { readSettings } from './routes/_shared.mjs';

let processHandlersInstalled = false;

function installProcessHandlers() {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  // Catch-all to prevent server crash on unhandled rejections
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    // For uncaughtException, the process state is uncertain. Log and continue
    // unless it's a fatal error. Don't exit.
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// server.mjs lives at src/server/ — dist/ is at the package root
const DIST_DIR = join(__dirname, '..', '..', 'dist');
const WS_BACKPRESSURE_LIMIT_BYTES = 1024 * 1024;
const MOBILE_UA_RE = /Android.+Mobile|iPhone|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

let currentBroadcast = () => {};

export function broadcast(msg) {
  return currentBroadcast(msg);
}

function shouldRedirectToMobile(req) {
  if (req.method !== 'GET') return false;
  if (req.path !== '/') return false;
  if (req.query?.desktop === '1') return false;
  const accept = req.headers.accept || '';
  if (typeof accept === 'string' && !accept.includes('text/html')) return false;
  const ua = req.headers['user-agent'] || '';
  return typeof ua === 'string' && MOBILE_UA_RE.test(ua);
}

function mobileRedirectTarget(req) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'desktop') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value != null) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `/m?${qs}` : '/m';
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} opts.projectRoot
 * @param {string} opts.opencodeConfigDir
 * @param {string} opts.bizarRoot
 */
export async function createServer({
  port,
  projectRoot,
  opencodeConfigDir,
  bizarRoot,
}) {
  installProcessHandlers();
  const app = express();
  app.disable('x-powered-by');
  // v3.5.4 (CORS) — Reflect the request Origin back as
  // Access-Control-Allow-Origin so the Vite dev server (5174), a tunneled
  // remote, or a localhost:4321 same-origin tab all work. We also allow
  // credentials so the dashboard can keep using cookie-style pair tokens.
  // This is a local tool — same-origin is the norm; reflection is the
  // simplest correct policy.
  app.use(cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const allowed = isAllowedDashboardOrigin(origin);
      callback(allowed ? null : new Error('origin_not_allowed'), allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(
    (
      err,
      _req,
      res,
      _next, // eslint-disable-line no-unused-vars
    ) => {
      const status = err?.status || err?.statusCode || 400;
      res.status(status).json({
        error: err?.type || 'bad_request',
        message: err?.message || String(err),
      });
    },
  );

  const state = createState({ projectRoot, opencodeConfigDir, bizarRoot });

  // v3.0.4 — Auto-detect the user's cwd as a project on startup. This is
  // idempotent and safe to call on every boot. The first time a user runs
  // the dashboard, BizarHarness/ (or whatever their cwd is) shows up as
  // a project without any manual setup.
  try {
    const detected = projectsStore.autoDetect({ cwd: projectRoot });
    if (detected) {
      // eslint-disable-next-line no-console
      console.log(`[bizar-dash] auto-detected project: ${detected.id} (${detected.path})`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bizar-dash] autoDetect failed:', err.message);
  }

  // v3.6.0 — If the operator has configured a `dashboard.projectsDirectory`,
  // also scan it for project roots on startup. Fire-and-forget: a slow
  // scan or a missing directory must not block the server from booting.
  try {
    const settings = readSettings();
    const configured = settings.data?.dashboard?.projectsDirectory;
    if (typeof configured === 'string' && configured.trim()) {
      projectsStore.scanDirectory(configured).then(
        (result) => {
          if (result.error) {
            // eslint-disable-next-line no-console
            console.warn(`[bizar-dash] projects-directory scan: ${result.error}`);
          } else if (result.added && result.added.length > 0) {
            // eslint-disable-next-line no-console
            console.log(
              `[bizar-dash] projects-directory scan: added ${result.added.length} ` +
                `project(s) (skipped ${result.skipped}, scanned ${result.scanned})`,
            );
          }
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn(`[bizar-dash] projects-directory scan failed: ${err?.message || err}`);
        },
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[bizar-dash] startup scan setup failed:', err?.message || err);
  }

  const watchPaths = [
    state.paths.opencodeJson,
    state.paths.agentsDir,
    state.paths.commandsDir,
    state.paths.bizarDir,
    state.paths.plansDir,
    state.paths.globalPlansDir,
    join(opencodeConfigDir, 'projects.json'),
  ].filter((p) => existsSafe(p));

  const watcher = createWatcher({
    paths: watchPaths,
    onChange: (event, p) => {
      wss.clients.forEach((client) => {
        safeSend(client, JSON.stringify({ type: 'change', event, path: p, ts: Date.now() }));
      });
    },
  });

  const server = createHttpServer(app);
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.keepAliveTimeout = 5_000;
  app.set('port', port);
  // v3.6.0 — Bind the WS server's noServer mode so we can authenticate
  // the upgrade ourselves instead of letting ws accept any TCP
  // connection to /ws. The actual upgrade handling happens further
  // down via server.on('upgrade', ...).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  function safeSend(client, payload) {
    if (client.readyState !== 1) return false;
    if (client.bufferedAmount > WS_BACKPRESSURE_LIMIT_BYTES) {
      try {
        client.terminate();
      } catch {
        /* ignore */
      }
      return false;
    }
    try {
      client.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  function localBroadcast(msg) {
    const payload = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      safeSend(client, payload);
    });
  }
  currentBroadcast = localBroadcast;

  const apiRouter = createApiRouter({
    state,
    watcher,
    projectRoot,
    opencodeConfigDir,
    bizarRoot,
    broadcast: localBroadcast,
  });

  // v3.6.2 — Auth now wraps mod routes too. Previously mods mounted at
  // `/api/mods/<id>` BEFORE `requireAuth`, which meant every mod route
  // silently bypassed bearer-token checks.
  const { requireAuth } = await import('./auth.mjs');
  app.use('/api', requireAuth({ skipPaths: ['/auth/status', '/pair/verify'] }));

  // ── Mod route mounting ──────────────────────────────────────────────
  {
    const modCtx = { broadcast: localBroadcast, state, projectRoot, opencodeConfigDir };
    const modRouters = await modsLoader.loadModRouters(modCtx);
    for (const { id, router: modRouter, mountPath } of modRouters) {
      app.use(mountPath, modRouter);
      // eslint-disable-next-line no-console
      console.log(`[mod] mounted ${id} routes at ${mountPath}`);
    }
  }

  // All /api/* routes go through apiRouter (after mod routes are checked)
  app.use('/api', apiRouter);

  // v3.6.0 — Authenticate WebSocket upgrades. The wss is in
  // `noServer: true` mode above, so this handler is the gate. We
  // reject with 401 if the token is missing/invalid; otherwise we
  // hand off to ws.handleUpgrade so the existing wss.on('connection')
  // listener below receives the new socket.
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (!isAllowedDashboardOriginForRequest(req)) {
      try {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    if (!checkWebSocketAuth(req)) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.isAlive === false) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
    });
  }, 30_000);
  if (typeof heartbeatInterval.unref === 'function') heartbeatInterval.unref();

  // ── Static frontend (React SPA in dist/) ─────────────────────────
  const distBuilt =
    existsSync(DIST_DIR) && existsSync(join(DIST_DIR, 'index.html'));

  if (distBuilt) {
    const assetsDir = join(DIST_DIR, 'assets');
    if (existsSync(assetsDir)) {
      app.use(
        '/assets',
        express.static(assetsDir, { maxAge: '1y', immutable: true, index: false }),
      );
    }
    app.get('/', (req, res, next) => {
      if (!shouldRedirectToMobile(req)) {
        next();
        return;
      }
      res.redirect(302, mobileRedirectTarget(req));
    });
    // v3.5.0 — Mobile dashboard at /m
    app.get('/m', (_req, res) => {
      res.sendFile(join(DIST_DIR, 'mobile.html'));
    });
    // SPA fallback for /m/* — but ONLY for HTML navigation requests
    // The negative lookahead (?!assets/) excludes asset paths so they fall
    // through to the static /assets/* handler above
    app.get(/^\/m\/(?!assets\/)/, (_req, res) => {
      res.sendFile(join(DIST_DIR, 'mobile.html'));
    });
    app.use(
      express.static(DIST_DIR, {
        extensions: ['html'],
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('mobile.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/ws') return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  } else {
    const distIndex = join(DIST_DIR, 'index.html');
    if (!existsSync(distIndex)) {
      // eslint-disable-next-line no-console
      console.error(`[bizar-dash] dist/index.html not found at ${DIST_DIR}`);
      // eslint-disable-next-line no-console
      console.error(`[bizar-dash] The published package should include a prebuilt dist/.`);
      // eslint-disable-next-line no-console
      console.error(`[bizar-dash] Try: npm install -g @polderlabs/bizar-dash --force`);
    }
    app.get('/', (_req, res) => res.status(503).type('html').send(renderNotBuiltPage()));
    app.get('*', (_req, res) => {
      if (_req.path.startsWith('/api') || _req.path === '/ws') {
        res.status(404).json({ error: 'not_found', message: `no route for ${_req.method} ${_req.originalUrl}` });
        return;
      }
      res.status(503).type('html').send(renderNotBuiltPage());
    });
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    const path = req.url
      ? (() => {
          try {
            return new URL(req.url, 'http://localhost').pathname;
          } catch {
            return req.url || '';
          }
        })()
      : '';

    // /ws/logs — stream log file changes
    if (path === '/ws/logs') {
      const HOME = homedir();
      const serviceLog = join(HOME, '.config', 'bizar', 'service.log');
      const dashboardLog = join(HOME, '.config', 'bizar', 'dashboard.log');
      const logFile = existsSync(serviceLog) ? serviceLog : existsSync(dashboardLog) ? dashboardLog : null;

      let fileSize = logFile && existsSync(logFile) ? statSync(logFile).size : 0;

      // Send initial tail
      if (logFile) {
        try {
          const text = readFileSync(logFile, 'utf8');
          const lines = text.split(/\r?\n/).filter(Boolean).slice(-100);
          safeSend(ws, JSON.stringify({ type: 'log init', lines, file: logFile }));
        } catch {
          safeSend(ws, JSON.stringify({ type: 'log init', lines: [], file: logFile }));
        }
      } else {
        safeSend(ws, JSON.stringify({ type: 'log init', lines: [], file: null }));
      }

      let destroying = false;
      function sendLogChunk() {
        if (destroying || ws.readyState !== 1) return;
        try {
          const f = logFile;
          if (!f || !existsSync(f)) return;
          const newSize = statSync(f).size;
          // Reset if the file was rotated/truncated (size shrank).
          if (newSize < fileSize) {
            fileSize = 0;
          }
          if (newSize > fileSize) {
            // Read only the new bytes
            const fd = openSync(f, 'r');
            const buf = Buffer.alloc(newSize - fileSize);
            readSync(fd, buf, 0, buf.length, fileSize);
            closeSync(fd);
            const newText = buf.toString('utf8');
            const newLines = newText.split(/\r?\n/).filter(Boolean);
            for (const line of newLines) {
              safeSend(ws, JSON.stringify({ type: 'log line', line, ts: Date.now() }));
            }
            fileSize = newSize;
          }
        } catch {
          /* ignore */
        }
      }

      const interval = setInterval(sendLogChunk, 1000);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.type === 'ping') {
            safeSend(ws, JSON.stringify({ type: 'pong', ts: Date.now() }));
          }
        } catch {
          /* ignore */
        }
      });

      ws.on('close', () => {
        destroying = true;
        clearInterval(interval);
      });

      ws.on('error', () => {
        destroying = true;
        clearInterval(interval);
      });
      return;
    }

    // Default /ws — snapshot + ping/pong
    try {
      safeSend(
        ws,
        JSON.stringify({
          type: 'snapshot',
          ts: Date.now(),
          data: buildSnapshotSafe(state, opencodeConfigDir),
        }),
      );
    } catch {
      /* ignore */
    }

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg?.type === 'ping') {
        try {
          safeSend(ws, JSON.stringify({ type: 'pong', ts: Date.now() }));
        } catch {
          /* ignore */
        }
      }
    });
  });

  watcher.start();

  // v3.5.5 — Bridge bg state file changes into task status updates +
  // artifact auto-detection. Started after the watcher so the WS
  // broadcast channel is fully wired by the time the first tick
  // runs. Idempotent — calling startBgPoller twice is a no-op.
  try {
    startBgPoller();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bizar-dash] failed to start bg-poller:', err.message);
  }

  // v0.5.1 — Poll for dialog descriptors written by the plugin and
  // broadcast them to connected dashboard clients via WS.
  // Idempotent — calling startDialogPoller twice is a no-op.
  try {
    startDialogPoller();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bizar-dash] failed to start dialog-poller:', err.message);
  }

  function close() {
    try {
      stopBgPoller();
    } catch {
      /* ignore */
    }
    try {
      watcher.stop();
    } catch {
      /* ignore */
    }
    try {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
    } catch {
      /* ignore */
    }
    try {
      clearInterval(heartbeatInterval);
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
    currentBroadcast = () => {};
  }

  return { app, server, wss, state, watcher, port, close };
}

function buildSnapshotSafe(state, opencodeConfigDir) {
  try {
    return buildSnapshot(state, opencodeConfigDir);
  } catch (err) {
    return { error: 'snapshot_failed', message: err.message };
  }
}

function buildSnapshot(state, opencodeConfigDir) {
  const cfgFile = join(opencodeConfigDir, 'opencode.json');
  let cfg = null;
  if (existsSync(cfgFile)) {
    try {
      cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
    } catch {
      cfg = null;
    }
  }
  const activeProject = projectsStore.active();
  return {
    overview: state.getOverview(),
    agents: agentsStore.list(),
    plans: state.getPlans(),
    projects: projectsStore.list().projects,
    activeProject,
    config: {
      path: cfgFile,
      data: cfg,
      raw: cfg ? JSON.stringify(cfg, null, 2) : '',
      exists: existsSync(cfgFile),
    },
    settings: readSettings(),
    tasks: activeProject ? tasksStore.loadTasks(activeProject.id) : [],
    mods: modsLoader.list(),
    schedules: activeProject ? schedulesStore.list(activeProject.id) : [],
    providers: providersStore.list(),
    mcps: mcpsStore.list(),
  };
}

function existsSafe(p) {
  try {
    return existsSync(p) || existsSync(dirnameSafe(p));
  } catch {
    return false;
  }
}

function dirnameSafe(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '.' : p.slice(0, idx);
}

function renderNotBuiltPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Dashboard assets not found</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; background: #0b0e14; color: #c9d1d9;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        padding: 24px;
      }
      .card {
        max-width: 560px; background: #12161f; border: 1px solid #f87171;
        border-radius: 12px; padding: 32px;
      }
      h1 { margin: 0 0 12px; color: #f87171; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.6; }
      code {
        font-family: 'JetBrains Mono', monospace; background: #1a1f2b;
        border: 1px solid #232a39; padding: 2px 6px; border-radius: 4px;
        font-size: 13px;
      }
      pre {
        background: #1a1f2b; border: 1px solid #232a39; padding: 12px 16px;
        border-radius: 8px; font-family: 'JetBrains Mono', monospace;
        font-size: 13px; overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Dashboard assets not found</h1>
      <p>The <code>@polderlabs/bizar-dash</code> package ships prebuilt assets
        in <code>dist/</code>. If you are seeing this, your install is broken.</p>
      <p>Try:</p>
      <pre><code>npm install -g @polderlabs/bizar-dash --force</code></pre>
      <p>If the problem persists, file an issue at<br/>
        <code>github.com/DrB0rk/BizarHarness</code></p>
      <p>The REST API and WebSocket are still live at <code>/api/*</code>
        and <code>/ws</code>.</p>
    </div>
  </body>
</html>`;
}

export { DIST_DIR, renderNotBuiltPage };
