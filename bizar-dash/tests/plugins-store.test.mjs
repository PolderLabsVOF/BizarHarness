/**
 * tests/plugins-store.test.mjs
 *
 * Tests for src/server/plugins/store.mjs:
 *   - listInstalled is empty before any install
 *   - installPlugin downloads, verifies checksum, extracts, registers
 *   - installPlugin refuses to reinstall without force
 *   - installPlugin rejects a checksum mismatch
 *   - installPlugin rejects a tarball with no plugin.json
 *   - uninstallPlugin removes disk + installed.json
 *   - updatePlugin preserves config across the version bump
 *   - invokePlugin runs an installed plugin in the sandbox
 *   - replaceConfig persists a new config
 *
 * Strategy: stand up a fake HTTP server that serves both a registry
 * JSON and a tarball on demand. Build the tarball in-memory using
 * node:tar's `tar.c` (create + gzip). Point the client at the server
 * with a fetch override + BIZAR_PLUGIN_HOME tmpdir.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pack as tarPack } from 'tar-stream';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Sandbox HOME + plugin home BEFORE importing the store ────────────────
// The store reads BIZAR_PLUGIN_HOME at import time, so set it first.
const SANDBOX_HOME = join(tmpdir(), `bizar-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.HOME = SANDBOX_HOME;
process.env.BIZAR_PLUGIN_HOME = join(SANDBOX_HOME, 'plugins');
mkdirSync(SANDBOX_HOME, { recursive: true });
mkdirSync(process.env.BIZAR_PLUGIN_HOME, { recursive: true });

const STORE = await import(resolve(REPO, 'src/server/plugins/store.mjs'));
const REG = await import(resolve(REPO, 'src/server/plugins/registry.mjs'));

function sha256OfBuffer(buf) {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a gzip-compressed tarball in memory. The contents are a
 * synthetic plugin: { plugin.json, index.js }.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.version
 * @param {string} [opts.mainSource]  source code for index.js
 * @param {string[]} [opts.permissions]
 * @param {string} [opts.wrapper]     'flat' (default) | 'topdir' (one top-level dir)
 */
async function buildTarball(opts) {
  const { id, version, mainSource, permissions = [], wrapper = 'flat' } = opts;
  const tmpDir = join(SANDBOX_HOME, 'tarball-src', id);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const manifest = {
    id,
    name: `Test ${id}`,
    version,
    description: `Synthetic test plugin ${id}@${version}`,
    permissions,
    main: 'index.js',
    exports: [
      { name: 'whoami', args: [], returns: 'string' },
      { name: 'echo', args: [{ name: 'msg', type: 'string' }], returns: 'string' },
      { name: 'init', args: [], returns: 'void' },
    ],
  };
  const indexSrc = mainSource || `
    module.exports = {
      async whoami() { return '${id}@${version}'; },
      async echo(msg) { return 'echo:' + msg; },
      async init() { /* no-op */ },
    };
  `;
  writeFileSync(join(tmpDir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(tmpDir, 'index.js'), indexSrc);

  // Build the tarball as a Buffer. tar-stream's `pack()` is a
  // Transform stream: we collect bytes by piping through a PassThrough
  // (or directly collecting chunks after attach a data listener).
  // The trick is to attach the 'data' listener BEFORE finalize()
  // so the stream can flow.
  const tarBytes = await new Promise((res, rej) => {
    const packer = tarPack();
    const chunks = [];
    packer.on('data', (c) => chunks.push(c));
    packer.on('end', () => res(Buffer.concat(chunks)));
    packer.on('error', rej);
    const pluginJsonBuf = readFileSync(join(tmpDir, 'plugin.json'));
    const indexBuf = readFileSync(join(tmpDir, 'index.js'));
    if (wrapper === 'topdir') {
      packer.entry({ name: `${id}/plugin.json`, size: pluginJsonBuf.length }, pluginJsonBuf);
      packer.entry({ name: `${id}/index.js`, size: indexBuf.length }, indexBuf);
    } else {
      packer.entry({ name: 'plugin.json', size: pluginJsonBuf.length }, pluginJsonBuf);
      packer.entry({ name: 'index.js', size: indexBuf.length }, indexBuf);
    }
    packer.finalize();
  });

  // Gzip-compress.
  return new Promise((res, rej) => {
    const gzChunks = [];
    const gz = createGzip();
    gz.on('data', (c) => gzChunks.push(c));
    gz.on('end', () => res(Buffer.concat(gzChunks)));
    gz.on('error', rej);
    gz.end(tarBytes);
  });
}

// ── Fake registry server ──────────────────────────────────────────────────

let server;
let serverUrl;
let servedTarballs = {}; // id -> { buf, version }
let servedRegistry = { version: 1, updatedAt: 'x', plugins: [] };

function rebuildRegistry() {
  servedRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    plugins: Object.entries(servedTarballs).map(([id, { buf, version }]) => ({
      id,
      name: `Test ${id}`,
      version,
      description: '...',
      tarball: `${serverUrl}/tarball/${id}`,
      checksum: sha256OfBuffer(buf),
      permissions: [],
    })),
  };
}

