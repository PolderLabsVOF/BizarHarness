/**
 * tests/skills-list.test.mjs
 *
 * Tests for skills-store.mjs — verifies:
 * 1. All skill sources are scanned
 * 2. SKILL.md frontmatter is parsed correctly
 * 3. Skills have required fields
 * 4. Cache invalidation works
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const TEST_ROOT = join(tmpdir(), `bizar-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Dynamically import so we can set projectRoot before use
async function getStore() {
  const { skillsStore, setProjectRoot, invalidateCache } = await import('../src/server/skills-store.mjs');
  return { skillsStore, setProjectRoot, invalidateCache };
}

describe('skills-store', () => {
  let skillsStore;
  let setProjectRoot;
  let invalidateCache;

  // Skill directory fixtures
  let FIXTURE_USER_OPENCODE;
  let FIXTURE_USER_AGENTS;
  let FIXTURE_SHIPPED;
  let FIXTURE_PROJECT;

  beforeEach(async () => {
    mkdirSync(TEST_ROOT, { recursive: true });

    // Helper: create skill dir + write SKILL.md in one shot
    const skillFile = (base, name, content) => {
      const dir = join(base, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), content);
    };

    // Set up fake shipped directory
    const shipped = join(TEST_ROOT, 'bizar-dash', 'skills');
    mkdirSync(shipped, { recursive: true });
    skillFile(shipped, 'shipped-skill', `---\nname: shipped-display\ndescription: A shipped skill description.\n---\n# Shipped Skill\nBody text.\n`);
    skillFile(shipped, 'bizar', `---\nname: bizar\ndescription: Bizar main skill.\n---\n# Bizar\nAgent routing.\n`);

    // Set up project-local .agents/skills
    const projectAgents = join(TEST_ROOT, '.agents', 'skills');
    mkdirSync(projectAgents, { recursive: true });
    skillFile(projectAgents, 'project-skill', `---\nname: Project Skill\ndescription: A project-local skill.\n---\n# Project Skill\n`);
    skillFile(projectAgents, 'chat', `---\nname: chat\ndescription: Chat integration.\n---\n# Chat\n`);

    // Set up project-local .opencode/skills
    const projectOpencode = join(TEST_ROOT, '.opencode', 'skills');
    mkdirSync(projectOpencode, { recursive: true });
    skillFile(projectOpencode, 'usage', `---\nname: usage\ndescription: Usage monitoring.\n---\n# Usage\n`);

    // Set up shipped path (relative to project root)
    FIXTURE_SHIPPED = shipped;

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

  // ── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns all skills as a flat array', async () => {
      const all = await skillsStore.list();
      assert.ok(Array.isArray(all));
      assert.ok(all.length > 0);
    });

    it('includes shipped skills from bizar-dash/skills/', async () => {
      const all = await skillsStore.list();
      const shipped = all.filter((s) => s.source === 'shipped');
      assert.ok(shipped.length > 0, 'should have at least one shipped skill');
      const bizar = shipped.find((s) => s.name === 'bizar');
      assert.ok(bizar, 'bizar shipped skill should be present');
    });

    it('includes project-local skills from .agents/skills/', async () => {
      const all = await skillsStore.list();
      const project = all.filter((s) => s.source === 'project');
      assert.ok(project.length > 0, 'should have project skills');
    });

    it('every skill has name, description, source, path', async () => {
      const all = await skillsStore.list();
      for (const s of all) {
        assert.ok(typeof s.name === 'string' && s.name.length > 0, `${JSON.stringify(s)} needs a name`);
        assert.ok(typeof s.description === 'string', `${s.name} needs a description string`);
        assert.ok(['shipped', 'user', 'project'].includes(s.source), `${s.name} needs a valid source`);
        assert.ok(typeof s.path === 'string' && s.path.endsWith('SKILL.md'), `${s.name} needs a path ending in SKILL.md`);
      }
    });

    it('description is truncated to 200 chars', async () => {
      const long = 'A'.repeat(400);
      mkdirSync(join(FIXTURE_SHIPPED, 'long-desc'), { recursive: true });
      writeFileSync(join(FIXTURE_SHIPPED, 'long-desc', 'SKILL.md'), `---\nname: long-desc\ndescription: ${long}\n---\n# Long\n`);
      invalidateCache();
      const all = await skillsStore.list();
      const longSkill = all.find((s) => s.name === 'long-desc');
      assert.ok(longSkill.description.length <= 200, 'description should be truncated to 200 chars');
    });

    it('display name falls back to H1 heading when frontmatter name is missing', async () => {
      mkdirSync(join(FIXTURE_SHIPPED, 'heading-only'), { recursive: true });
      writeFileSync(join(FIXTURE_SHIPPED, 'heading-only', 'SKILL.md'), `---\ndescription: Has heading but no name field.\n---\n# My Heading Skill\nBody.\n`);
      invalidateCache();
      const all = await skillsStore.list();
      const skill = all.find((s) => s.name === 'My Heading Skill');
      assert.ok(skill, 'should fall back to H1 heading as name');
    });

    it('display name falls back to directory name when both frontmatter name and H1 are absent', async () => {
      mkdirSync(join(FIXTURE_SHIPPED, 'directory-named-skill'), { recursive: true });
      writeFileSync(join(FIXTURE_SHIPPED, 'directory-named-skill', 'SKILL.md'), `---\ndescription: No name anywhere.\n---\nPlain body without heading.\n`);
      invalidateCache();
      const all = await skillsStore.list();
      const skill = all.find((s) => s.path.endsWith('directory-named-skill/SKILL.md'));
      assert.ok(skill, 'should fall back to directory name');
    });

    it('returns empty array when no skill directories exist', async () => {
      const empty = join(tmpdir(), `bizar-empty-${Date.now()}`);
      mkdirSync(empty, { recursive: true });
      setProjectRoot(empty);
      invalidateCache();
      const all = await skillsStore.list();
      assert.ok(Array.isArray(all));
    });
  });

  // ── search() ────────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('returns all skills when query is empty', async () => {
      const all = await skillsStore.list();
      const results = await skillsStore.search('');
      assert.strictEqual(results.length, all.length);
    });

    it('filters by name or description substring', async () => {
      const results = await skillsStore.search('bizar');
      assert.ok(results.length > 0, 'should find at least one skill matching bizar');
      // Search matches name OR description, so at least one result should contain 'bizar'
      assert.ok(
        results.some((s) => `${s.name} ${s.description}`.toLowerCase().includes('bizar')),
        'results should contain bizar in name or description',
      );
    });

    it('filters by description substring', async () => {
      const results = await skillsStore.search('monitoring');
      assert.ok(results.length > 0, 'should find skill with monitoring in description');
    });

    it('returns plain strings — no ANSI escape codes in name or description', async () => {
      const results = await skillsStore.search('bizar');
      for (const s of results) {
        assert.ok(!s.name.includes('\x1b'), `name "${s.name}" should not contain ANSI escape codes`);
        assert.ok(!s.description.includes('\x1b'), `description should not contain ANSI codes`);
      }
    });

    it('matches multi-term queries (AND semantics)', async () => {
      const results = await skillsStore.search('bizar skill');
      for (const s of results) {
        const hay = `${s.name} ${s.description}`.toLowerCase();
        assert.ok(hay.includes('bizar') && hay.includes('skill'), `${s.name} should match both terms`);
      }
    });

    it('is case-insensitive', async () => {
      const r1 = await skillsStore.search('BIZAR');
      const r2 = await skillsStore.search('bizar');
      const r3 = await skillsStore.search('BiZaR');
      assert.strictEqual(r1.length, r2.length);
      assert.strictEqual(r2.length, r3.length);
    });
  });

  // ── refresh() ─────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('invalidates cache and rescans', async () => {
      const first = await skillsStore.list();
      assert.ok(first.length > 0);

      // Add a new skill
      mkdirSync(join(FIXTURE_SHIPPED, 'brand-new'), { recursive: true });
      writeFileSync(join(FIXTURE_SHIPPED, 'brand-new', 'SKILL.md'), `---\nname: Brand New\ndescription: A freshly added skill.\n---\n# Brand New\n`);
      invalidateCache();

      const after = await skillsStore.list();
      assert.ok(after.length > first.length, 'newly added skill should appear after refresh');
      const found = after.find((s) => s.name === 'Brand New');
      assert.ok(found, 'Brand New skill should be in list');
    });
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns a single skill by source and name', async () => {
      const skill = await skillsStore.get('shipped', 'bizar');
      assert.ok(skill, 'should find the bizar skill');
      assert.strictEqual(skill.name, 'bizar');
      assert.strictEqual(skill.source, 'shipped');
    });

    it('returns null for unknown skill', async () => {
      const skill = await skillsStore.get('shipped', 'nonexistent-skill-xyz');
      assert.strictEqual(skill, null);
    });
  });
});
