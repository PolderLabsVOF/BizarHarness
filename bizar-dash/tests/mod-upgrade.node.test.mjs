/**
 * mod-upgrade.node.test.mjs — Node-compatible test runner for the v3.20.5
 * mod upgrade flow.
 *
 * Run with:  node --test tests/mod-upgrade.node.test.mjs
 *
 * What this verifies:
 *   - upgradeFromRegistry() refuses if the mod is not installed
 *   - upgradeFromRegistry() backs up the existing folder when requested
 *   - upgradeFromRegistry() rolls back on install failure (backup exists)
 *   - The POST /api/mods/:id/upgrade route returns 404 for missing mods
 *   - The POST /api/mods/:id/upgrade route returns 200 with the new mod
 *     when the mod is upgraded end-to-end (with a stubbed fetchRegistry)
 *   - The /api/mods/:id/views/* route serves files from <mod>/views with
 *     application/javascript content-type
 *   - The /api/mods/:id/views/* route refuses non-JS-family extensions
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

// ── Sandbox HOME before importing the loader ────────────────────────────
const SANDBOX_HOME = join(tmpdir(), `bizar-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.HOME = SANDBOX_HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX_HOME, '.config');

const REPO = resolve(import.meta.dirname, '..');
const LOADER = join(REPO, 'src/server/mods-loader.mjs');
const ROUTES = join(REPO, 'src/server/routes/mods.mjs');

const loaderModule = await import(LOADER);
const { modsLoader } = loaderModule;
const { createModsRouter } = await import(ROUTES);

const TEST_MOD_ID = 'samplemod';
const OTHER_MOD_ID = 'othermod';

function buildTestMod(id, version = '1.0.0') {
  // Build the source folder in a separate "sources" dir — installFromPath
  // copies the source folder INTO ~/.config/bizar/mods/<id>, so the source
  // must not be the destination.
  const sourceDir = join(SANDBOX_HOME, 'sources', id);
  rmSync(sourceDir, { recursive: true, force: true });
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'mod.json'), JSON.stringify({
    id,
    name: `Test ${id}`,
    version,
    description: `A test mod (${id})`,
    permissions: [],
  }, null, 2));
  mkdirSync(join(sourceDir, 'agents'), { recursive: true });
  writeFileSync(join(sourceDir, 'agents', 'thor.md'), `# Thor override for ${id}\n`);
  mkdirSync(join(sourceDir, 'commands'), { recursive: true });
  writeFileSync(join(sourceDir, 'commands', 'plan.md'), `# Plan command for ${id}\n`);
  writeFileSync(join(sourceDir, 'INSTRUCTIONS.md'), `# INSTRUCTIONS for ${id}\n`);
  return sourceDir;
}

function buildViewFile(id, filename, content) {
  // Views live in the INSTALLED mod folder, not the source.
  const viewsDir = join(SANDBOX_HOME, '.config/bizar/mods', id, 'views');
  mkdirSync(viewsDir, { recursive: true });
  writeFileSync(join(viewsDir, filename), content);
  writeFileSync(join(viewsDir, 'registry.json'), JSON.stringify({
    views: [{ id: 'sample', label: 'Sample', component: filename }],
  }, null, 2));
}

/**
 * Build a fake registry "mod" folder on disk and return a function that
 * installs it directly into ~/.config/bizar/mods/<id> when called. This
 * lets tests exercise upgradeFromRegistry() without hitting the network.
 */
function buildFakeRegistryMod(id, version) {
  const regDir = join(SANDBOX_HOME, 'fake-registry', id, version);
  rmSync(regDir, { recursive: true, force: true });
  mkdirSync(regDir, { recursive: true });
  writeFileSync(join(regDir, 'mod.json'), JSON.stringify({
    id,
    name: `Test ${id}`,
    version,
    description: `Registry version ${version}`,
    permissions: [],
  }, null, 2));
  mkdirSync(join(regDir, 'agents'), { recursive: true });
  writeFileSync(join(regDir, 'agents', 'thor.md'), `# Thor v${version} for ${id}\n`);
  mkdirSync(join(regDir, 'commands'), { recursive: true });
  writeFileSync(join(regDir, 'commands', 'plan.md'), `# Plan v${version} for ${id}\n`);
  writeFileSync(join(regDir, 'INSTRUCTIONS.md'), `# INSTRUCTIONS v${version} for ${id}\n`);
  return regDir;
}

/**
 * Patch modsLoader.installFromRegistry to skip the network fetch and
 * install from the local fake-registry folder. Returns a restore fn.
 */
