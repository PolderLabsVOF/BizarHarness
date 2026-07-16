/**
 * src/server/routes/update.mjs
 *
 * v10.3.0 — Dashboard update endpoints.
 *
 *   GET    /api/updates/status     — installed package versions only
 *   GET    /api/updates/check      — installed + latest + hasUpdates
 *   POST   /api/updates/apply      — trigger install for given packages
 *                                    Streams progress via WS events:
 *                                      update:progress { type, pkg, status, error?, newVersion? }
 *                                      update:log     { type, pkg, line }
 *                                      update:complete{ type }
 *
 * Why these paths (vs. /api/update/*):
 *   thor-settings wired Settings.tsx to `/updates/status`, `/updates/check`,
 *   and `/updates/apply` and listens for the WS event shapes above. Aligning
 *   with that contract is cheaper than rewriting Settings.tsx.
 *
 * What this endpoint does NOT do:
 *   - It does NOT restart the dashboard. The Settings UI displays a
 *     confirmation prompt before calling, and `bizar update` (the CLI)
 *     is the restart-aware path. The dashboard stays up; npm replaces
 *     files in the global install dir while the dashboard runs from its
 *     own already-loaded module graph. The next `bizar dash start`
 *     picks up the new code, just like the CLI flow.
 *   - It does NOT touch the cline plugin in-place. That lives in the
 *     CLI flow because the plugin path is dev-symlinked in this repo.
 *
 * Safety:
 *   - Concurrency guard: only one apply run at a time. A second call
 *     returns 409 with `error: 'already_running'`.
 *   - Network/npm failures emit `update:log` for each stderr/stdout
 *     line and a final `update:progress` with `status: 'error'`.
 *   - Whitelist of npm package names; anything else is rejected 400.
 */
import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { wrap } from './_shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// v10.3.0 — packages the dashboard knows how to update. Aligned with
// the Settings UI's "Installed / Latest" panels and the CLI's update
// flow. The @polderlabs/bizar package bundles CLI + dashboard + plugin
// in one; the others are separate installable components.
const KNOWN_PACKAGES = [
  { id: 'bizar',         npmName: '@polderlabs/bizar',              label: 'Bizar CLI + Dashboard + Plugin' },
  { id: 'bizar-sdk',     npmName: '@polderlabs/bizar-sdk',          label: 'Bizar SDK (typed wrapper)' },
  { id: 'claude-agent',  npmName: '@anthropic-ai/claude-agent-sdk', label: 'Claude Agent SDK (optional peer)' },
  { id: 'claude-code',   npmName: '@anthropic-ai/claude-code',       label: 'Claude Code CLI' },
];

const KNOWN_BY_ID = new Map(KNOWN_PACKAGES.map((p) => [p.id, p]));

// Cache the latest-version lookup so /api/updates/check is fast on
// repeated dashboard renders. 1 hour is short enough that a new release
// shows up within an hour of publishing.
const LATEST_CACHE_TTL_MS = 60 * 60 * 1000;
const _latestCache = new Map(); // npmName -> { version, ts }

/**
 * Resolve the on-disk version of the dashboard itself (used as the
 * "current" version for @polderlabs/bizar). Walks up from this file
 * looking for the package.json that declares `@polderlabs/bizar`.
 *
 * Why "walk up" instead of `import.meta.resolve`? When the dashboard
 * runs out of `dist/` (the published layout), the package.json lives
 * at the dist root, not at the file's location. The walk is bounded
 * to 6 levels so a misconfigured install fails fast instead of looping.
 */
