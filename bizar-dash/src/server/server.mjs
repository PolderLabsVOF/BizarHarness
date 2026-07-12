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
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
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
import { readClineJsonCached } from './providers-store.mjs';
import { homedir } from 'node:os';
import { startBgPoller, stopBgPoller } from './bg-poller.mjs';
import { startBgRetryLoop, stopBgRetryLoop } from './bg-retry.mjs';
import { startDialogPoller } from './dialog-poller.mjs';
import {
  checkWebSocketAuth,
  isAllowedDashboardOrigin,
  isAllowedDashboardOriginForRequest,
} from './auth.mjs';
import { buildAllowedRootsFromSettings, resolveSafePath } from './lib/path-safe.mjs';
import { V2EventBus } from './v2-event-bus.mjs';
import { loadOrCreateAuth, V2_DEFAULT_PORT } from './v2-auth-file.mjs';
import { createV2Router } from './routes-v2/index.mjs';
import { counter, gauge, render as renderMetrics } from './metrics.mjs';
import { warn } from './logger.mjs';
import { initOtel, shutdownOtel, tracer } from './otel.mjs';

// v4.7.0 — Prometheus-style HTTP metrics. Bound to the server-wide
// registry; render() emits the text exposition format consumed by
// `GET /metrics`. Counter is keyed by {method, route, status} where
// `route` is the matched Express pattern (e.g. `/api/tasks/:id`) to
// keep cardinality bounded; unmatched 404s collapse to `unmatched`.
const httpRequestsTotal = counter(
  'http_requests_total',
  'Count of HTTP requests handled by the dashboard server.',
);
const wsClientsGauge = gauge(
  'ws_clients',
  'Number of currently-connected WebSocket clients (snapshot + /ws/logs).',
);

let processHandlersInstalled = false;
let otelSigtermInstalled = false;
let v2Bus = null;
let v2Auth = null;

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

/**
 * Publish an event on the v2 event bus (if initialized). Exposed for
 * other parts of the dashboard server (e.g. bg-poller, dialog-poller)
 * to push events into the v2 SSE stream without taking a direct
 * dependency on the bus module.
 */
export function publishV2Event(event) {
  if (!v2Bus) return -1;
  return v2Bus.publish(event);
}

/**
 * Return v2 auth info for the plugin to consume (e.g. via a startup
 * handshake or env var). Password is the same one persisted to the
 * auth file.
 */
