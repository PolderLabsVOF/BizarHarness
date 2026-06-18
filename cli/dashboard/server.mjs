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
 */
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createApiRouter } from './api.mjs';
import { createState } from './state.mjs';
import { createWatcher } from './watcher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// cli/dashboard/server.mjs → repo root is two levels up
const DASHBOARD_DIR = join(__dirname, '..', '..', 'dashboard');

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
        try { client.send(payload); } catch { /* dropped */ }
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

  // Static frontend — fall back to index.html so deep links still work
  app.use(express.static(DASHBOARD_DIR, { extensions: ['html'] }));
  app.get('/', (_req, res) => {
    res.sendFile(join(DASHBOARD_DIR, 'index.html'));
  });

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

export { DASHBOARD_DIR };
