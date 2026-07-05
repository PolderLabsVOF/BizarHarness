/**
 * tests/plugins-registry.test.mjs
 *
 * Tests for src/server/plugins/registry.mjs:
 *   - fetch: cache + 1h TTL + force
 *   - validate: shape enforcement, missing/invalid fields
 *   - search: substring matching + category/tag filters
 *   - getPlugin: id lookup + null on miss
 *   - verifyChecksum: matching, mismatching, malformed input
 *
 * Strategy: stand up an http.createServer that serves a fixture
 * registry, point the client at it via a fetch override, exercise the
 * surface, then close the server.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REG = await import(resolve(REPO, 'src/server/plugins/registry.mjs'));

/**
 * Compute a sha256:<hex> string for a fixture string. We use this
 * to build valid checksums for the tarball verification test.
 */
function sha256OfString(s) {
  return 'sha256:' + createHash('sha256').update(s).digest('hex');
}

/**
 * Minimal valid registry fixture with two plugins.
 */
function buildFixture() {
  return {
    version: 1,
    updatedAt: '2026-07-05T00:00:00.000Z',
    plugins: [
      {
        id: 'vercel-deploy',
        name: 'Vercel Deploy',
        version: '1.0.0',
        description: 'Deploy dashboard to Vercel with one command',
        author: 'DrB0rk',
        category: 'deploy',
        tags: ['vercel', 'deploy'],
        homepage: 'https://example.com',
        tarball: 'https://example.com/vercel-deploy-1.0.0.tar.gz',
        checksum: sha256OfString('vercel-tarball-bytes'),
        permissions: ['net', 'fs:read'],
        minBizarVersion: '4.9.0',
      },
      {
        id: 'github-pr-watcher',
        name: 'GitHub PR Watcher',
        version: '2.1.3',
        description: 'Watch pull requests and trigger workflows',
        author: 'community',
        category: 'workflow',
        tags: ['github', 'pr'],
        tarball: 'https://example.com/github-pr-watcher-2.1.3.tar.gz',
        checksum: sha256OfString('github-tarball-bytes'),
        permissions: ['net'],
      },
    ],
  };
}

/**
 * Spin up a tiny HTTP server that returns the fixture on every GET.
 * Returns `{ url, close }`.
 */
function startServer(fixture) {
  return new Promise((resolveStart) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/registry.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fixture));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({
        url: `http://127.0.0.1:${port}/registry.json`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

let server;
let fixture;
let url;

before(async () => {
  fixture = buildFixture();
  server = await startServer(fixture);
  url = server.url;
});

after(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  REG.__resetCache();
});

// ── fetchRegistry ─────────────────────────────────────────────────────────

describe('fetchRegistry', () => {
  test('returns parsed + validated shape', async () => {
    const r = await REG.fetchRegistry({ url, fetch: globalThis.fetch });
    assert.equal(r.version, 1);
    assert.equal(typeof r.updatedAt, 'string');
    assert.equal(r.plugins.length, 2);
    assert.equal(r.plugins[0].id, 'vercel-deploy');
  });

  test('caches the response (second call hits cache, not server)', async () => {
    // To prove caching, we point at a server that would 500 on a
    // second hit. If caching works, the second call still succeeds.
    let calls = 0;
    const flaky = await new Promise((r) => {
      const s = http.createServer((req, res) => {
        calls += 1;
        if (calls === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(fixture));
          return;
        }
        res.writeHead(500);
        res.end('boom');
      });
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        r({ url: `http://127.0.0.1:${port}/registry.json`, close: () => new Promise((rr) => s.close(rr)) });
      });
    });
    try {
      const r1 = await REG.fetchRegistry({ url: flaky.url, fetch: globalThis.fetch });
      assert.equal(r1.plugins.length, 2);
      const r2 = await REG.fetchRegistry({ url: flaky.url, fetch: globalThis.fetch });
      assert.equal(r2.plugins.length, 2);
      assert.equal(calls, 1, 'second call should hit cache, not network');
    } finally {
      await flaky.close();
    }
  });

  test('force=true bypasses the cache', async () => {
    let calls = 0;
    const counter = await new Promise((r) => {
      const s = http.createServer((req, res) => {
        calls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fixture));
      });
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        r({ url: `http://127.0.0.1:${port}/registry.json`, close: () => new Promise((rr) => s.close(rr)) });
      });
    });
    try {
      await REG.fetchRegistry({ url: counter.url, fetch: globalThis.fetch });
      await REG.fetchRegistry({ url: counter.url, fetch: globalThis.fetch, force: true });
      assert.equal(calls, 2);
    } finally {
      await counter.close();
    }
  });

  test('throws registry_unreachable on a 500 response', async () => {
    const broken = await new Promise((r) => {
      const s = http.createServer((req, res) => {
        res.writeHead(500);
        res.end('boom');
      });
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        r({ url: `http://127.0.0.1:${port}/x`, close: () => new Promise((rr) => s.close(rr)) });
      });
    });
    try {
      await assert.rejects(
        () => REG.fetchRegistry({ url: broken.url, fetch: globalThis.fetch }),
        (err) => err.code === 'registry_unreachable',
      );
    } finally {
      await broken.close();
    }
  });
});

// ── validateRegistry ──────────────────────────────────────────────────────

