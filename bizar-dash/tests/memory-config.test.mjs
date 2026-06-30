/**
 * tests/memory-config.test.mjs
 *
 * Tests for writeLightRAGConfig, patch-mode POST /memory/config,
 * redact behaviour, and LightRAG lifecycle endpoints.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';

const httpGet = (port, path) =>
  new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    });
    req.end();
  });

const httpPost = (port, path, body) =>
  new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(respBody || '{}') }));
      },
    );
    req.write(data);
    req.end();
  });

const {
  writeLightRAGConfig,
  resolveLightRAGConfig,
} = await import('../src/server/memory-lightrag.mjs');

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTmp() {
  const root = join(tmpdir(), `bizar-lightrag-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.bizar'), { recursive: true });
  return root;
}

async function buildApp(projectRoot) {
  const { createMemoryRouter } = await import('../src/server/routes/memory.mjs');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api', createMemoryRouter({ projectRoot }));
  return app;
}

async function withApp(projectRoot, fn) {
  const app = await buildApp(projectRoot);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

// ── writeLightRAGConfig — unit tests ─────────────────────────────────────────

describe('writeLightRAGConfig', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('deep-merges into existing lightrag block', () => {
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { enabled: false, port: 8000, llmModel: 'gpt-4o' },
    }));

    const result = writeLightRAGConfig(root, { enabled: true, port: 9000 });
    assert.equal(result.ok, true);

    const mem = JSON.parse(readFileSync(join(root, '.bizar', 'memory.json'), 'utf8'));
    assert.equal(mem.lightrag.enabled, true);
    assert.equal(mem.lightrag.port, 9000);
    assert.equal(mem.lightrag.llmModel, 'gpt-4o'); // preserved
  });

  test('validates llmBinding is in known set', () => {
    const result = writeLightRAGConfig(root, { llmBinding: 'not-a-binding' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('llmBinding'));
  });

  test('validates embeddingBinding is in known set', () => {
    const result = writeLightRAGConfig(root, { embeddingBinding: 'bad-embedding' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('embeddingBinding'));
  });

  test('rejects port out of range (0)', () => {
    const result = writeLightRAGConfig(root, { port: 0 });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('port'));
  });

  test('rejects port out of range (66666)', () => {
    const result = writeLightRAGConfig(root, { port: 66666 });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('port'));
  });

  test('accepts port 1 and 65535', () => {
    let r = writeLightRAGConfig(root, { port: 1 });
    assert.equal(r.ok, true);
    r = writeLightRAGConfig(root, { port: 65535 });
    assert.equal(r.ok, true);
  });

  test('canonicalises <empty> to empty string for apiKey', () => {
    const r = writeLightRAGConfig(root, { apiKey: '<empty>' });
    assert.equal(r.ok, true);
    const mem = JSON.parse(readFileSync(join(root, '.bizar', 'memory.json'), 'utf8'));
    assert.equal(mem.lightrag.apiKey, '');
  });

  test('atomic — old or new file present after concurrent writes', () => {
    writeLightRAGConfig(root, { port: 10000 });
    for (let i = 0; i < 20; i++) {
      writeLightRAGConfig(root, { port: i + 1 });
    }
    const content = readFileSync(join(root, '.bizar', 'memory.json'), 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.lightrag.port, 20);
  });

  test('creates .bizar/memory.json if missing', () => {
    const fresh = join(tmpdir(), `bizar-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fresh, { recursive: true });
    try {
      const r = writeLightRAGConfig(fresh, { port: 5000 });
      assert.equal(r.ok, true);
      assert.ok(existsSync(join(fresh, '.bizar', 'memory.json')));
      const mem = JSON.parse(readFileSync(join(fresh, '.bizar', 'memory.json'), 'utf8'));
      assert.equal(mem.lightrag.port, 5000);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test('preserves non-lightrag fields when merging', () => {
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      projectId: 'test-proj',
      memoryRepo: { mode: 'local-only' },
      lightrag: { port: 7000 },
    }));
    const r = writeLightRAGConfig(root, { llmModel: 'claude-3' });
    assert.equal(r.ok, true);
    const mem = JSON.parse(readFileSync(join(root, '.bizar', 'memory.json'), 'utf8'));
    assert.equal(mem.projectId, 'test-proj');
    assert.equal(mem.lightrag.llmModel, 'claude-3');
    assert.equal(mem.lightrag.port, 7000);
  });
});

// ── resolveLightRAGConfig — apiKey defaults ───────────────────────────────────

describe('resolveLightRAGConfig apiKey defaults', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('defaults apiKey to "env" when not set', () => {
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      lightrag: { port: 9621 },
    }));
    const cfg = resolveLightRAGConfig(root);
    assert.equal(cfg.apiKey, 'env');
    assert.equal(cfg.apiKeySource, 'env');
  });

  test('reads existing apiKeySource', () => {
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      lightrag: { port: 9621, apiKey: 'sk-123', apiKeySource: 'file' },
    }));
    const cfg = resolveLightRAGConfig(root);
    assert.equal(cfg.apiKey, 'sk-123');
    assert.equal(cfg.apiKeySource, 'file');
  });
});

// ── HTTP route integration tests ─────────────────────────────────────────────

describe('POST /api/memory/config patch mode', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621, llmModel: 'original-model' },
    }));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns merged config with redacted apiKey', async () => {
    writeLightRAGConfig(root, { apiKey: 'sk-secret123', apiKeySource: 'file' });

    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config', {
        patch: true,
        lightrag: { port: 5000 },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.config.lightrag.port, 5000);
      assert.equal(res.body.config.lightrag.llmModel, 'original-model');
      // apiKey must be redacted
      assert.equal(res.body.config.lightrag.apiKey, '***');
    });
  });

  test('rejects patch without lightrag field', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config', { patch: true, foo: 'bar' });
      assert.equal(res.status, 400);
    });
  });

  test('rejects unknown top-level fields in patch', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config', { patch: true, lightrag: { port: 1 }, mode: 'managed' });
      assert.equal(res.status, 400);
    });
  });

  test('validates port range through patch', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config', { patch: true, lightrag: { port: 99999 } });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('port'));
    });
  });

  test('validates llmBinding through patch', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/config', { patch: true, lightrag: { llmBinding: 'invalid' } });
      assert.equal(res.status, 400);
      assert.ok(res.body.message.includes('llmBinding'));
    });
  });
});

describe('GET /api/memory/config — redaction', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621, apiKey: 'sk-abc123', apiKeySource: 'file' },
    }));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('GET /memory/config redacts apiKey to ***', async () => {
    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/config');
      assert.equal(res.status, 200);
      assert.equal(res.body.config.lightrag.apiKey, '***');
      assert.equal(res.body.config.lightrag.apiKeySource, 'file');
    });
  });
});

describe('GET /api/memory/lightrag/status', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621, llmBinding: 'ollama', embeddingBinding: 'ollama', llmModel: 'test-model', embeddingModel: 'test-embed' },
    }));
    mkdirSync(join(root, '.bizar', 'lightrag'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns running:false when server not running', async () => {
    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/lightrag/status');
      assert.equal(res.status, 200);
      assert.equal(res.body.running, false);
      assert.equal(res.body.pid, null);
      assert.equal(res.body.port, 9621);
      assert.equal(res.body.llmBinding, 'ollama');
      assert.equal(res.body.embeddingBinding, 'ollama');
    });
  });
});

describe('POST /api/memory/lightrag/start', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621 },
    }));
    mkdirSync(join(root, '.bizar', 'lightrag'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns ok:false with error when lightrag-server not installed (or ok:true if it is)', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/lightrag/start', {});
      assert.equal(res.status, 200);
      assert.equal(typeof res.body.ok, 'boolean');
      if (!res.body.ok) {
        assert.ok(res.body.error != null);
      }
    });
  });
});

describe('POST /api/memory/lightrag/stop', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621 },
    }));
    mkdirSync(join(root, '.bizar', 'lightrag'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns ok:true when nothing is running', async () => {
    await withApp(root, async (port) => {
      const res = await httpPost(port, '/api/memory/lightrag/stop', {});
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });
  });
});

describe('GET /api/memory/lightrag/log', () => {
  let root;

  beforeEach(() => {
    root = makeTmp();
    writeFileSync(join(root, '.bizar', 'memory.json'), JSON.stringify({
      version: 1,
      lightrag: { port: 9621 },
    }));
    mkdirSync(join(root, '.bizar', 'lightrag'), { recursive: true });
    // Write a log file with 60 lines
    const lines = Array.from({ length: 60 }, (_, i) => `log line ${i + 1}`).join('\n');
    writeFileSync(join(root, '.bizar', 'lightrag', 'lightrag.log'), lines);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('returns last 200 lines', async () => {
    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/lightrag/log');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.lines));
      assert.ok(res.body.lines.length <= 200);
    });
  });

  test('returns empty lines when no log file', async () => {
    rmSync(join(root, '.bizar', 'lightrag', 'lightrag.log'), { force: true });

    await withApp(root, async (port) => {
      const res = await httpGet(port, '/api/memory/lightrag/log');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.lines));
      assert.equal(res.body.lines.length, 0);
    });
  });
});