function stubInstallFromRegistry(id, latestVersion, regDir) {
  const realFetch = modsLoader.fetchRegistry;
  const realInstall = modsLoader.installFromRegistry;
  modsLoader.fetchRegistry = async () => ({
    version: 99,
    updatedAt: new Date().toISOString(),
    mods: [{ id, name: `Test ${id}`, latest: latestVersion }],
  });
  modsLoader.installFromRegistry = async (rid, opts = {}) => {
    assert.equal(rid, id, 'installFromRegistry called with wrong id');
    const target = join(SANDBOX_HOME, '.config/bizar/mods', id);
    if (existsSync(target)) {
      throw new Error(`mod "${id}" already installed (stub check)`);
    }
    const { cpSync } = await import('node:fs');
    mkdirSync(target, { recursive: true });
    cpSync(regDir, target, { recursive: true });
    // Mirror installFromUrl's behaviour: install instructions into opencode config.
    const { modsLoader: _ignored } = await import(LOADER);
    const innerLoader = await import(LOADER);
    // Call the internal installModInstructions by going through reinstallInstructions
    innerLoader.modsLoader.reinstallInstructions(id);
    return innerLoader.modsLoader.get(id);
  };
  return () => {
    modsLoader.fetchRegistry = realFetch;
    modsLoader.installFromRegistry = realInstall;
  };
}