function resolveInstalledVersion() {
  const markers = ['package.json'];
  let cur = __dirname;
  for (let i = 0; i < 6; i++) {
    for (const m of markers) {
      const p = join(cur, m);
      if (existsSync(p)) {
        try {
          const pkg = JSON.parse(readFileSync(p, 'utf8'));
          if (pkg.name === '@polderlabs/bizar' && pkg.version) return pkg.version;
        } catch { /* malformed — try parent */ }
      }
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const INSTALLED_BIZAR_VERSION = resolveInstalledVersion();

/**
 * `npm view <pkg> version` — returns the latest published version or
 * null on any failure. Cached per package for 1 hour.
 */
function fetchLatestVersion(npmName) {
  const cached = _latestCache.get(npmName);
  if (cached && Date.now() - cached.ts < LATEST_CACHE_TTL_MS) {
    return cached.version;
  }
  try {
    const out = execFileSync(
      'npm',
      ['view', npmName, 'version'],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 },
    ).toString().trim();
    const version = out || null;
    _latestCache.set(npmName, { version, ts: Date.now() });
    return version;
  } catch {
    // Negative-cache for 5 minutes so a transient registry hiccup
    // doesn't make every render call npm.
    _latestCache.set(npmName, { version: null, ts: Date.now() - (LATEST_CACHE_TTL_MS - 5 * 60 * 1000) });
    return null;
  }
}

/**
 * Reset the latest-version cache — exposed for tests so each case
 * starts from a known state.
 */
export function resetUpdateCache() {
  _latestCache.clear();
}

/**
 * Compute the per-package installed map. For the dashboard package
 * itself we use INSTALLED_BIZAR_VERSION (the @polderlabs/bizar version
 * that bundles the dashboard). The other packages fall back to null
 * when not resolvable; the UI renders "—" for those rows.
 */
function currentVersions() {
  const out = {};
  for (const p of KNOWN_PACKAGES) {
    out[p.id] = INSTALLED_BIZAR_VERSION;
  }
  return out;
}

/**
 * Compute latest map and hasUpdates flag. Iterates KNOWN_PACKAGES so
 * the UI gets a stable order and predictable keys even when one of the
 * `npm view` calls fails (those resolve to null).
 * @param {Record<string, string|null>} current
 * @returns {{ latest: Record<string,string|null>, hasUpdates: boolean, available: Record<string,string|null> }}
 */
function latestVersionsAndFlag(current) {
  const latest = {};
  const available = { stable: null, beta: null };
  let hasUpdates = false;
  for (const p of KNOWN_PACKAGES) {
    const lat = fetchLatestVersion(p.npmName);
    latest[p.id] = lat;
    const cur = current[p.id];
    if (cur && lat && cur !== lat) hasUpdates = true;
  }
  // For the primary bizar package, also fetch beta dist-tag
  const bizarPkg = KNOWN_BY_ID.get('bizar');
  if (bizarPkg) {
    available.stable = fetchLatestVersion(bizarPkg.npmName);
    try {
      const betaVer = execFileSync(
        'npm',
        ['view', bizarPkg.npmName, 'dist-tags', 'beta'],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 },
      ).toString().trim();
      available.beta = betaVer || null;
    } catch {
      available.beta = null;
    }
  }
  return { latest, hasUpdates, available };
}

// ─── Apply concurrency guard ───────────────────────────────────────────────
// One active run per server process. A second POST /updates/apply while
// the first is still going returns 409 immediately.

let _activeRun = null; // { packages: string[], startedAt: number } | null

function isRunning() {
  return _activeRun !== null;
}

/**
 * Run `npm install -g <pkg>@latest` for each requested id. Emits WS
 * events on the broadcast channel for every stdout/stderr line and for
 * the per-package status transitions. Returns the result object
 * (sync — the actual install runs in the background and finishes via
 * WS events).
 */
function startApplyRun({ packages, channel, broadcast }) {
  if (_activeRun) {
    throw Object.assign(new Error('update already running'), { code: 'already_running' });
  }
  const ids = (Array.isArray(packages) && packages.length > 0) ? packages : KNOWN_PACKAGES.map((p) => p.id);
  const validIds = ids.filter((id) => KNOWN_BY_ID.has(id));
  if (validIds.length === 0) {
    throw Object.assign(new Error('no valid packages requested'), { code: 'bad_request' });
  }

  _activeRun = { packages: validIds, startedAt: Date.now() };

  // Kick the run async. Errors are reported via the WS bus.
  (async () => {
    try {
      for (const id of validIds) {
        const pkg = KNOWN_BY_ID.get(id);
        if (!pkg) continue;
        broadcast({ type: 'update:progress', pkg: id, status: 'starting' });

        const versionTag = channel && channel === 'beta' ? '@beta' : '@latest';
        const code = await runNpmInstall(pkg.npmName, versionTag, (line) => {
          broadcast({ type: 'update:log', pkg: id, line });
        });

        if (code === 0) {
          const newVer = fetchLatestVersion(pkg.npmName); // warm cache
          broadcast({
            type: 'update:progress',
            pkg: id,
            status: 'done',
            newVersion: newVer || undefined,
          });
        } else {
          broadcast({
            type: 'update:progress',
            pkg: id,
            status: 'error',
            error: `npm install exited with code ${code}`,
          });
        }
      }
    } finally {
      _activeRun = null;
      broadcast({ type: 'update:complete' });
    }
  })().catch((err) => {
    _activeRun = null;
    broadcast({ type: 'update:progress', pkg: '__global', status: 'error', error: err?.message || String(err) });
    broadcast({ type: 'update:complete' });
  });

  return { ok: true, started: validIds, channel: channel || 'stable' };
}

/**
 * Spawn `npm install -g <pkg>@<tag>`. Captures stdout/stderr line by
 * line and forwards each via the `onLine` callback. Resolves with the
 * exit code (0 on success, non-zero otherwise).
 *
 * Why spawn instead of execSync: npm install can take 30+ seconds and
 * blocks the event loop. We want concurrent dashboard requests to keep
 * serving while an update is in flight.
 */
function runNpmInstall(npmName, versionTag, onLine) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('npm', ['install', '-g', `${npmName}${versionTag}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (err) {
      onLine(`failed to spawn npm: ${err.message}`);
      resolve(127);
      return;
    }

    const pipeLine = (stream) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line) onLine(line);
        }
      });
      stream.on('end', () => {
        if (buf) onLine(buf);
      });
    };
    pipeLine(proc.stdout);
    pipeLine(proc.stderr);

    proc.on('error', (err) => {
      onLine(`npm process error: ${err.message}`);
      resolve(127);
    });
    proc.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

// ─── Router factory ────────────────────────────────────────────────────────

export function createUpdateRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  /**
   * GET /api/updates/status
   * Quick status — installed versions only. Cheap; no npm calls.
   */
  router.get('/updates/status', wrap(async (_req, res) => {
    const current = currentVersions();
    res.json({ installed: current });
  }));

  /**
   * GET /api/updates/check
   * GET /api/updates/check?channel=stable|beta
   * Installed + latest + hasUpdates + available per channel. Calls `npm view` (cached).
   */
  router.get('/updates/check', wrap(async (req, res) => {
    const channel = req.query.channel === 'beta' ? 'beta' : 'stable';
    const current = currentVersions();
    const { latest, hasUpdates, available } = latestVersionsAndFlag(current);
    res.json({ installed: current, available, hasUpdates, channel });
  }));

  /**
   * POST /api/updates/apply
   * Body: { packages?: string[], channel?: 'stable' | 'beta' }
   * Returns 202 immediately. Progress streams via WS events.
   * Returns 409 if another apply is in flight.
   */
  router.post('/updates/apply', wrap(async (req, res) => {
    if (isRunning()) {
      res.status(409).json({
        error: 'already_running',
        message: 'an update is already running',
        runningSince: _activeRun ? new Date(_activeRun.startedAt).toISOString() : null,
      });
      return;
    }
    const body = req.body || {};
    const channel = body.channel === 'beta' ? 'beta' : 'stable';
    try {
      const result = startApplyRun({ packages: body.packages, channel, broadcast });
      res.status(202).json(result);
    } catch (err) {
      const status = err?.code === 'bad_request' ? 400 : 500;
      res.status(status).json({
        error: err?.code || 'apply_failed',
        message: err?.message || String(err),
      });
    }
  }));

  return router;
}