export function getV2Auth() {
  if (!v2Auth) return null;
  return {
    baseUrl: v2Auth.baseUrl,
    port: v2Auth.port,
    password: v2Auth.password,
    file: v2Auth.file,
  };
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
 * @param {string} opts.clineConfigDir
 * @param {string} opts.bizarRoot
 */
export async function createServer({
  port,
  projectRoot,
  clineConfigDir,
  bizarRoot,
}) {
  installProcessHandlers();
  // v4.9.0 — Initialise OpenTelemetry first so every subsequent handler
  // (auth, rate-limit, routes) executes inside the SDK's lifecycle.
  // Off by default; opt in via BIZAR_OTEL=1 / OTEL_ENABLED=1. The SDK
  // itself never throws — see otel.mjs for the graceful-degradation
  // contract — so this call is always safe to make.
  try {
    if (
      process.env.OTEL_ENABLED === '1' ||
      process.env.BIZAR_OTEL === '1'
    ) {
      initOtel();
    }
  } catch {
    /* never block startup on OTel */
  }

  // v4.9.0 — SIGTERM handler that flushes pending spans before exit.
  // Installed exactly once per process (mirrors `installProcessHandlers`).
  if (!otelSigtermInstalled) {
    otelSigtermInstalled = true;
    const flushAndExit = async (signal) => {
      try {
        await shutdownOtel();
      } finally {
        // Re-raise the default action so kill -TERM / SIGINT still
        // shut the rest of the server down. We do NOT process.exit(0)
        // hard because Express needs to drain pending connections too,
        // but a clean exit is the operator's job — we only guarantee
        // spans are flushed.
        if (signal === 'SIGTERM' || signal === 'SIGINT') {
          // Allow Node's default SIGTERM behaviour to terminate the
          // process; the small async overlap here is intentional.
        }
      }
    };
    process.on('SIGTERM', () => { void flushAndExit('SIGTERM'); });
    process.on('SIGINT', () => { void flushAndExit('SIGINT'); });
  }
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

  // v4.7.0 — Prometheus scrape endpoint. Mounted BEFORE the auth
  // middleware and OUTSIDE /api/* so scrapers don't need a bearer
  // token. Returns text/plain in the standard 0.0.4 exposition
  // format so both Prometheus and `curl http://host/metrics` work.
  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics());
  });

  // v4.7.0 — Per-request counter. Uses the matched Express route
  // pattern (e.g. `/api/tasks/:id`) when available; falls back to
  // `unmatched` for 404s so the cardinality stays bounded. Hooked off
  // `finish` so the final status code is captured even after error
  // handlers run.
  //
  // v4.8.0 — When the status is 429, also emit a structured warning
  // so operators can see when an IP is being throttled. The scope
  // comes from the X-RateLimit-Scope header set by the per-route
  // limiter middleware (chat / event); if no scope header is
  // present, log the 429 with scope=unknown (it may be an upstream
  // 429 proxied from the cline plugin).
  //
  // v5.1.0 — Also opens an HTTP-server root span on every request
  // via the OpenTelemetry tracer. The span is created inside
  // `startActiveSpan` so the per-route spans below automatically
  // parent under it (the OTel SDK's AsyncHooksContextManager is
  // installed by NodeSDK.start()). HTTP semantic convention
  // attributes (`http.request.method`, `url.path`, `http.route`,
  // `http.response.status_code`, `http.user_agent`) are added up
  // front / on finish. Cost when OTEL is off: zero — the no-op
  // tracer does nothing.
  app.use((req, res, next) => {
    tracer.startActiveSpan('http.request', { attributes: {
      'http.request.method': req.method,
      'url.path': req.originalUrl || req.url || '',
      'url.scheme': req.protocol || 'http',
      'http.user_agent': (req.headers && req.headers['user-agent']) || '',
      'http.client_ip': req.ip || (req.socket && req.socket.remoteAddress) || '',
      'http.host': req.headers?.host || '',
    } }, (rootSpan) => {
      res.on('finish', () => {
        const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
        httpRequestsTotal.inc({
          method: req.method,
          route,
          status: String(res.statusCode),
        });
        try {
          rootSpan.setAttribute('http.route', route);
          rootSpan.setAttribute('http.response.status_code', res.statusCode);
          if (res.statusCode >= 500) {
            rootSpan.setStatus({ code: 2 /* ERROR */, message: `HTTP ${res.statusCode}` });
          } else {
            rootSpan.setStatus({ code: 1 /* OK */ });
          }
        } catch { /* never throw from OTel helpers */ }
        try { rootSpan.end(); } catch { /* ignore */ }
        if (res.statusCode === 429) {
          const scope = res.getHeader('X-RateLimit-Scope') || 'unknown';
          warn('rate_limit_exceeded', {
            ip: req.ip || (req.socket && req.socket.remoteAddress) || 'unknown',
            scope,
            method: req.method,
            route,
          });
        }
      });
      next();
    });
  });

  // v4.7.0 — Cache-Control headers for live JSON endpoints. The
  // frontend pulls these every few seconds, so we use `no-cache` (which
  // allows conditional revalidation) rather than `no-store` (which
  // forbids it). Static assets already get `max-age=1y` via
  // express.static above; this only fills the gap for the live API.
  app.use('/api/settings', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });
  app.use('/api/snapshot', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
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

  const state = createState({ projectRoot, clineConfigDir, bizarRoot });

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
  //
  // v3.11.0 — Rebuild the allow-list from settings (home +
  // projectsDirectory + dashboard.allowedRoots), log it once for
  // debuggability, and re-validate the configured `projectsDirectory`
  // against the allow-list before scanning. A tampered settings file
  // cannot widen the boundary.
  try {
    // Dynamic import breaks a potential circular-dep TDZ: _shared.mjs imports
    // projectsStore which may transitively import something that touches
    // _shared.mjs before readSettings is fully initialised.
    const { readSettings } = await import('./routes/_shared.mjs');
    const settings = readSettings();
    const allowedRoots = buildAllowedRootsFromSettings({
      settings: settings.data,
      home: homedir(),
    });
    // eslint-disable-next-line no-console
    console.log(
      `[bizar-dash] projects-directory scan: rebuilt allow-list (${allowedRoots.length} root(s))`,
    );
    const configured = settings.data?.dashboard?.projectsDirectory;
    if (typeof configured === 'string' && configured.trim()) {
      const safeRoot = resolveSafePath(configured, allowedRoots);
      if (!safeRoot) {
        // eslint-disable-next-line no-console
        console.warn(
          `[bizar-dash] projects-directory scan: skipping — ` +
            `"${configured}" is outside the allow-list`,
        );
      } else {
        projectsStore.scanDirectory(safeRoot).then(
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
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[bizar-dash] startup scan setup failed:', err?.message || err);
  }

  const watchPaths = [
    state.paths.clineJson,
    state.paths.agentsDir,
    state.paths.commandsDir,
    state.paths.bizarDir,
    state.paths.plansDir,
    state.paths.globalPlansDir,
    join(clineConfigDir, 'projects.json'),
  ].filter((p) => existsSafe(p));

  const watcher = createWatcher({
    paths: watchPaths,
    onChange: (event, p) => {
      wss.clients.forEach((client) => {
        safeSend(client, JSON.stringify({ type: 'change', event, path: p, ts: Date.now() }));
      });
    },
    // v6.6.0 — F-042 timeline aggregator. Every chokidar event is
    // also fed into the timeline ring so the Timeline view surfaces
    // file changes alongside commits, hook logs, and agent activity.
    // Lazy-loaded because the timeline-store imports nothing that
    // would itself depend on the watcher.
    onTimelineEvent: async ({ event, path: filePath }) => {
      try {
        const { timelineStore } = await import('./timeline-store.mjs');
        const subType = event === 'add' ? 'file-add'
          : event === 'unlink' ? 'file-unlink'
          : 'file-change';
        const ev = timelineStore._testFromFileChange(filePath, projectRoot);
        if (ev) {
          ev.subType = subType;
          ev.metadata = { ...(ev.metadata || {}), event };
          ev.summary = `File ${event}: ${filePath}`;
          timelineStore.appendEvent(ev);
        }
      } catch {
        /* swallow — file timeline events are best-effort */
      }
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
      } catch (err) {
        console.warn('swallowed in terminate (backpressure):', err.message);
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

  // v4 — Load BIZAR_* env vars from ~/.config/bizar/env.json into process.env.
  const { loadEnvJson } = await import('./routes/env-vars.mjs');
  loadEnvJson();

  const apiRouter = await createApiRouter({
    state,
    watcher,
    projectRoot,
    clineConfigDir,
    bizarRoot,
    broadcast: localBroadcast,
  });

  // v5.0.0 — Headroom startup hook. Runs after api.mjs is loaded so the
  // headroom routes are registered. Errors are caught and logged — startup
  // must not fail if Headroom has issues.
  const { headroomStartupHook } = await import('./headroom.mjs');
  const { readSettings } = await import('./routes/_shared.mjs');
  try {
    const settings = readSettings();
    if (settings?.data?.headroom) {
      headroomStartupHook(settings.data.headroom).catch((err) => {
        console.warn('[bizar-dash] headroomStartupHook error:', err?.message || err);
      });
    }
  } catch (err) {
    console.warn('[bizar-dash] headroom startup hook skipped:', err?.message || err);
  }

  // v5.5.2 — Auto-migrate legacy git.repoPath from the old vault location
  // to the new default. Runs before the lightrag hook so git-dependent
  // checks are already correct.
  try {
    const { migrateLegacyGitRepoPath } = await import('./memory-store.mjs');
    const result = migrateLegacyGitRepoPath(projectRoot);
    if (result.migrated) {
      console.warn(
        `[bizar-dash] git.repoPath auto-migrated:\n` +
          `  from: ${result.from}\n` +
          `  to:   ${result.to}`,
      );
    }
  } catch (err) {
    console.warn('[bizar-dash] git.repoPath migration check failed:', err?.message || err);
  }

  // v5.x — LightRAG startup hook (issue #6). Mirrors the headroom hook:
  // reads config from .bizar/memory.json + env vars, then calls
  // lightragStartupHook() which respects `lightrag.enabled` and the
  // BIZAR_LIGHTRAG_AUTOSTART env override. All errors are caught — the
  // dashboard must boot even when LightRAG can't start.
  try {
    const { lightragStartupHook } = await import('./memory-lightrag.mjs');
    lightragStartupHook(projectRoot).then((r) => {
      if (!r.ok) {
        console.warn('[bizar-dash] lightragStartupHook:', r.error || r.reason || 'not started');
      } else if (r.started) {
        console.log(`[bizar-dash] lightrag auto-started (pid=${r.pid})`);
      } else {
        console.log(`[bizar-dash] lightrag: ${r.reason || 'not started'}`);
      }
    }).catch((err) => {
      console.warn('[bizar-dash] lightragStartupHook error:', err?.message || err);
    });
  } catch (err) {
    console.warn('[bizar-dash] lightrag startup hook skipped:', err?.message || err);
  }

  // v5.2 — Background transcription worker for voice notes. Uploads
  // save audio immediately and enqueue the noteId here; the worker
  // drains the queue, calls Whisper (or BIZAR_WHISPER_ENDPOINT), and
  // broadcasts a `voice:updated` event so the dashboard updates in
  // place. Errors here MUST NOT block boot — the worker is best-effort
  // and a missing transcribe just leaves the note with no transcript.
  try {
    const { startTranscriptionWorker } = await import('./workers/transcription-worker.mjs');
    startTranscriptionWorker({ broadcast: localBroadcast });
  } catch (err) {
    console.warn('[bizar-dash] transcription worker failed to start:', err?.message || err);
  }

  // All /api/* routes go through apiRouter (after mod routes are checked).
  // IMPORTANT: mount v2 router FIRST so `/api/v2/*` matches before
  // apiRouter's internal 404 catch-all (api.mjs line ~109) can swallow it.
  // v2 plugin protocol
  // ──────────────────────────────────────────────────────────────────
  // HTTP+SSE bridge sourced from .bizar/research/OPENAPI_SPEC.yaml.
  // Mounted at /api/v2/* to avoid colliding with existing /api/* routes.
  // Auth: HTTP Basic (see v2-auth-file.mjs). Password persisted at
  // ~/.cache/bizarharness/dash-auth.json (mode 0600).
  try {
    v2Auth = loadOrCreateAuth({ port: V2_DEFAULT_PORT });
    v2Bus = new V2EventBus({ logger: console });
    // eslint-disable-next-line no-console
    console.log(
      `[v2] auth file: ${v2Auth.file} (port ${v2Auth.port}, password len ${v2Auth.password.length})`,
    );
    app.use(
      '/api/v2',
      createV2Router({
        eventBus: v2Bus,
        getPassword: () => v2Auth.password,
        version: '0.7.0-alpha.1',
        startedAt: Date.now(),
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[v2] failed to initialize:', err?.message || err);
  }

  // v3.6.2 — Auth now wraps mod routes too. Previously mods mounted at
  // `/api/mods/<id>` BEFORE `requireAuth`, which meant every mod route
  // silently bypassed bearer-token checks.
  const { requireAuth } = await import('./auth.mjs');
  app.use('/api', requireAuth({ skipPaths: ['/auth/status', '/pair/verify', '/v2/health', '/v2/doc'] }));

  // ── Mod route mounting ──────────────────────────────────────────────
  {
    const modCtx = { broadcast: localBroadcast, state, projectRoot, clineConfigDir };
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
      } catch (err) {
        console.warn('swallowed in 403 destroy:', err.message);
      }
      return;
    }
    if (!checkWebSocketAuth(req)) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      } catch (err) {
        console.warn('swallowed in 401 destroy:', err.message);
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
        } catch (err) {
          console.warn('swallowed in heartbeat terminate:', err.message);
        }
        return;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch (err) {
          console.warn('swallowed in ping-fail terminate:', err.message);
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
      // v3.23.0 — Serve the mobile CSS at a stable /mobile.css URL so the
      // desktop index.html can link to it without needing to know the hash.
      // MobileApp renders the mobile shell; without its CSS the user sees
      // unformatted HTML. The actual file is named mobile-<hash>.css; we
      // resolve it at startup so the URL is stable.
      try {
        const mobileCss = readdirSync(assetsDir).find((f) => /^mobile-.*\.css$/.test(f));
        if (mobileCss) {
          app.get('/mobile.css', (_req, res) => {
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(join(assetsDir, mobileCss));
          });
        }
      } catch { /* ignore — mobile.css won't be served, fine */ }
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
    wsClientsGauge.set(wss.clients.size);
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', () => {
      wsClientsGauge.set(wss.clients.size);
    });
    ws.on('error', () => {
      wsClientsGauge.set(wss.clients.size);
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
        } catch (err) {
          console.warn('swallowed in sendLogChunk:', err.message);
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
          data: buildSnapshotSafe(state, clineConfigDir),
        }),
      );
    } catch (err) {
      console.warn('swallowed in ws snapshot send:', err.message);
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

  // v3.11.0 — Periodic recovery for bg instances stuck in
  // `dispatchPending: true` with `toolCallCount === 0`. Before this
  // existed, the only unstick path was the user manually hitting
  // `POST /api/tasks/:id/start`. The retry loop walks every bg
  // state file every 30s, attempts to re-dispatch via the cline
  // serve child, and caps each instance at MAX_DISPATCH_RETRIES
  // (10) before marking it `failed`.
  try {
    startBgRetryLoop();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bizar-dash] failed to start bg-retry loop:', err.message);
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
    } catch (err) {
      console.warn('swallowed in stopBgPoller:', err.message);
    }
    try {
      stopBgRetryLoop();
    } catch (err) {
      console.warn('swallowed in stopBgRetryLoop:', err.message);
    }
    try {
      watcher.stop();
    } catch (err) {
      console.warn('swallowed in watcher.stop:', err.message);
    }
    try {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
    } catch (err) {
      console.warn('swallowed in wss.close:', err.message);
    }
    try {
      clearInterval(heartbeatInterval);
    } catch (err) {
      console.warn('swallowed in clearInterval:', err.message);
    }
    try {
      server.close();
    } catch (err) {
      console.warn('swallowed in server.close:', err.message);
    }
    currentBroadcast = () => {};
  }

  return { app, server, wss, state, watcher, port, close };
}

function buildSnapshotSafe(state, clineConfigDir) {
  try {
    return buildSnapshot(state, clineConfigDir);
  } catch (err) {
    return { error: 'snapshot_failed', message: err.message };
  }
}

function buildSnapshot(state, clineConfigDir) {
  const cfgFile = join(clineConfigDir, 'cline.json');
  // v5.0.0 — Bug S2: read cline.json via the 1s-debounced cache in
  // providers-store.mjs. WS clients connect on snapshot delivery; with N
  // clients the readFileSync here was the main per-connection blocker.
  // The cache collapses all reads within a 1-second window to a single
  // disk hit. Writes (settings change, providers-store mutations)
  // invalidate the cache, so the snapshot always reflects the latest
  // state within at most 1s.
  const exists = existsSync(cfgFile);
  const cfg = readClineJsonCached();
  const activeProject = projectsStore.active();
  return {
    overview: state.getOverview(),
    agents: agentsStore.list(),
    artifacts: state.getArtifacts(),
    projects: projectsStore.list().projects,
    activeProject,
    config: {
      path: cfgFile,
      data: exists ? cfg : null,
      raw: exists && cfg ? JSON.stringify(cfg, null, 2) : '',
      exists,
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