describe('validateRegistry', () => {
  test('rejects missing version', () => {
    const bad = { updatedAt: 'x', plugins: [] };
    assert.throws(() => REG.validateRegistry(bad), /version must be 1/);
  });

  test('rejects non-1 version', () => {
    const bad = { version: 2, updatedAt: 'x', plugins: [] };
    assert.throws(() => REG.validateRegistry(bad), /version must be 1/);
  });

  test('rejects plugin with missing id', () => {
    const bad = {
      version: 1,
      updatedAt: 'x',
      plugins: [{ name: 'X', version: '1.0.0', tarball: 'https://x', checksum: sha256OfString('x') }],
    };
    assert.throws(() => REG.validateRegistry(bad), /id must be a kebab-case/);
  });

  test('rejects duplicate plugin ids', () => {
    const bad = {
      version: 1,
      updatedAt: 'x',
      plugins: [
        { id: 'a', name: 'A', version: '1.0.0', tarball: 'https://x', checksum: sha256OfString('x'), permissions: [] },
        { id: 'a', name: 'A2', version: '1.0.0', tarball: 'https://x', checksum: sha256OfString('y'), permissions: [] },
      ],
    };
    assert.throws(() => REG.validateRegistry(bad), /duplicated/);
  });

  test('rejects non-https tarball', () => {
    const bad = {
      version: 1,
      updatedAt: 'x',
      plugins: [
        { id: 'a', name: 'A', version: '1.0.0', tarball: 'file:///etc/passwd', checksum: sha256OfString('x'), permissions: [] },
      ],
    };
    assert.throws(() => REG.validateRegistry(bad), /http\(s\) URL/);
  });

  test('rejects malformed checksum', () => {
    const bad = {
      version: 1,
      updatedAt: 'x',
      plugins: [
        { id: 'a', name: 'A', version: '1.0.0', tarball: 'https://x', checksum: 'md5:abc', permissions: [] },
      ],
    };
    assert.throws(() => REG.validateRegistry(bad), /sha256:<64-hex>/);
  });

  test('rejects non-array permissions', () => {
    const bad = {
      version: 1,
      updatedAt: 'x',
      plugins: [
        { id: 'a', name: 'A', version: '1.0.0', tarball: 'https://x', checksum: sha256OfString('x'), permissions: 'net' },
      ],
    };
    assert.throws(() => REG.validateRegistry(bad), /permissions must be an array/);
  });

  test('accepts a valid registry', () => {
    const r = REG.validateRegistry(buildFixture());
    assert.equal(r.plugins.length, 2);
  });
});

// ── searchPlugins ─────────────────────────────────────────────────────────

describe('searchPlugins', () => {
  test('returns all when query is empty', async () => {
    const r = await REG.searchPlugins('', { url });
    assert.equal(r.length, 2);
  });

  test('matches against name', async () => {
    const r = await REG.searchPlugins('vercel', { url });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'vercel-deploy');
  });

  test('matches against description', async () => {
    const r = await REG.searchPlugins('pull requests', { url });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'github-pr-watcher');
  });

  test('matches against tags', async () => {
    const r = await REG.searchPlugins('github', { url });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'github-pr-watcher');
  });

  test('category filter', async () => {
    const r = await REG.searchPlugins('', { url, category: 'deploy' });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'vercel-deploy');
  });

  test('tag filter', async () => {
    const r = await REG.searchPlugins('', { url, tag: 'github' });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'github-pr-watcher');
  });

  test('returns [] for a query that matches nothing', async () => {
    const r = await REG.searchPlugins('no-such-thing', { url });
    assert.equal(r.length, 0);
  });
});

// ── getPlugin ─────────────────────────────────────────────────────────────

describe('getPlugin', () => {
  test('returns the matching entry', async () => {
    const r = await REG.getPlugin('vercel-deploy', { url });
    assert.ok(r);
    assert.equal(r.name, 'Vercel Deploy');
  });

  test('returns null on miss', async () => {
    const r = await REG.getPlugin('does-not-exist', { url });
    assert.equal(r, null);
  });

  test('returns null for empty id', async () => {
    const r = await REG.getPlugin('', { url });
    assert.equal(r, null);
  });
});

// ── verifyChecksum ───────────────────────────────────────────────────────

describe('verifyChecksum', () => {
  let tmp;
  before(async () => {
    tmp = join(tmpdir(), `bizar-registry-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
  });
  after(async () => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('returns true for a matching checksum', async () => {
    const file = join(tmp, 'a.bin');
    const content = 'hello world';
    writeFileSync(file, content);
    const expected = sha256OfString(content);
    const ok = await REG.verifyChecksum(file, expected);
    assert.equal(ok, true);
  });

  test('returns false for a mismatched checksum', async () => {
    const file = join(tmp, 'b.bin');
    writeFileSync(file, 'something else entirely');
    const ok = await REG.verifyChecksum(file, sha256OfString('not this'));
    assert.equal(ok, false);
  });

  test('rejects non-sha256 algorithms', async () => {
    const file = join(tmp, 'c.bin');
    writeFileSync(file, 'whatever');
    await assert.rejects(() => REG.verifyChecksum(file, 'md5:abc'), /only sha256/);
  });

  test('rejects malformed checksum strings', async () => {
    const file = join(tmp, 'd.bin');
    writeFileSync(file, 'whatever');
    await assert.rejects(() => REG.verifyChecksum(file, 'not-a-checksum'), /<algo>:<hex>/);
  });

  test('rejects bad hex length', async () => {
    const file = join(tmp, 'e.bin');
    writeFileSync(file, 'whatever');
    await assert.rejects(
      () => REG.verifyChecksum(file, 'sha256:abc'),
      /64 lowercase hex chars/,
    );
  });
});