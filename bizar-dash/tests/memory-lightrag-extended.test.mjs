/**
 * tests/memory-lightrag-extended.test.mjs
 *
 * v4.7.0 — Tests for the new LightRAG stats / rebuild-graph / recordQuery
 * helpers added for the Memory tab.
 *
 * These helpers do NOT require a live lightrag-server — they exercise the
 * pure helpers against an isolated tmp project root.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';

const {
  resolveLightRAGConfig,
  stats,
  recordQuery,
  rebuildGraph,
  detectAvailableLLM,
  reindexSingleNote,
} = await import('../src/server/memory-lightrag.mjs');

let tmpRoot;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `bizar-memlight-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpRoot, '.bizar', 'memory-cache'), { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('resolveLightRAGConfig', () => {
  test('returns sensible defaults for empty project', () => {
    const cfg = resolveLightRAGConfig(tmpRoot);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.port, 9621);
    assert.ok(cfg.workingDir.includes('.bizar/lightrag'));
  });
});

describe('stats', () => {
  test('returns the documented shape for a fresh project', async () => {
    const s = await stats(tmpRoot);
    assert.equal(typeof s.running, 'boolean');
    assert.equal(s.pid, null); // no server running in tests
    assert.equal(s.host, '127.0.0.1');
    assert.equal(s.port, 9621);
    assert.equal(typeof s.workingDir, 'string');
    assert.equal(s.lastReindexAt, null);
    assert.equal(s.lastReindexOk, null);
    assert.equal(s.lastReindexInserted, null);
    assert.equal(s.lastReindexFailed, null);
    assert.equal(typeof s.noteCount, 'number');
    assert.equal(typeof s.indexedApprox, 'number');
    assert.equal(typeof s.queryCountLast24h, 'number');
    assert.ok(s.avgResponseMs === null || typeof s.avgResponseMs === 'number');
  });

  test('reflects noteCount from the vault', async () => {
    // Set up a memory.json in managed mode + a vault with 2 notes.
    mkdirSync(join(tmpRoot, '.bizar', 'memory', 'projects', 'extproj'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), JSON.stringify({
      projectId: 'extproj',
      memoryRepo: {
        mode: 'managed',
        path: join(tmpRoot, '.bizar', 'memory'),
        remote: null,
        branch: 'main',
      },
    }));
    writeFileSync(
      join(tmpRoot, '.bizar', 'memory', 'projects', 'extproj', 'a.md'),
      '---\ntitle: A\n---\n\nBody A.',
    );
    writeFileSync(
      join(tmpRoot, '.bizar', 'memory', 'projects', 'extproj', 'b.md'),
      '---\ntitle: B\n---\n\nBody B.',
    );
    const s = await stats(tmpRoot);
    assert.equal(s.noteCount, 2);
  });

  test('indexedApprox sums kv_store_doc_status + kv_store_full_docs', async () => {
    const cfg = resolveLightRAGConfig(tmpRoot);
    mkdirSync(cfg.workingDir, { recursive: true });
    writeFileSync(
      join(cfg.workingDir, 'kv_store_doc_status.json'),
      JSON.stringify({ a: 1, b: 2, c: 3 }),
    );
    writeFileSync(
      join(cfg.workingDir, 'kv_store_full_docs.json'),
      JSON.stringify({ x: 1, y: 2 }),
    );
    const s = await stats(tmpRoot);
    assert.equal(s.indexedApprox, 5);
  });
});

describe('recordQuery', () => {
  test('writes to lightrag-query-log.jsonl and stats picks it up', async () => {
    recordQuery(tmpRoot, 42);
    recordQuery(tmpRoot, 84);
    recordQuery(tmpRoot, 1000);
    const logPath = join(tmpRoot, '.bizar', 'memory-cache', 'lightrag-query-log.jsonl');
    assert.ok(existsSync(logPath), 'log file should exist');
    const content = readFileSync(logPath, 'utf8').trim().split('\n');
    assert.equal(content.length, 3);
    for (const line of content) {
      const rec = JSON.parse(line);
      assert.equal(typeof rec.ts, 'number');
      assert.equal(typeof rec.ms, 'number');
    }
    const s = await stats(tmpRoot);
    assert.equal(s.queryCountLast24h, 3);
    assert.equal(s.avgResponseMs, Math.round((42 + 84 + 1000) / 3));
  });

  test('ignores queries older than 24h', async () => {
    const logPath = join(tmpRoot, '.bizar', 'memory-cache', 'lightrag-query-log.jsonl');
    mkdirSync(join(tmpRoot, '.bizar', 'memory-cache'), { recursive: true });
    const old = { ts: Date.now() - 48 * 60 * 60 * 1000, ms: 99 };
    const fresh = { ts: Date.now() - 60 * 1000, ms: 50 };
    writeFileSync(logPath, JSON.stringify(old) + '\n' + JSON.stringify(fresh) + '\n');
    const s = await stats(tmpRoot);
    assert.equal(s.queryCountLast24h, 1);
    assert.equal(s.avgResponseMs, 50);
  });

  test('handles missing log file gracefully', async () => {
    const s = await stats(tmpRoot);
    assert.equal(s.queryCountLast24h, 0);
    assert.equal(s.avgResponseMs, null);
  });
});

describe('rebuildGraph', () => {
  test('is idempotent when called against a non-running server', async () => {
    // We don't have a live lightrag-server in tests, so rebuildGraph will
    // ultimately return ok=false with error="lightrag disabled in .bizar/memory.json"
    // OR ok=false with error about not running. Either way, it must NOT throw
    // and must return a structured result.
    mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), JSON.stringify({
      projectId: 'rbproj',
      memoryRepo: { mode: 'local-only', path: join(tmpRoot, '.obsidian') },
      lightrag: { enabled: false },
    }));
    let result;
    try {
      result = await rebuildGraph(tmpRoot, {});
    } catch (err) {
      assert.fail(`rebuildGraph threw: ${err.message}`);
    }
    assert.ok(result);
    assert.equal(typeof result.ok, 'boolean');
    // workingDir should have been wiped and re-created (or attempted).
  });
});

describe('detectAvailableLLM', () => {
  const ORIG_OPENAI = process.env.OPENAI_API_KEY;
  const ORIG_ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  const ORIG_MINIMAX = process.env.MINIMAX_API_KEY;

  afterEach(() => {
    if (ORIG_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIG_OPENAI;
    if (ORIG_ANTHROPIC === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIG_ANTHROPIC;
    if (ORIG_MINIMAX === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = ORIG_MINIMAX;
  });

  test('returns null when llmBinding is ollama, no API keys set, and ollama is unreachable', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    const cfg = resolveLightRAGConfig(tmpRoot);
    cfg.llmBinding = 'ollama';
    cfg.llmBindingHost = 'http://localhost:59999'; // nothing listening
    const result = await detectAvailableLLM(cfg);
    // When ollama is the binding but unreachable, and no API keys are set, returns null.
    assert.equal(result, null);
  });

  test('returns openai-available when llmBinding is ollama but OPENAI_API_KEY is set (ollama fallback)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-key';
    const cfg = resolveLightRAGConfig(tmpRoot);
    cfg.llmBinding = 'ollama';
    cfg.llmBindingHost = 'http://localhost:59999'; // unreachable
    const result = await detectAvailableLLM(cfg);
    assert.ok(result);
    assert.equal(result.provider, 'openai');
    assert.equal(result.available, true);
  });

  test('returns anthropic-available when llmBinding is anthropic and ANTHROPIC_API_KEY is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const cfg = resolveLightRAGConfig(tmpRoot);
    cfg.llmBinding = 'anthropic';
    const result = await detectAvailableLLM(cfg);
    assert.ok(result);
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.available, true);
  });

  test('returns minimax-available when llmBinding is minimax and MINIMAX_API_KEY is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MINIMAX_API_KEY = 'minimax-test-key';
    const cfg = resolveLightRAGConfig(tmpRoot);
    cfg.llmBinding = 'minimax';
    const result = await detectAvailableLLM(cfg);
    assert.ok(result);
    assert.equal(result.provider, 'minimax');
    assert.equal(result.available, true);
  });

  test('returns null when llmBinding is openai but no API key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    const cfg = resolveLightRAGConfig(tmpRoot);
    cfg.llmBinding = 'openai';
    const result = await detectAvailableLLM(cfg);
    assert.equal(result, null);
  });
});

describe('reindexSingleNote', () => {
  test('returns error when memory not initialized', async () => {
    mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });
    // No memory.json
    const r = await reindexSingleNote(tmpRoot, 'notes/test.md');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('not initialized'));
  });

  test('returns error when note does not exist', async () => {
    mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), JSON.stringify({
      projectId: 'testproj',
      memoryRepo: { mode: 'local-only' },
    }));
    const r = await reindexSingleNote(tmpRoot, 'notes/nonexistent.md');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('not found'));
  });

  test('returns error on path traversal attempt', async () => {
    mkdirSync(join(tmpRoot, '.bizar', 'memory', 'projects', 'testproj'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), JSON.stringify({
      projectId: 'testproj',
      memoryRepo: {
        mode: 'managed',
        path: join(tmpRoot, '.bizar', 'memory'),
      },
    }));
    // Attempt path traversal
    const r = await reindexSingleNote(tmpRoot, '../../../etc/passwd');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('traversal'));
  });

  test('returns structured result when note exists and lightrag disabled', async () => {
    mkdirSync(join(tmpRoot, '.bizar', 'memory', 'projects', 'testproj'), { recursive: true });
    writeFileSync(join(tmpRoot, '.bizar', 'memory.json'), JSON.stringify({
      projectId: 'testproj',
      memoryRepo: {
        mode: 'managed',
        path: join(tmpRoot, '.bizar', 'memory'),
      },
      lightrag: { enabled: false },
    }));
    writeFileSync(
      join(tmpRoot, '.bizar', 'memory', 'projects', 'testproj', 'test.md'),
      '---\ntitle: Test\n---\n\nBody.',
    );
    const r = await reindexSingleNote(tmpRoot, 'test.md');
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('disabled'));
  });
});