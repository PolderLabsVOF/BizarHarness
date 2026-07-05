/**
 * tests/skills-search.test.mjs
 *
 * Tests for skills search — verifies:
 * 1. Fuzzy search returns correct matches
 * 2. NO ASCII garbage / ANSI codes in search results
 * 3. Multi-term queries work correctly
 * 4. Empty query returns all skills
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const TEST_ROOT = join(tmpdir(), `bizar-search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function getStore() {
  const { skillsStore, setProjectRoot, invalidateCache } = await import('../src/server/skills-store.mjs');
  return { skillsStore, setProjectRoot, invalidateCache };
}

describe('skills search', () => {
  let skillsStore;
  let setProjectRoot;
  let invalidateCache;

  beforeEach(async () => {
    mkdirSync(TEST_ROOT, { recursive: true });

    const shipped = join(TEST_ROOT, 'bizar-dash', 'skills');
    mkdirSync(shipped, { recursive: true });

    // Create test skills with realistic names and descriptions
    const fixtures = [
      {
        dir: 'bizar',
        name: 'bizar',
        description: 'Norse-pantheon multi-agent system. Covers Odin routing, agent tiers, cost-aware dispatch.',
      },
      {
        dir: 'agent-baseline',
        name: 'agent-baseline',
        description: 'Always-on rules for every Bizar agent. Covers Semble, Skills CLI, loop guard, parallel execution.',
      },
      {
        dir: 'self-improvement',
        name: 'self-improvement',
        description: 'Self-improvement protocol. Records lessons to .bizar/AGENTS_SELF_IMPROVEMENT.md.',
      },
      {
        dir: 'obsidian',
        name: 'obsidian',
        description: 'Bizar Memory Service using Obsidian-compatible Markdown. Git sync and LightRAG indexing.',
      },
      {
        dir: 'minimax',
        name: 'minimax',
        description: 'MiniMax integration. Covers multi-key rotation, usage tracking, rate limits.',
      },
      {
        dir: 'providers',
        name: 'providers',
        description: 'Provider subsystem. Backup keys, auto-add wizard, provider catalog management.',
      },
      {
        dir: 'chat',
        name: 'chat',
        description: 'Chat and opencode session integration. Real-time SSE streaming, message history.',
      },
      {
        dir: 'usage',
        name: 'usage',
        description: 'Token usage monitoring and cost estimation. MiniMax usage dashboard.',
      },
      {
        dir: 'skills-cli',
        name: 'skills-cli',
        description: 'Skills CLI reference. Discover and install skills from skills.sh ecosystem.',
      },
      {
        dir: 'lightrag',
        name: 'lightrag',
        description: 'LightRAG full-text search integration. Indexing, querying, memory service integration.',
      },
    ];

    for (const f of fixtures) {
      mkdirSync(join(shipped, f.dir), { recursive: true });
      writeFileSync(
        join(shipped, f.dir, 'SKILL.md'),
        `---\nname: ${f.name}\ndescription: ${f.description}\n---\n# ${f.name}\nBody content.\n`,
      );
    }

    const mod = await getStore();
    skillsStore   = mod.skillsStore;
    setProjectRoot = mod.setProjectRoot;
    invalidateCache = mod.invalidateCache;

    setProjectRoot(TEST_ROOT);
    invalidateCache();
  });

  afterEach(() => {
    try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── ANSI / ASCII garbage check ──────────────────────────────────────────────

  function assertNoAnsi(label, value) {
    const ansiPattern = /\x1b\[[0-9;]*[a-zA-Z]/;
    assert.ok(
      !ansiPattern.test(value),
      `${label} should not contain ANSI escape codes: ${JSON.stringify(value.slice(0, 80))}`,
    );
  }

  it('search results contain no ANSI escape codes', async () => {
    const queries = ['', 'bizar', 'skill', 'memory', 'agent', 'provider'];
    for (const q of queries) {
      const results = await skillsStore.search(q);
      for (const s of results) {
        assertNoAnsi(`name (query="${q}")`, s.name);
        assertNoAnsi(`description (query="${q}")`, s.description);
        assertNoAnsi(`path (query="${q}")`, s.path);
        assertNoAnsi(`source (query="${q}")`, s.source);
      }
    }
  });

  it('list results contain no ANSI escape codes', async () => {
    const all = await skillsStore.list();
    for (const s of all) {
      assertNoAnsi('name', s.name);
      assertNoAnsi('description', s.description);
      assertNoAnsi('path', s.path);
      assertNoAnsi('source', s.source);
    }
  });

  it('get() result contains no ANSI escape codes', async () => {
    const skill = await skillsStore.get('shipped', 'bizar');
    if (skill) {
      assertNoAnsi('name', skill.name);
      assertNoAnsi('description', skill.description);
    }
  });

  // ── Search accuracy ─────────────────────────────────────────────────────────

  it('finds skill by name (case-insensitive)', async () => {
    const results = await skillsStore.search('BIZAR');
    assert.ok(results.length > 0);
    assert.ok(results.some((s) => s.name.toLowerCase() === 'bizar'));
  });

  it('finds skill by partial name', async () => {
    const results = await skillsStore.search('self-improv');
    assert.ok(results.length > 0);
    assert.ok(results.some((s) => s.name === 'self-improvement'));
  });

  it('finds skill by description keyword', async () => {
    const results = await skillsStore.search('multi-key rotation');
    assert.ok(results.length > 0);
    assert.ok(results.some((s) => s.name === 'minimax'));
  });

  it('finds skill by description keyword — lightrag', async () => {
    const results = await skillsStore.search('full-text search');
    assert.ok(results.length > 0);
    assert.ok(results.some((s) => s.name === 'lightrag'));
  });

  it('returns empty array for non-matching query', async () => {
    const results = await skillsStore.search('zzznonexistent999xyz');
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('multi-term query: both terms must match', async () => {
    const results = await skillsStore.search('obsidian git');
    for (const s of results) {
      const hay = `${s.name} ${s.description}`.toLowerCase();
      assert.ok(
        hay.includes('obsidian') && hay.includes('git'),
        `${s.name} should match both "obsidian" and "git"`,
      );
    }
  });

  it('whitespace-only query returns all', async () => {
    const all = await skillsStore.list();
    const results = await skillsStore.search('   ');
    assert.strictEqual(results.length, all.length);
  });

  // ── Result shape ────────────────────────────────────────────────────────────

  it('search result has required fields: name, description, source, path', async () => {
    const results = await skillsStore.search('bizar');
    assert.ok(results.length > 0);
    for (const s of results) {
      assert.ok(typeof s.name === 'string' && s.name.length > 0, 'name required');
      assert.ok(typeof s.description === 'string', 'description required');
      assert.ok(['shipped', 'user', 'project'].includes(s.source), 'valid source required');
      assert.ok(typeof s.path === 'string' && s.path.endsWith('SKILL.md'), 'path required');
    }
  });

  it('empty query returns all skills with all fields', async () => {
    const results = await skillsStore.search('');
    assert.ok(results.length > 0);
    for (const s of results) {
      assert.ok(typeof s.name === 'string');
      assert.ok(typeof s.description === 'string');
      assert.ok(typeof s.source === 'string');
      assert.ok(typeof s.path === 'string');
    }
  });
});
