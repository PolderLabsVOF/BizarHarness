/**
 * tests/plugins-permissions.test.mjs
 *
 * v5.3.0 — Tests for plugin permission enforcement:
 *
 *   1. safeInvoke rejects method-level permission denials
 *      before any plugin code runs (sandbox-side check).
 *   2. safeInvoke logs every allow/deny to the audit log
 *      (permission-audit.mjs).
 *   3. The /api/plugins/:id/invoke route handler surfaces a
 *      403 with the missing permissions for a denial.
 *   4. The /api/plugins/:id/audit endpoint returns the audit
 *      log filtered by plugin id.
 *
 * Strategy:
 *   - For sandbox-level tests we write a minimal plugin source to
 *     a tmpdir and call `loadPlugin` directly with `methodSpecs`
 *     (the manifest's `exports` array).
 *   - For route-level tests we exercise the real Express route
 *     handler by materialising a `req`/`res` mock and calling the
 *     handler via `router.stack`. We drive it through `store.mjs`
 *     by materialising a fake installed plugin on disk under a
 *     private `BIZAR_PLUGIN_HOME` — this avoids any need to mock
 *     ESM namespace exports (which are frozen at runtime).
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = await import(resolve(REPO, 'src/server/plugins/sandbox.mjs'));
const AUDIT = await import(resolve(REPO, 'src/server/plugins/permission-audit.mjs'));
const ROUTES = await import(resolve(REPO, 'src/server/routes/plugins.mjs'));
const STORE = await import(resolve(REPO, 'src/server/plugins/store.mjs'));

const TMP = join(tmpdir(), `bizar-perm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(TMP, { recursive: true });

// Sandbox plugin home — materialised for the integration tests at
// the bottom of the file. Set BEFORE the store module reads the env
// var at first call.
const INTEGRATION_HOME = join(tmpdir(),
  `bizar-perm-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(INTEGRATION_HOME, { recursive: true });
process.env.BIZAR_PLUGIN_HOME = INTEGRATION_HOME;

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Write a plugin source string to a tmp file, then load it through
 * the real `loadPlugin`. Returns the loaded object.
 *
 * @param {string} source
 * @param {object} [opts]
 * @param {string[]} [opts.permissions]
 * @param {Array<{ name: string, permissions?: string[] }>} [opts.methodSpecs]
 * @param {string} [opts.pluginId]
 */
async function loadFromSource(source, opts = {}) {
  const file = join(TMP, `plugin-${Math.random().toString(36).slice(2)}.js`);
  writeFileSync(file, source);
  return SANDBOX.loadPlugin({
    mainFile: file,
    config: opts.config || {},
    permissions: opts.permissions || [],
    pluginId: opts.pluginId || 'test-plugin',
    pluginRoot: TMP,
    timeoutMs: opts.timeoutMs || 5_000,
    methodSpecs: opts.methodSpecs || [],
  });
}

/**
 * Minimal stand-in for the Express `req` object.
 */
function fakeReq(partial = {}) {
  return {
    params: {},
    body: {},
    query: {},
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...partial,
  };
}

/**
 * Minimal stand-in for the Express `res` object. Records every call
 * to `status`, `json`, and `end` so tests can assert on the actual
 * HTTP response that would have been sent. `res.json()` defaults the
 * status code to 200 (matching Express's real behaviour) so tests
 * can assert either `statusCode === 200` (success paths) or the
 * explicit `status(403)` set by the handler (error paths).
 */
function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    ended: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      // Express's real `res.json` calls `res.send`, which sets the
      // status to 200 by default if `res.status` wasn't called first.
      if (res.statusCode === null) res.statusCode = 200;
      res.body = payload;
      res.ended = true;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

/**
 * Find the first Express route handler registered for `method path`.
 */
function findRouteHandler(router, method, pathname) {
  const layers = router.stack || [];
  for (const layer of layers) {
    if (!layer.route) continue;
    const route = layer.route;
    if (!route.methods[method]) continue;
    if (route.path !== pathname) continue;
    const handle = route.stack?.[0]?.handle;
    if (typeof handle !== 'function') continue;
    return { handler: handle, path: route.path };
  }
  return null;
}

/**
 * Materialise an "installed plugin" on disk under our dedicated
 * `INTEGRATION_HOME` so `store.invokePlugin` can load it for real.
 * Writes both `plugin.json` (the manifest) AND `installed.json`
 * (the registry that `store.getInstalled()` reads), otherwise the
 * store would report `not_installed`.
 *
 * @param {string} id
 * @param {object} manifest   full plugin.json contents
 * @param {string} source     plugin source code
 * @returns {string}  absolute path to the plugin's install dir
 */
