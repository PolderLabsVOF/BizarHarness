/**
 * lightrag-defaults.node.test.mjs — regression tests for the v4.6.0
 * LightRAG defaults.
 *
 * The memory service's lightrag subsystem starts with the free opencode
 * Zen models by default (no API key required). Operators can override
 * via env vars `BIZAR_LIGHTRAG_LLM` and `BIZAR_LIGHTRAG_EMBEDDING`.
 *
 * The defaults surface:
 *   - GET /api/lightrag/defaults   (lightrag settings view)
 *   - GET /api/memory/lightrag/status (existing memory surface)
 *
 * Run with: node --test tests/lightrag-defaults.node.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

let memoryStore;
let memoryLightrag;
let ORIGINAL_ENV;

before(async () => {
  const cb = '?cb=' + Date.now() + '-' + Math.random().toString(36).slice(2);
  memoryStore = await import(join(REPO, 'bizar-dash/src/server/memory-store.mjs') + cb);
  memoryLightrag = await import(join(REPO, 'bizar-dash/src/server/memory-lightrag.mjs') + cb);
  ORIGINAL_ENV = {
    BIZAR_LIGHTRAG_LLM: process.env.BIZAR_LIGHTRAG_LLM,
    BIZAR_LIGHTRAG_EMBEDDING: process.env.BIZAR_LIGHTRAG_EMBEDDING,
  };
  delete process.env.BIZAR_LIGHTRAG_LLM;
  delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
});

after(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

import { join } from 'node:path';

describe('LIGHTRAG_DEFAULT_* constants (v4.6.0)', () => {
  it('default LLM is opencode/gpt-5-nano', () => {
    assert.equal(memoryStore.LIGHTRAG_DEFAULT_LLM, 'opencode/gpt-5-nano');
  });
  it('default embedding is opencode/text-embedding-3-small', () => {
    assert.equal(memoryStore.LIGHTRAG_DEFAULT_EMBEDDING, 'opencode/text-embedding-3-small');
  });
});

describe('getDefaultLightRAGConfig()', () => {
  it('returns opencode-free defaults when no env overrides', () => {
    delete process.env.BIZAR_LIGHTRAG_LLM;
    delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
    const cfg = memoryStore.getDefaultLightRAGConfig();
    assert.equal(cfg.llm, 'opencode/gpt-5-nano');
    assert.equal(cfg.embedding, 'opencode/text-embedding-3-small');
    assert.equal(cfg.source, 'opencode-free');
    assert.equal(cfg.llmSource, 'default');
    assert.equal(cfg.embeddingSource, 'default');
  });

  it('env BIZAR_LIGHTRAG_LLM overrides the default LLM', () => {
    process.env.BIZAR_LIGHTRAG_LLM = 'anthropic/claude-haiku-4-5';
    const cfg = memoryStore.getDefaultLightRAGConfig();
    assert.equal(cfg.llm, 'anthropic/claude-haiku-4-5');
    assert.equal(cfg.embedding, 'opencode/text-embedding-3-small');
    assert.equal(cfg.source, 'env');
    assert.equal(cfg.llmSource, 'env');
    assert.equal(cfg.embeddingSource, 'default');
    delete process.env.BIZAR_LIGHTRAG_LLM;
  });

  it('env BIZAR_LIGHTRAG_EMBEDDING overrides the default embedding', () => {
    process.env.BIZAR_LIGHTRAG_EMBEDDING = 'openai/text-embedding-3-large';
    const cfg = memoryStore.getDefaultLightRAGConfig();
    assert.equal(cfg.llm, 'opencode/gpt-5-nano');
    assert.equal(cfg.embedding, 'openai/text-embedding-3-large');
    assert.equal(cfg.embeddingSource, 'env');
    delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
  });

  it('both env vars override together', () => {
    process.env.BIZAR_LIGHTRAG_LLM = 'minimax/MiniMax-M3';
    process.env.BIZAR_LIGHTRAG_EMBEDDING = 'openai/text-embedding-3-small';
    const cfg = memoryStore.getDefaultLightRAGConfig();
    assert.equal(cfg.llm, 'minimax/MiniMax-M3');
    assert.equal(cfg.embedding, 'openai/text-embedding-3-small');
    assert.equal(cfg.source, 'env');
    assert.equal(cfg.llmSource, 'env');
    assert.equal(cfg.embeddingSource, 'env');
    delete process.env.BIZAR_LIGHTRAG_LLM;
    delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
  });

  it('treats empty env vars as unset (falls back to defaults)', () => {
    process.env.BIZAR_LIGHTRAG_LLM = '';
    process.env.BIZAR_LIGHTRAG_EMBEDDING = '   ';
    const cfg = memoryStore.getDefaultLightRAGConfig();
    assert.equal(cfg.llm, 'opencode/gpt-5-nano');
    assert.equal(cfg.embedding, 'opencode/text-embedding-3-small');
    delete process.env.BIZAR_LIGHTRAG_LLM;
    delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
  });
});

describe('memory-lightrag.mjs LIGHTRAG_DEFAULTS (v4.6.0)', () => {
  it('default llmModel matches the opencode-Zen-free default', () => {
    assert.equal(memoryLightrag.LIGHTRAG_DEFAULTS.llmModel, 'opencode/gpt-5-nano');
  });
  it('default embeddingModel matches the opencode-Zen-free default', () => {
    assert.equal(memoryLightrag.LIGHTRAG_DEFAULTS.embeddingModel, 'opencode/text-embedding-3-small');
  });
});