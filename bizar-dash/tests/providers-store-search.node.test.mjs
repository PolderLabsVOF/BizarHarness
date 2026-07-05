/**
 * providers-store-search.node.test.mjs — fuzzy search across the v4.6.0
 * provider catalog.
 *
 * The catalog (`PROVIDER_CATALOG` in providers-store.mjs) is the curated
 * list surfaced by the dashboard's "Add provider" wizard. The wizard
 * shows a search box; typing a query should narrow the list down.
 *
 * Run with: node --test tests/providers-store-search.node.test.mjs
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

let mod;
before(async () => {
  const cacheBust = '?cb=' + Date.now() + '-' + Math.random().toString(36).slice(2);
  mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + cacheBust);
});

import { join } from 'node:path';

describe('PROVIDER_CATALOG (v4.6.0)', () => {
  it('exports a frozen catalog with at least 11 entries', () => {
    assert.ok(Array.isArray(mod.PROVIDER_CATALOG));
    assert.ok(Object.isFrozen(mod.PROVIDER_CATALOG));
    assert.ok(mod.PROVIDER_CATALOG.length >= 11,
      `expected at least 11 catalog entries, got ${mod.PROVIDER_CATALOG.length}`);
  });

  it('each entry has the wizard-facing fields', () => {
    for (const e of mod.PROVIDER_CATALOG) {
      assert.equal(typeof e.id, 'string', `${e.id} id not string`);
      assert.ok(e.id.length > 0);
      assert.equal(typeof e.name, 'string');
      assert.ok(e.name.length > 0);
      assert.equal(typeof e.baseURL, 'string');
      assert.equal(e.keyPattern instanceof RegExp, true, `${e.id} keyPattern not a RegExp`);
      assert.equal(typeof e.keyHint, 'string', `${e.id} keyHint not string`);
      assert.equal(typeof e.docs, 'string', `${e.id} docs not string`);
      assert.ok(Array.isArray(e.models), `${e.id} models not array`);
      assert.equal(typeof e.requiresKey, 'boolean', `${e.id} requiresKey not boolean`);
      assert.ok(Object.isFrozen(e), `${e.id} entry not frozen`);
    }
  });

  it('contains the headline providers we expect', () => {
    const ids = mod.PROVIDER_CATALOG.map((p) => p.id);
    for (const expected of ['opencode', 'anthropic', 'openai', 'google', 'minimax', 'groq', 'mistral', 'cohere', 'ollama', 'lmstudio', 'custom']) {
      assert.ok(ids.includes(expected), `catalog missing ${expected}`);
    }
  });

  it('local providers (ollama, lmstudio) have requiresKey=false', () => {
    const ollama = mod.findCatalogEntry('ollama');
    const lmstudio = mod.findCatalogEntry('lmstudio');
    assert.equal(ollama.requiresKey, false);
    assert.equal(lmstudio.requiresKey, false);
  });

  it('cloud providers have requiresKey=true', () => {
    const anthropic = mod.findCatalogEntry('anthropic');
    const minimax = mod.findCatalogEntry('minimax');
    assert.equal(anthropic.requiresKey, true);
    assert.equal(minimax.requiresKey, true);
  });

  it('MiniMax keyPattern accepts sk-cp-, sk-ant-, sk-or-', () => {
    const minimax = mod.findCatalogEntry('minimax');
    assert.ok(minimax.keyPattern.test('sk-cp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    assert.ok(minimax.keyPattern.test('sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    assert.ok(minimax.keyPattern.test('sk-or-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
    assert.equal(minimax.keyPattern.test('sk-bogus-aaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
    assert.equal(minimax.keyPattern.test('not-a-key'), false);
  });
});

describe('listCatalog (v4.6.0)', () => {
  it('returns the public shape (no keyPattern)', () => {
    const result = mod.listCatalog();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, mod.PROVIDER_CATALOG.length);
    for (const e of result) {
      assert.equal('keyPattern' in e, false, 'listCatalog leaked keyPattern');
      assert.equal(typeof e.id, 'string');
      assert.equal(typeof e.name, 'string');
      assert.equal(typeof e.baseURL, 'string');
      assert.equal(typeof e.keyHint, 'string');
      assert.equal(typeof e.docs, 'string');
      assert.ok(Array.isArray(e.models));
    }
  });
});

describe('searchProviders (v4.6.0)', () => {
  it('empty query returns full catalog', () => {
    const result = mod.searchProviders('');
    assert.equal(result.length, mod.PROVIDER_CATALOG.length);
  });

  it('exact id match ranks first', () => {
    const result = mod.searchProviders('minimax');
    assert.ok(result.length > 0);
    assert.equal(result[0].id, 'minimax');
    assert.ok(result[0].score >= 100);
  });

  it('fuzzy id prefix match finds minimax when typing "mini"', () => {
    const result = mod.searchProviders('mini');
    const ids = result.map((r) => r.id);
    assert.ok(ids.includes('minimax'));
  });

  it('name match: "GPT" finds openai/opencode (curated names)', () => {
    const result = mod.searchProviders('claude');
    const ids = result.map((r) => r.id);
    assert.ok(ids.includes('anthropic'));
  });

  it('docs URL match: "openrouter" finds openrouter', () => {
    const result = mod.searchProviders('openrouter');
    const ids = result.map((r) => r.id);
    assert.ok(ids.includes('openrouter'));
  });

  it('non-matching query returns empty array', () => {
    const result = mod.searchProviders('xyzzy-no-such-provider-xyzzy');
    assert.equal(result.length, 0);
  });

  it('respects limit option', () => {
    const result = mod.searchProviders('', { limit: 3 });
    assert.ok(result.length <= 3);
  });

  it('does not leak keyPattern in results', () => {
    const result = mod.searchProviders('openai');
    for (const r of result) {
      assert.equal('keyPattern' in r, false);
    }
  });

  it('finds ollama and lmstudio via "local" docs URL match', () => {
    const result = mod.searchProviders('local');
    const ids = result.map((r) => r.id);
    assert.ok(ids.includes('ollama'));
    assert.ok(ids.includes('lmstudio'));
  });
});

describe('findCatalogEntry (v4.6.0)', () => {
  it('returns the entry for known ids', () => {
    const e = mod.findCatalogEntry('anthropic');
    assert.ok(e);
    assert.equal(e.id, 'anthropic');
  });
  it('returns null for unknown ids', () => {
    assert.equal(mod.findCatalogEntry('not-a-real-provider'), null);
  });
  it('returns null for falsy input', () => {
    assert.equal(mod.findCatalogEntry(''), null);
    assert.equal(mod.findCatalogEntry(null), null);
  });
});