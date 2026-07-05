/**
 * minimax-models.test.mjs — verify MiniMax is the default/primary provider
 * and that the catalog, constants, and agent configs all agree.
 *
 * Run with: node --test tests/minimax-models.test.mjs
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { existsSync } from 'node:fs';

const REPO = resolve(import.meta.dirname, '..', '..');

let mod;
let AGENTS_DIR;

before(async () => {
  const cacheBust = '?cb=' + Date.now() + '-' + Math.random().toString(36).slice(2);
  mod = await import(join(REPO, 'bizar-dash/src/server/providers-store.mjs') + cacheBust);
  AGENTS_DIR = join(REPO, 'config', 'agents');
});

describe('MiniMax model constants', () => {
  it('MINIMAX_DEFAULT is MiniMax-M2.7', () => {
    assert.equal(mod.MINIMAX_DEFAULT, 'MiniMax-M2.7');
  });
});

describe('PROVIDER_CATALOG MiniMax entry', () => {
  it('minimax is present in the catalog', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    assert.ok(minimax, 'minimax provider not found in PROVIDER_CATALOG');
  });

  it('has at least 4 models', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    assert.ok(minimax.models.length >= 4,
      `expected at least 4 MiniMax models, got ${minimax.models.length}`);
  });

  it('includes MiniMax-M2.7-Flash as recommended cheap model', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    const flash = minimax.models.find((m) => {
      const id = typeof m === 'string' ? m : m.id;
      return id === 'MiniMax-M2.7-Flash';
    });
    assert.ok(flash, 'MiniMax-M2.7-Flash not found in catalog');
    if (typeof flash === 'object') {
      assert.equal(flash.tier, 'cheap');
      assert.equal(flash.recommended, true);
    }
  });

  it('includes MiniMax-M2.7 (default cheap)', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    const m27 = minimax.models.find((m) => {
      const id = typeof m === 'string' ? m : m.id;
      return id === 'MiniMax-M2.7';
    });
    assert.ok(m27, 'MiniMax-M2.7 not found in catalog');
  });

  it('includes MiniMax-M3 (mid tier)', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    const m3 = minimax.models.find((m) => {
      const id = typeof m === 'string' ? m : m.id;
      return id === 'MiniMax-M3';
    });
    assert.ok(m3, 'MiniMax-M3 not found in catalog');
  });

  it('includes MiniMax-M3-Reasoning (premium)', () => {
    const minimax = mod.PROVIDER_CATALOG.find((p) => p.id === 'minimax');
    const m3r = minimax.models.find((m) => {
      const id = typeof m === 'string' ? m : m.id;
      return id === 'MiniMax-M3-Reasoning';
    });
    assert.ok(m3r, 'MiniMax-M3-Reasoning not found in catalog');
  });
});

describe('Agent .md files use MiniMax models', () => {
  // Agents that should be on minimax/MiniMax-M2.7
  const m27Agents = ['frigg', 'heimdall', 'mimir', 'vor', 'semble-search', 'hermod', 'thor', 'baldr'];
  // Agents that should be on minimax/MiniMax-M3
  const m3Agents = ['tyr', 'vidarr', 'forseti', 'odin'];
  // Agents that should be on minimax/MiniMax-M2.7-Flash
  const flashAgents = ['quick'];

  for (const agent of m27Agents) {
    it(`${agent} uses minimax/MiniMax-M2.7`, () => {
      const file = join(AGENTS_DIR, `${agent}.md`);
      if (!existsSync(file)) { assert.fail(`agent file not found: ${file}`); }
      const raw = readFileSync(file, 'utf8');
      const match = raw.match(/^model:\s*([^\s#]+)/m);
      assert.ok(match, `${agent}.md has no model: line`);
      assert.equal(match[1], 'minimax/MiniMax-M2.7', `${agent} should use MiniMax-M2.7, got ${match[1]}`);
    });
  }

  for (const agent of m3Agents) {
    it(`${agent} uses minimax/MiniMax-M3`, () => {
      const file = join(AGENTS_DIR, `${agent}.md`);
      if (!existsSync(file)) { assert.fail(`agent file not found: ${file}`); }
      const raw = readFileSync(file, 'utf8');
      const match = raw.match(/^model:\s*([^\s#]+)/m);
      assert.ok(match, `${agent}.md has no model: line`);
      assert.equal(match[1], 'minimax/MiniMax-M3', `${agent} should use MiniMax-M3, got ${match[1]}`);
    });
  }

  for (const agent of flashAgents) {
    it(`${agent} uses minimax/MiniMax-M2.7-Flash`, () => {
      const file = join(AGENTS_DIR, `${agent}.md`);
      if (!existsSync(file)) { assert.fail(`agent file not found: ${file}`); }
      const raw = readFileSync(file, 'utf8');
      const match = raw.match(/^model:\s*([^\s#]+)/m);
      assert.ok(match, `${agent}.md has no model: line`);
      assert.equal(match[1], 'minimax/MiniMax-M2.7-Flash', `${agent} should use MiniMax-M2.7-Flash, got ${match[1]}`);
    });
  }
});
