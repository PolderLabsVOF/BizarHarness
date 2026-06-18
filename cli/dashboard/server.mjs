/**
 * cli/dashboard/server.mjs
 *
 * Wires the API router, the file watcher, the WebSocket layer, and the
 * static frontend into a single Express + http.Server pair.
 *
 * Lifecycle:
 *   createServer()      → returns handles but does NOT listen
 *   server.listen(...)  → caller (cli/dashboard.mjs or tests) starts it
 *   close()             → stops watcher, closes wss, closes http server
 *
 * v2.6.0: serves the Vite-built React SPA from `dist/` instead of the
 * vanilla-JS `dashboard/` directory.
 */
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { createApiRouter } from './api.mjs';
import { createState } from './state.mjs';
import { createWatcher } from './watcher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli/dashboard/server.mjs → repo root is two levels up
const DIST_DIR = join(__dirname, '..', '..', 'dist');

/**
 * @param {object} opts
 * @param {number} opts.port - requested port (caller chooses after findFreePort)
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
  app.use(express.json({ limit: '1mb' }));

  // JSON parse errors must come back as JSON, not Express's HTML page.
  // body-parser emits the error on `app`, so we attach here rather than
  // on the router.
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

  // State + watcher are created once for the lifetime of the server
  const state = createState({ projectRoot, opencodeConfigDir, bizarRoot });

  const watchPaths = [
    state.paths.opencodeJson,
    state.paths.agentsDir,
    state.paths.commandsDir,
    state.paths.bizarDir,
    state.paths.plansDir,
    state.paths.globalPlansDir,
  ].filter((p) => existsSync(p) || safeCanCreate(p));

  const watcher = createWatcher({
    paths: watchPaths,
    onChange: (event, p) => {
      // Broadcast to every live WS client
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          try {
            client.send(
              JSON.stringify({
                type: 'change',
                event,
                path: p,
                ts: Date.now(),
              }),
            );
          } catch {
            /* dropped — client likely disconnected */
          }
        }
      });
    },
  });

  // HTTP + WS server pair so they can share a port
  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  /** Broadcast a message to all connected WS clients. */
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

  // Routes
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
  // If dist/ hasn't been built yet, serve a helpful message instead of 404.
  const distBuilt =
    existsSync(DIST_DIR) &&
    existsSync(join(DIST_DIR, 'index.html'));

  if (distBuilt) {
    // Serve hashed assets under /assets/ explicitly so they cache aggressively
    const assetsDir = join(DIST_DIR, 'assets');
    if (existsSync(assetsDir)) {
      app.use(
        '/assets',
        express.static(assetsDir, {
          maxAge: '1y',
          immutable: true,
          index: false,
        }),
      );
    }
    app.use(
      express.static(DIST_DIR, {
        extensions: ['html'],
        // index.html should NOT be cached aggressively (it references hashed bundles)
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // SPA fallback — any unmatched non-API route gets the index.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/ws') return next();
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  } else {
    // No build yet — tell the user what to do.
    app.get('/', (_req, res) => {
      res
        .status(503)
        .type('html')
        .send(renderNotBuiltPage());
    });
    app.get('*', (_req, res) => {
      if (_req.path.startsWith('/api') || _req.path === '/ws') {
        res.status(404).json({
          error: 'not_found',
          message: `no route for ${_req.method} ${_req.originalUrl}`,
        });
        return;
      }
      res.status(503).type('html').send(renderNotBuiltPage());
    });
    // eslint-disable-next-line no-console
    console.warn(
      `[dashboard] dist/ not found at ${DIST_DIR}. ` +
        `Run \`npm run build\` from the repo root to build the React SPA.`,
    );
  }

  // WebSocket handshake — send initial snapshot, accept simple commands
  wss.on('connection', (ws) => {
    try {
      ws.send(
        JSON.stringify({
          type: 'snapshot',
          ts: Date.now(),
          data: {
            overview: state.getOverview(),
            agents: state.getAgents(),
            plans: state.getPlans(),
            projects: state.getProjects(),
            config: state.getConfig(),
            settings: state.getSettings(),
            tasks: state.getTasks(),
          },
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
        return; // ignore malformed
      }
      switch (msg?.type) {
        case 'ping':
          try {
            ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          } catch {
            /* ignore */
          }
          break;
        case 'refresh':
          try {
            ws.send(
              JSON.stringify({
                type: 'snapshot',
                ts: Date.now(),
                data: {
                  overview: state.getOverview(),
                  agents: state.getAgents(),
                  plans: state.getPlans(),
                  projects: state.getProjects(),
                  config: state.getConfig(),
                  settings: state.getSettings(),
                  tasks: state.getTasks(),
                },
              }),
            );
          } catch {
            /* ignore */
          }
          break;
        case 'dismiss-notification':
          // No-op for now — UI keeps a local dismiss list
          break;
        default:
          // Unknown type — silently ignore
          break;
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

  return {
    app,
    server,
    wss,
    state,
    watcher,
    port,
    close,
  };
}

function safeCanCreate(p) {
  // chokidar accepts both existing and not-yet-existing paths, but it logs
  // noisily on the latter. We treat anything inside an existing parent as
  // watchable.
  try {
    return existsSync(dirname(p));
  } catch {
    return false;
  }
}

function renderNotBuiltPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bizar Dashboard — not built</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0b0e14;
        color: #c9d1d9;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        padding: 24px;
      }
      .card {
        max-width: 560px;
        background: #12161f;
        border: 1px solid #f87171;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      }
      h1 { margin: 0 0 12px; color: #f87171; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.6; }
      code {
        font-family: 'JetBrains Mono', monospace;
        background: #1a1f2b;
        border: 1px solid #232a39;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 13px;
      }
      pre {
        background: #1a1f2b;
        border: 1px solid #232a39;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        overflow-x: auto;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Dashboard not built</h1>
      <p>The React SPA has not been built yet. The Bizar dashboard server
        is running, but the frontend bundle is missing.</p>
      <p>Build the React + Vite frontend from the repo root:</p>
      <pre><code>npm run build</code></pre>
      <p>Then restart this server (<code>bizar dashboard start</code>).
        For local development with hot reload, run <code>npm run dev</code>
        from a second terminal and open the URL Vite prints.</p>
      <p>The REST API and WebSocket are still live at
        <code>/api/*</code> and <code>/ws</code>.</p>
    </div>
  </body>
</html>`;
}

export { DIST_DIR, renderNotBuiltPage };