function installFakePlugin(id, manifest, source) {
  const pluginDir = join(INTEGRATION_HOME, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
  writeFileSync(join(pluginDir, manifest.main || 'index.js'), source);

  // Append the plugin entry to installed.json so store.getInstalled
  // can find it. We read any existing entries first to avoid clobbering
  // plugins installed by earlier tests in the same file.
  const installedPath = join(INTEGRATION_HOME, 'installed.json');
  /** @type {{ plugins: Array<object> }} */
  let doc = { plugins: [] };
  try {
    const existing = JSON.parse(readFileSync(installedPath, 'utf8'));
    if (existing && Array.isArray(existing.plugins)) doc = existing;
  } catch { /* file missing or malformed — start fresh */ }
  doc.plugins = doc.plugins.filter((p) => p.id !== id);
  doc.plugins.push({
    id,
    version: manifest.version || '1.0.0',
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: {},
    permissions: manifest.permissions || [],
    path: pluginDir,
  });
  writeFileSync(installedPath, JSON.stringify(doc, null, 2));
  return pluginDir;
}

// ── lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  AUDIT.clearPermissionAuditLog();
});

after(() => {
  // Tear down scratch directories so we don't leave debris in /tmp.
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(INTEGRATION_HOME, { recursive: true, force: true }); } catch { /* noop */ }
});

// ── tests ────────────────────────────────────────────────────────────────

