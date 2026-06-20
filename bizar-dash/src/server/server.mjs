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
import { homedir } from 'node:os';
import { startBgPoller, stopBgPoller } from './bg-poller.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server.mjs lives at src/server/ — dist/ is at the package root
const DIST_DIR = join(__dirname, '..', '..', 'dist');

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
  const app = express();
  // v3.5.4 (CORS) — Reflect the request Origin back as
  // Access-Control-Allow-Origin so the Vite dev server (5174), a tunneled
  // remote, or a localhost:4321 same-origin tab all work. We also allow
  // credentials so the dashboard can keep using cookie-style pair tokens.
  // This is a local tool — same-origin is the norm; reflection is the
  // simplest correct policy.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

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
        if (client.readyState === 1) {
          try {
            client.send(JSON.stringify({ type: 'change', event, path: p, ts: Date.now() }));
          } catch {
            /* dropped */
          }
        }
      });
    },
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(msg) {
    const payload = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        try {
          client.send(payload);
        } catch {
          /* dropped */
        }
      }
    });
  }

  const apiRouter = createApiRouter({
    state,
    watcher,
    projectRoot,
    opencodeConfigDir,
    bizarRoot,
    broadcast,
  });

  // ── Mod route mounting ──────────────────────────────────────────────
  // Mod routers are mounted BEFORE the apiRouter is registered with app.
  // Mounting directly on app (outside /api prefix) so there are no
  // conflicts with the apiRouter's catch-all handler.
  {
    const modCtx = { broadcast, state, projectRoot, opencodeConfigDir };
    const modRouters = await modsLoader.loadModRouters(modCtx);
    for (const { id, router: modRouter, mountPath } of modRouters) {
      app.use(mountPath, modRouter);
      // eslint-disable-next-line no-console
      console.log(`[mod] mounted ${id} routes at ${mountPath}`);
    }
  }

  // All /api/* routes go through apiRouter (after mod routes are checked)
  app.use('/api', apiRouter);

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
    const path = req.url || '';

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
          ws.send(JSON.stringify({ type: 'log init', lines, file: logFile }));
        } catch {
          ws.send(JSON.stringify({ type: 'log init', lines: [], file: logFile }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'log init', lines: [], file: null }));
      }

      let destroying = false;
      function sendLogChunk() {
        if (destroying || ws.readyState !== 1) return;
        try {
          const f = logFile;
          if (!f || !existsSync(f)) return;
          const newSize = statSync(f).size;
          if (newSize > fileSize) {
            // Read only the new bytes
            const fd = openSync(f, 'r');
            const buf = Buffer.alloc(newSize - fileSize);
            readSync(fd, buf, 0, buf.length, fileSize);
            closeSync(fd);
            const newText = buf.toString('utf8');
            const newLines = newText.split(/\r?\n/).filter(Boolean);
            for (const line of newLines) {
              ws.send(JSON.stringify({ type: 'log line', line, ts: Date.now() }));
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
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
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
      ws.send(
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
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
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
      server.close();
    } catch {
      /* ignore */
    }
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
  return {
    overview: state.getOverview(),
    agents: state.getAgents(),
    plans: state.getPlans(),
    projects: state.getProjects(),
    config: {
      path: cfgFile,
      data: cfg,
      raw: cfg ? JSON.stringify(cfg, null, 2) : '',
      exists: existsSync(cfgFile),
    },
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