async function startServer() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/registry.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(servedRegistry));
        return;
      }
      const m = /^\/tarball\/([a-z0-9-]+)$/.exec(req.url);
      if (m) {
        const id = m[1];
        const entry = servedTarballs[id];
        if (!entry) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
        res.end(entry.buf);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      r({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((rr) => s.close(rr)),
      });
    });
  });
}

before(async () => {
  server = await startServer();
  serverUrl = server.url;
});

after(async () => {
  if (server) await server.close();
  rmSync(SANDBOX_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  // Wipe installed state between tests so each starts clean.
  rmSync(process.env.BIZAR_PLUGIN_HOME, { recursive: true, force: true });
  mkdirSync(process.env.BIZAR_PLUGIN_HOME, { recursive: true });
  servedTarballs = {};
  REG.__resetCache();
});

// ── listInstalled / readInstalled ────────────────────────────────────────

describe('listInstalled', () => {
  test('returns [] before any install', () => {
    assert.deepEqual(STORE.listInstalled(), []);
  });

  test('reads installed.json even if empty', () => {
    writeFileSync(
      join(process.env.BIZAR_PLUGIN_HOME, 'installed.json'),
      JSON.stringify({ plugins: [] }),
    );
    assert.deepEqual(STORE.listInstalled(), []);
  });

  test('returns [] for a malformed installed.json', () => {
    writeFileSync(
      join(process.env.BIZAR_PLUGIN_HOME, 'installed.json'),
      'not json',
    );
    assert.deepEqual(STORE.listInstalled(), []);
  });
});

// ── installPlugin happy path ─────────────────────────────────────────────

/**
 * Convenience: pass the fake registry URL through to installPlugin
 * so every call below doesn't need to spell it out.
 */
const registryUrl = () => `${serverUrl}/registry.json`;

describe('installPlugin', () => {
  test('installs a plugin from the registry (flat tarball)', async () => {
    servedTarballs['hello'] = { buf: await buildTarball({ id: 'hello', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();

    const r = await STORE.installPlugin('hello', { url: registryUrl() });
    assert.equal(r.id, 'hello');
    assert.equal(r.version, '1.0.0');
    assert.ok(r.installedAt);
    assert.ok(r.path);
    assert.ok(existsSync(join(r.path, 'plugin.json')));
    assert.ok(existsSync(join(r.path, 'index.js')));

    // installed.json records the plugin.
    const listed = STORE.listInstalled();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'hello');
  });

  test('installs a plugin from the registry (top-level dir wrapper)', async () => {
    servedTarballs['wrapped'] = {
      buf: await buildTarball({ id: 'wrapped', version: '1.0.0', wrapper: 'topdir' }),
      version: '1.0.0',
    };
    rebuildRegistry();

    const r = await STORE.installPlugin('wrapped', { url: registryUrl() });
    assert.ok(existsSync(join(r.path, 'plugin.json')));
  });

  test('refuses to reinstall without force', async () => {
    servedTarballs['dup'] = { buf: await buildTarball({ id: 'dup', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('dup', { url: registryUrl() });
    await assert.rejects(
      () => STORE.installPlugin('dup', { url: registryUrl() }),
      (err) => err.code === 'already_installed',
    );
  });

  test('force=true reinstalls', async () => {
    servedTarballs['forced'] = { buf: await buildTarball({ id: 'forced', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('forced', { url: registryUrl() });
    const r2 = await STORE.installPlugin('forced', { force: true, url: registryUrl() });
    assert.equal(r2.id, 'forced');
  });

  test('rejects a checksum mismatch', async () => {
    const buf = await buildTarball({ id: 'evil', version: '1.0.0' });
    servedTarballs['evil'] = { buf, version: '1.0.0' };
    // Build the registry with a WRONG checksum.
    servedRegistry = {
      version: 1,
      updatedAt: new Date().toISOString(),
      plugins: [{
        id: 'evil', name: 'Evil', version: '1.0.0',
        tarball: `${serverUrl}/tarball/evil`,
        checksum: 'sha256:' + '0'.repeat(64),
        permissions: [],
      }],
    };
    REG.__resetCache();
    await assert.rejects(
      () => STORE.installPlugin('evil', { url: registryUrl() }),
      (err) => err.code === 'checksum_mismatch',
    );
    // No plugin should be on disk after a failed install.
    assert.equal(existsSync(join(process.env.BIZAR_PLUGIN_HOME, 'evil')), false);
  });

  test('rejects a tarball with no plugin.json', async () => {
    // Build a tarball that only contains a junk file.
    const tmpDir = join(SANDBOX_HOME, 'no-manifest');
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'README.md'), 'no manifest here');
    const tarBytes = await new Promise((res, rej) => {
      const packer = tarPack();
      const chunks = [];
      packer.on('data', (c) => chunks.push(c));
      packer.on('end', () => res(Buffer.concat(chunks)));
      packer.on('error', rej);
      const readmeBuf = readFileSync(join(tmpDir, 'README.md'));
      packer.entry({ name: 'README.md', size: readmeBuf.length }, readmeBuf);
      packer.finalize();
    });
    const gzBuf = await new Promise((res, rej) => {
      const gz = createGzip();
      const out = [];
      gz.on('data', (c) => out.push(c));
      gz.on('end', () => res(Buffer.concat(out)));
      gz.on('error', rej);
      gz.end(tarBytes);
    });
    servedTarballs['noman'] = { buf: gzBuf, version: '1.0.0' };
    rebuildRegistry();

    await assert.rejects(
      () => STORE.installPlugin('noman', { url: registryUrl() }),
      /contains no plugin\.json/,
    );
  });

  test('throws not_found for an unknown id', async () => {
    rebuildRegistry();
    await assert.rejects(
      () => STORE.installPlugin('never', { url: registryUrl() }),
      (err) => err.code === 'not_found',
    );
  });
});

// ── uninstallPlugin ──────────────────────────────────────────────────────

describe('uninstallPlugin', () => {
  test('removes disk + installed.json entry', async () => {
    servedTarballs['bye'] = { buf: await buildTarball({ id: 'bye', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('bye', { url: registryUrl() });
    const dir = join(process.env.BIZAR_PLUGIN_HOME, 'bye');
    assert.ok(existsSync(dir));

    const ok = STORE.uninstallPlugin('bye');
    assert.equal(ok, true);
    assert.equal(existsSync(dir), false);
    assert.equal(STORE.listInstalled().length, 0);
  });

  test('returns false for a not-installed id', () => {
    assert.equal(STORE.uninstallPlugin('never'), false);
  });
});

// ── updatePlugin ─────────────────────────────────────────────────────────

describe('updatePlugin', () => {
  test('upgrades to the latest registry version, preserving config', async () => {
    servedTarballs['updatable'] = { buf: await buildTarball({ id: 'updatable', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('updatable', { url: registryUrl() });
    STORE.replaceConfig('updatable', { apiKey: 'sk-test-123', enabled: true });

    // Bump the registry to 2.0.0 with a fresh tarball.
    servedTarballs['updatable'] = { buf: await buildTarball({ id: 'updatable', version: '2.0.0' }), version: '2.0.0' };
    rebuildRegistry();
    // Reset the in-memory cache so the next installPlugin() actually
    // re-fetches and sees the new checksum.
    REG.__resetCache();

    const r = await STORE.updatePlugin('updatable', { url: registryUrl() });
    assert.equal(r.from, '1.0.0');
    assert.equal(r.to, '2.0.0');
    // Config survived the update.
    const installed = STORE.getInstalled('updatable');
    assert.equal(installed.config.apiKey, 'sk-test-123');
    assert.equal(installed.config.enabled, true);
  });

  test('throws not_installed for a missing plugin', async () => {
    await assert.rejects(
      () => STORE.updatePlugin('never', { url: registryUrl() }),
      (err) => err.code === 'not_installed',
    );
  });
});

// ── invokePlugin ─────────────────────────────────────────────────────────

describe('invokePlugin', () => {
  test('runs a method on the installed plugin', async () => {
    servedTarballs['runner'] = { buf: await buildTarball({ id: 'runner', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('runner', { url: registryUrl() });

    const r = await STORE.invokePlugin('runner', 'whoami', []);
    assert.equal(r.ok, true);
    assert.equal(r.result, 'runner@1.0.0');

    const r2 = await STORE.invokePlugin('runner', 'echo', ['hi']);
    assert.equal(r2.ok, true);
    assert.equal(r2.result, 'echo:hi');
  });

  test('returns not_installed for a missing plugin', async () => {
    const r = await STORE.invokePlugin('never', 'echo', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not_installed');
  });

  test('returns no_such_method for an unknown method', async () => {
    servedTarballs['runs2'] = { buf: await buildTarball({ id: 'runs2', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('runs2', { url: registryUrl() });
    const r = await STORE.invokePlugin('runs2', 'imaginary', []);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no_such_method');
  });
});

// ── replaceConfig ────────────────────────────────────────────────────────

describe('replaceConfig', () => {
  test('replaces the entire config object', async () => {
    servedTarballs['cfg'] = { buf: await buildTarball({ id: 'cfg', version: '1.0.0' }), version: '1.0.0' };
    rebuildRegistry();
    await STORE.installPlugin('cfg', { url: registryUrl() });
    STORE.replaceConfig('cfg', { apiKey: 'a', region: 'us-east-1' });
    const installed = STORE.getInstalled('cfg');
    assert.equal(installed.config.apiKey, 'a');
    assert.equal(installed.config.region, 'us-east-1');
  });

  test('rejects non-object config', () => {
    assert.throws(
      () => STORE.replaceConfig('cfg', 'not an object'),
      /must be a plain object/,
    );
  });
});