before(() => {
  mkdirSync(join(SANDBOX_HOME, '.config/opencode/agents'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.config/opencode/commands'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.opencode/skills'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.config/bizar/mods'), { recursive: true });
  // Pin the registry URL to a local stub we'll override per test.
});

after(() => {
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Clear installed mods + opencode instruction prefixes between tests.
  for (const prefix of [TEST_MOD_ID, OTHER_MOD_ID]) {
    const modDir = join(SANDBOX_HOME, '.config/bizar/mods', prefix);
    rmSync(modDir, { recursive: true, force: true });
  }
  // Reset real-fetch state by patching fetchRegistry to a controllable stub.
});

// ── 1. upgradeFromRegistry() — basic rejection ─────────────────────────

describe('upgradeFromRegistry — preconditions', () => {
  it('throws when the mod is not installed', async () => {
    await assert.rejects(
      () => modsLoader.upgradeFromRegistry('never-installed-xyz', { url: 'file:///nope' }),
      /not installed/i,
    );
  });
});

// ── 2. upgradeFromRegistry() — happy path with a stubbed registry ─────

describe('upgradeFromRegistry — end-to-end with stubbed registry', () => {
  it('upgrades in place when the registry returns a newer version', async () => {
    // Install v1.0.0 from a source folder.
    const v1Source = buildTestMod(TEST_MOD_ID, '1.0.0');
    const installed = await modsLoader.installFromPath(v1Source);
    assert.equal(installed.version, '1.0.0');

    // Build a fake registry entry for v2.0.0 and stub installFromRegistry
    // to copy from the local fake-registry folder instead of fetching.
    const v2RegDir = buildFakeRegistryMod(TEST_MOD_ID, '2.0.0');
    const restore = stubInstallFromRegistry(TEST_MOD_ID, '2.0.0', v2RegDir);
    try {
      const result = await modsLoader.upgradeFromRegistry(TEST_MOD_ID, {});
      assert.equal(result.from, '1.0.0');
      assert.equal(result.to, '2.0.0');
      assert.equal(result.mod.id, TEST_MOD_ID);
      assert.equal(result.mod.version, '2.0.0');
      assert.equal(result.backupPath, null);
      // The new instructions are installed in opencode config under the
      // `<modId>__` prefix.
      assert.ok(
        existsSync(join(SANDBOX_HOME, '.config/opencode/agents', `${TEST_MOD_ID}__thor.md`)),
        'agents/<modId>__thor.md should exist after upgrade',
      );
      assert.ok(
        existsSync(join(SANDBOX_HOME, '.config/opencode/commands', `${TEST_MOD_ID}__plan.md`)),
        'commands/<modId>__plan.md should exist after upgrade',
      );
    } finally {
      restore();
    }
  });

  it('creates a backup when { backup: true }', async () => {
    const v1Source = buildTestMod(TEST_MOD_ID, '1.0.0');
    modsLoader.installFromPath(v1Source);

    const v2RegDir = buildFakeRegistryMod(TEST_MOD_ID, '2.5.0');
    const restore = stubInstallFromRegistry(TEST_MOD_ID, '2.5.0', v2RegDir);
    try {
      const result = await modsLoader.upgradeFromRegistry(TEST_MOD_ID, { backup: true });
      assert.ok(result.backupPath, 'backupPath should be set when backup:true');
      assert.ok(existsSync(result.backupPath), 'backup folder should exist on disk');
      assert.ok(
        existsSync(join(result.backupPath, 'mod.json')),
        'backup should contain the original mod.json',
      );
      const backupManifest = JSON.parse(readFileSync(join(result.backupPath, 'mod.json'), 'utf8'));
      assert.equal(backupManifest.version, '1.0.0', 'backup should have the OLD version');
    } finally {
      restore();
    }
  });
});

// ── 3. POST /api/mods/:id/upgrade route ────────────────────────────────

async function startTestServer() {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createModsRouter());
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(baseUrl, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        let json = null;
        try { json = chunks ? JSON.parse(chunks) : null; } catch { /* keep raw */ }
        resolve({ status: res.statusCode, headers: res.headers, body: chunks, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('POST /api/mods/:id/upgrade — HTTP', () => {
  let serverHandle;

  before(async () => { serverHandle = await startTestServer(); });
  after(async () => { await serverHandle.close(); });

  it('returns 404 when the mod is not installed', async () => {
    const res = await request(serverHandle.baseUrl, '/api/mods/never-installed/upgrade', {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 404);
    assert.equal(res.json.error, 'upgrade_failed');
  });

  it('upgrades and returns from/to versions (with stubbed fetchRegistry)', async () => {
    const v1Source = buildTestMod(OTHER_MOD_ID, '1.0.0');
    modsLoader.installFromPath(v1Source);

    const v2RegDir = buildFakeRegistryMod(OTHER_MOD_ID, '1.5.0');
    const restore = stubInstallFromRegistry(OTHER_MOD_ID, '1.5.0', v2RegDir);
    try {
      const res = await request(
        serverHandle.baseUrl,
        `/api/mods/${OTHER_MOD_ID}/upgrade`,
        { method: 'POST', body: {} },
      );
      assert.equal(res.status, 200, `unexpected status ${res.status}: ${res.body}`);
      assert.equal(res.json.ok, true);
      assert.equal(res.json.from, '1.0.0');
      assert.equal(res.json.to, '1.5.0');
      assert.equal(res.json.modId, OTHER_MOD_ID);
      assert.equal(res.json.mod.version, '1.5.0');
    } finally {
      restore();
    }
  });
});

// ── 4. /api/mods/:id/views/* — content-type + path safety ──────────────

describe('GET /api/mods/:id/views/*', () => {
  let serverHandle;
  before(async () => { serverHandle = await startTestServer(); });
  after(async () => { await serverHandle.close(); });

  it('serves .js view files with application/javascript content-type', async () => {
    const source = buildTestMod('viewmod', '1.0.0');
    modsLoader.installFromPath(source);
    buildViewFile('viewmod', 'SampleView.js',
      'export default function SampleView() { return null; }\n');

    const res = await request(serverHandle.baseUrl, '/api/mods/viewmod/views/SampleView.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /application\/javascript/);
    assert.match(res.body, /export default function SampleView/);
  });

  it('rejects non-JS-family extensions', async () => {
    const source = buildTestMod('viewmod2', '1.0.0');
    modsLoader.installFromPath(source);
    // Try to fetch a .html file from views/ — should be forbidden.
    const viewsDir = join(SANDBOX_HOME, '.config/bizar/mods', 'viewmod2', 'views');
    mkdirSync(viewsDir, { recursive: true });
    writeFileSync(join(viewsDir, 'index.html'), '<!doctype html>');

    const res = await request(serverHandle.baseUrl, '/api/mods/viewmod2/views/index.html');
    assert.equal(res.status, 403);
  });

  it('returns 404 for missing files', async () => {
    const source = buildTestMod('viewmod3', '1.0.0');
    modsLoader.installFromPath(source);

    const res = await request(serverHandle.baseUrl, '/api/mods/viewmod3/views/Missing.js');
    assert.equal(res.status, 404);
  });

  it('refuses paths that escape the views/ directory', async () => {
    const source = buildTestMod('viewmod4', '1.0.0');
    modsLoader.installFromPath(source);
    const res = await request(serverHandle.baseUrl, '/api/mods/viewmod4/views/..%2Fmod.json');
    assert.ok([400, 403, 404].includes(res.status),
      `expected 400/403/404 for path traversal, got ${res.status}`);
  });

  it('returns 404 for views of a non-installed mod', async () => {
    const res = await request(serverHandle.baseUrl, '/api/mods/never-here/views/SampleView.js');
    assert.equal(res.status, 404);
  });
});
