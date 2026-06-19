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
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dirname as pathDirname } from 'node:path';
import { createApiRouter } from './api.mjs';
import { createState } from './state.mjs';
import { createWatcher } from './watcher.mjs';

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
export function createServer({
  port,
  projectRoot,
  opencodeConfigDir,
  bizarRoot,
}) {
  const app = express();
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

  app.use(
    '/api',
    createApiRouter({
      state,
      watcher,
      projectRoot,
      opencodeConfigDir,
      bizarRoot,
      broadcast,
    }),
  );

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
    app.use(
      express.static(DIST_DIR, {
        extensions: ['html'],
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
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
    app.get('/', (_req, res) => res.status(503).type('html').send(renderNotBuiltPage()));
    app.get('*', (_req, res) => {
      if (_req.path.startsWith('/api') || _req.path === '/ws') {
        res.status(404).json({ error: 'not_found', message: `no route for ${_req.method} ${_req.originalUrl}` });
        return;
      }
      res.status(503).type('html').send(renderNotBuiltPage());
    });
    // eslint-disable-next-line no-console
    console.warn(
      `[dashboard] dist/ not found at ${DIST_DIR}. Run \`npm run build\` to build the React SPA.`,
    );
  }

  wss.on('connection', (ws) => {
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

  function close() {
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
    <title>Bizar Dashboard — not built</title>
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
      <h1>Dashboard not built</h1>
      <p>The React SPA has not been built yet. The Bizar dashboard server
        is running, but the frontend bundle is missing.</p>
      <p>Build from the <code>bizar-dash</code> package root:</p>
      <pre><code>cd bizar-dash &amp;&amp; npm run build</code></pre>
      <p>The REST API and WebSocket are still live at <code>/api/*</code>
        and <code>/ws</code>.</p>
    </div>
  </body>
</html>`;
}

export { DIST_DIR, renderNotBuiltPage };