describe('plugin permissions — sandbox-side enforcement', () => {
  test('safeInvoke rejects when required permission is missing', async () => {
    const loaded = await loadFromSource(
      `module.exports = { doSomething: async () => 'did-it' };`,
      {
        permissions: ['net'],
        methodSpecs: [{ name: 'doSomething', permissions: ['fs'] }],
        pluginId: 'perm-test-missing',
      },
    );
    const r = await SANDBOX.safeInvoke(loaded, 'doSomething', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'permission_denied');
    assert.deepEqual(r.missing, ['fs']);
    assert.match(r.error, /requires permissions: fs/);
  });

  test('safeInvoke rejects when ALL declared perms are missing', async () => {
    const loaded = await loadFromSource(
      `module.exports = { run: async () => 1 };`,
      {
        permissions: [],
        methodSpecs: [{ name: 'run', permissions: ['net', 'fs:read'] }],
        pluginId: 'perm-test-all-missing',
      },
    );
    const r = await SANDBOX.safeInvoke(loaded, 'run', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'permission_denied');
    assert.deepEqual(r.missing, ['net', 'fs:read']);
  });

  test('safeInvoke allows when required permission is granted', async () => {
    const loaded = await loadFromSource(
      `module.exports = { echo: async (x) => 'echo:' + x };`,
      {
        // The sandbox's KNOWN_PERMS is `['net', 'fs:read']` — anything
        // else is reported as `invalid`. Use the canonical name here
        // so the `permissions` array is parsed to the granted set.
        permissions: ['net', 'fs:read'],
        methodSpecs: [{ name: 'echo', permissions: ['fs:read'] }],
        pluginId: 'perm-test-allow',
      },
    );
    const r = await SANDBOX.safeInvoke(loaded, 'echo', ['hi']);
    assert.equal(r.ok, true);
    assert.equal(r.result, 'echo:hi');
  });

  test('safeInvoke skips the check when methodSpecs is empty (legacy plugins)', async () => {
    // No methodSpecs at all — the plugin loaded without a manifest.
    // Legacy behaviour must continue to work: bypass the check and
    // run the method.
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'ok' };`,
      {
        permissions: [],
        // methodSpecs omitted on purpose
        pluginId: 'perm-test-legacy',
      },
    );
    const r = await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.equal(r.ok, true);
    assert.equal(r.result, 'ok');
  });

  test('safeInvoke allows undeclared methods even when perms are insufficient', async () => {
    const loaded = await loadFromSource(
      `module.exports = { declared: async () => 'a', undeclared: async () => 'b' };`,
      {
        permissions: ['net'],
        methodSpecs: [{ name: 'declared', permissions: ['fs'] }],
        pluginId: 'perm-test-partial',
      },
    );
    const r1 = await SANDBOX.safeInvoke(loaded, 'declared', []);
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'permission_denied');
    const r2 = await SANDBOX.safeInvoke(loaded, 'undeclared', []);
    assert.equal(r2.ok, true);
    assert.equal(r2.result, 'b');
  });
});

describe('plugin permissions — audit log', () => {
  test('logs a denied invocation with allowed=false', async () => {
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'should-not-run' };`,
      {
        permissions: ['net'],
        methodSpecs: [{ name: 'go', permissions: ['fs'] }],
        pluginId: 'audit-test-denied',
      },
    );
    const r = await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.equal(r.code, 'permission_denied');
    const log = AUDIT.getPermissionAuditLog({ pluginId: 'audit-test-denied' });
    assert.ok(log.length >= 1, 'audit log should have at least one entry');
    const denied = log.find((e) => e.allowed === false);
    assert.ok(denied, 'should have an allowed=false entry');
    assert.equal(denied.method, 'go');
    assert.equal(denied.permission, 'fs');
    assert.equal(denied.pluginId, 'audit-test-denied');
  });

  test('logs an allowed invocation with allowed=true', async () => {
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'ok' };`,
      {
        permissions: ['net', 'fs:read'],
        methodSpecs: [{ name: 'go', permissions: ['fs:read'] }],
        pluginId: 'audit-test-allowed',
      },
    );
    await SANDBOX.safeInvoke(loaded, 'go', []);
    const log = AUDIT.getPermissionAuditLog({ pluginId: 'audit-test-allowed' });
    assert.ok(log.length >= 1);
    const allowed = log.find((e) => e.allowed === true);
    assert.ok(allowed, 'should have an allowed=true entry');
    assert.equal(allowed.method, 'go');
    assert.equal(allowed.permission, 'fs:read');
  });

  test('audit log filters by plugin id', async () => {
    const loadedA = await loadFromSource(
      `module.exports = { go: async () => 'a' };`,
      {
        permissions: [],
        methodSpecs: [{ name: 'go', permissions: ['net'] }],
        pluginId: 'audit-A',
      },
    );
    const loadedB = await loadFromSource(
      `module.exports = { go: async () => 'b' };`,
      {
        permissions: [],
        methodSpecs: [{ name: 'go', permissions: ['net'] }],
        pluginId: 'audit-B',
      },
    );
    await SANDBOX.safeInvoke(loadedA, 'go', []);
    await SANDBOX.safeInvoke(loadedB, 'go', []);
    const onlyA = AUDIT.getPermissionAuditLog({ pluginId: 'audit-A' });
    for (const entry of onlyA) {
      assert.equal(entry.pluginId, 'audit-A');
    }
    const onlyB = AUDIT.getPermissionAuditLog({ pluginId: 'audit-B' });
    for (const entry of onlyB) {
      assert.equal(entry.pluginId, 'audit-B');
    }
  });

  test('audit log entries are newest-first', async () => {
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'ok' };`,
      {
        permissions: ['net'],
        methodSpecs: [{ name: 'go', permissions: ['fs'] }],
        pluginId: 'audit-test-order',
      },
    );
    await SANDBOX.safeInvoke(loaded, 'go', []);
    await SANDBOX.safeInvoke(loaded, 'go', []);
    await SANDBOX.safeInvoke(loaded, 'go', []);
    const log = AUDIT.getPermissionAuditLog({ pluginId: 'audit-test-order' });
    assert.ok(log.length >= 3);
    for (let i = 1; i < log.length; i++) {
      const prev = new Date(log[i - 1].timestamp).getTime();
      const cur = new Date(log[i].timestamp).getTime();
      assert.ok(prev >= cur, `entry ${i} should be older than entry ${i - 1}`);
    }
  });

  test('clearPermissionAuditLog wipes the buffer', async () => {
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'ok' };`,
      {
        permissions: [],
        methodSpecs: [{ name: 'go', permissions: ['net'] }],
        pluginId: 'audit-test-clear',
      },
    );
    await SANDBOX.safeInvoke(loaded, 'go', []);
    assert.ok(AUDIT.getPermissionAuditLog({ pluginId: 'audit-test-clear' }).length >= 1);
    AUDIT.clearPermissionAuditLog();
    assert.equal(
      AUDIT.getPermissionAuditLog({ pluginId: 'audit-test-clear' }).length,
      0,
    );
  });

  test('limit clamps the number of returned entries', async () => {
    const loaded = await loadFromSource(
      `module.exports = { go: async () => 'ok' };`,
      {
        permissions: [],
        methodSpecs: [{ name: 'go', permissions: ['net'] }],
        pluginId: 'audit-test-limit',
      },
    );
    for (let i = 0; i < 5; i++) {
      await SANDBOX.safeInvoke(loaded, 'go', []);
    }
    const log = AUDIT.getPermissionAuditLog({
      pluginId: 'audit-test-limit',
      limit: 2,
    });
    assert.equal(log.length, 2);
  });
});

describe('plugin permissions — HTTP route surface', () => {
  test('POST /plugins/:id/invoke returns 403 with `missing` array for a denial', async () => {
    // Materialise an installed plugin with a method whose declared
    // permissions aren't granted. Going through `store.invokePlugin`
    // exercises the real path the route uses, so the test verifies
    // both the route's status-code mapping AND end-to-end behavior.
    const PLUGIN_ID = 'route-deny';
    installFakePlugin(
      PLUGIN_ID,
      {
        id: PLUGIN_ID,
        version: '1.0.0',
        main: 'index.js',
        permissions: ['net'],
        exports: [{ name: 'doSomething', permissions: ['fs'] }],
      },
      `module.exports = { doSomething: async () => 'should-not-run' };`,
    );

    const router = ROUTES.createPluginsRouter();
    const found = findRouteHandler(router, 'post', '/plugins/:id/invoke');
    assert.ok(found, 'invoke route should be registered');

    const req = fakeReq({
      params: { id: PLUGIN_ID },
      body: { method: 'doSomething', args: [] },
    });
    const res = fakeRes();
    await found.handler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'permission_denied');
    assert.match(res.body.message, /requires permissions: fs/);
    assert.deepEqual(res.body.missing, ['fs']);
  });

  test('POST /plugins/:id/invoke returns 400 for non-permission usage errors', async () => {
    // Use a non-existent plugin id so store.invokePlugin returns
    // { ok: false, code: 'not_installed' } — exercises the 400 path.
    const router = ROUTES.createPluginsRouter();
    const found = findRouteHandler(router, 'post', '/plugins/:id/invoke');
    assert.ok(found);

    const req = fakeReq({
      params: { id: 'no-such-plugin' },
      body: { method: 'doSomething', args: [] },
    });
    const res = fakeRes();
    await found.handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'not_installed');
    assert.equal(res.ended, true);
  });

  test('GET /plugins/:id/audit returns audit log filtered by id (newest-first)', async () => {
    // Seed two plugins' audit entries directly, then exercise the route.
    AUDIT.logPermissionUse('route-test-plugin', 'foo', 'net', false);
    AUDIT.logPermissionUse('route-test-plugin', 'foo', 'fs:read', true);
    AUDIT.logPermissionUse('other-plugin', 'foo', 'net', false);

    const router = ROUTES.createPluginsRouter();
    const found = findRouteHandler(router, 'get', '/plugins/:id/audit');
    assert.ok(found, 'audit route should be registered');

    const req = fakeReq({ params: { id: 'route-test-plugin' } });
    const res = fakeRes();
    await found.handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.audit));
    assert.ok(res.body.audit.length >= 2);
    for (const entry of res.body.audit) {
      assert.equal(entry.pluginId, 'route-test-plugin');
    }
  });

  test('GET /plugins/:id/audit honours ?limit=N', async () => {
    for (let i = 0; i < 5; i++) {
      AUDIT.logPermissionUse('limit-test', 'foo', 'net', i % 2 === 0);
    }
    const router = ROUTES.createPluginsRouter();
    const found = findRouteHandler(router, 'get', '/plugins/:id/audit');
    const req = fakeReq({
      params: { id: 'limit-test' },
      query: { limit: '3' },
    });
    const res = fakeRes();
    await found.handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.audit.length, 3);
  });
});

describe('plugin permissions — store integration', () => {
  test('store.invokePlugin enforces method-level permissions end-to-end', async () => {
    const PLUGIN_ID = 'store-end-to-end';
    installFakePlugin(
      PLUGIN_ID,
      {
        id: PLUGIN_ID,
        version: '1.0.0',
        main: 'index.js',
        permissions: ['net'],
        exports: [{ name: 'needsFS', permissions: ['fs:read'] }],
      },
      `module.exports = {
         async needsFS() { return 'should-not-reach'; },
         async publicMethod() { return 'public-ok'; }
       };`,
    );
    const denied = await STORE.invokePlugin(PLUGIN_ID, 'needsFS', []);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'permission_denied');
    assert.deepEqual(denied.missing, ['fs:read']);

    const allowed = await STORE.invokePlugin(PLUGIN_ID, 'publicMethod', []);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.result, 'public-ok');
  });
});
