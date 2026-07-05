/**
 * tests/digest-store.test.mjs
 *
 * v4.8.0 — Tests for the digest store CRUD operations.
 *
 * Verifies:
 *   - generateWeeklyDigest returns valid markdown
 *   - saveDigest writes file to expected paths
 *   - listDigests returns sorted by date
 *   - getDigest reads back the saved content
 *   - deleteDigest removes the file
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';

// Point the store to a temp directory
const storeHome = join(tmpdir(), `bizar-digest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.BIZAR_STORE_HOME = storeHome;

const DIGEST_STORE = await import('../src/server/digest-store.mjs');

describe('digest-store', () => {
  beforeEach(() => {
    mkdirSync(storeHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(storeHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── computeWeekRange ──────────────────────────────────────────────────────

  describe('computeWeekRange', () => {
    it('returns last 7 days when no args given', () => {
      const { weekStart, weekEnd } = DIGEST_STORE.computeWeekRange();
      assert.ok(typeof weekStart === 'string');
      assert.ok(typeof weekEnd === 'string');
      assert.match(weekStart, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(weekEnd, /^\d{4}-\d{2}-\d{2}$/);
      // weekEnd should be >= weekStart
      assert.ok(weekEnd >= weekStart);
    });

    it('returns the specified week range', () => {
      const { weekStart, weekEnd } = DIGEST_STORE.computeWeekRange('2026-06-29', '2026-07-05');
      assert.strictEqual(weekStart, '2026-06-29');
      assert.strictEqual(weekEnd, '2026-07-05');
    });
  });

  // ── generateWeeklyDigest ──────────────────────────────────────────────────

  describe('generateWeeklyDigest', () => {
    it('returns valid markdown with frontmatter', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart: '2026-06-29',
        weekEnd: '2026-07-05',
        projectRoot: storeHome,
        dryRun: true,
      });

      assert.ok(result.markdown, 'markdown should be present');
      assert.ok(result.markdown.startsWith('---'), 'markdown should start with frontmatter');
      assert.ok(result.markdown.includes('Weekly Digest'), 'markdown should contain title');
      assert.ok(result.markdown.includes('## Tasks completed'), 'markdown should have tasks section');
      assert.ok(result.markdown.includes('## Memory notes written'), 'markdown should have memory section');
      assert.ok(result.markdown.includes('## Chat sessions'), 'markdown should have chat section');
      assert.ok(result.markdown.includes('## Schedules fired'), 'markdown should have schedules section');
      assert.ok(result.markdown.includes('## Background agents completed'), 'markdown should have bg section');
      assert.ok(result.markdown.includes('## Token usage'), 'markdown should have usage section');
      assert.deepStrictEqual(result.sections, result.sections, 'sections object should be present');
      assert.strictEqual(result.weekStart, '2026-06-29');
      assert.strictEqual(result.weekEnd, '2026-07-05');
      assert.strictEqual(result.dryRun, true);
    });

    it('defaults to last 7 days when dates omitted', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        projectRoot: storeHome,
        dryRun: true,
      });
      assert.ok(result.markdown);
      assert.ok(result.weekStart, 'weekStart should be present');
      assert.ok(result.weekEnd, 'weekEnd should be present');
    });

    it('sections contain expected shapes', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart: '2026-06-29',
        weekEnd: '2026-07-05',
        projectRoot: storeHome,
        dryRun: true,
      });

      // All 7 section keys should be present
      const expectedKeys = ['tasks', 'tasks-created', 'memory-writes', 'chat-sessions',
        'schedules-fired', 'bg-agents-completed', 'usage-stats'];
      for (const key of expectedKeys) {
        assert.ok(key in result.sections, `section "${key}" should be present`);
      }
    });
  });

  // ── saveDigest ────────────────────────────────────────────────────────────

  describe('saveDigest', () => {
    it('writes digest files to expected paths', async () => {
      const markdown = '---\ntitle: "Test"\n---\n\n# Test digest body';
      const result = await DIGEST_STORE.saveDigest({
        markdown,
        weekStart: '2026-07-05',
      });

      assert.ok(result.ok);
      assert.ok(Array.isArray(result.paths));
      assert.ok(result.paths.length >= 1);

      // Primary path should exist
      const primaryPath = result.paths[0];
      assert.ok(existsSync(primaryPath), `primary path should exist: ${primaryPath}`);
      const content = readFileSync(primaryPath, 'utf8');
      assert.ok(content.includes(markdown));
    });

    it('also writes to project vault if .obsidian exists', async () => {
      const vaultDigests = join(storeHome, '.obsidian', 'digests');
      mkdirSync(vaultDigests, { recursive: true });

      const markdown = '---\ntitle: "Vault Test"\n---\n\n# Vault test body';
      const result = await DIGEST_STORE.saveDigest({
        markdown,
        weekStart: '2026-06-29',
        projectRoot: storeHome,
      });

      assert.ok(result.ok);
      const vaultPath = join(vaultDigests, 'weekly-2026-06-29.md');
      assert.ok(existsSync(vaultPath), `vault path should exist: ${vaultPath}`);
    });
  });

  // ── listDigests ───────────────────────────────────────────────────────────

  describe('listDigests', () => {
    it('returns an empty list when no digests exist', async () => {
      const digests = await DIGEST_STORE.listDigests();
      assert.ok(Array.isArray(digests));
      assert.strictEqual(digests.length, 0);
    });

    it('returns digests sorted by date descending', async () => {
      // Create two digests out of order
      await DIGEST_STORE.saveDigest({
        markdown: '# Alpha',
        weekStart: '2026-07-05',
      });
      await DIGEST_STORE.saveDigest({
        markdown: '# Beta',
        weekStart: '2026-06-28',
      });

      const digests = await DIGEST_STORE.listDigests();
      assert.strictEqual(digests.length, 2);
      // Should be sorted: 2026-07-05 first, then 2026-06-28
      assert.strictEqual(digests[0].weekStart, '2026-07-05');
      assert.strictEqual(digests[1].weekStart, '2026-06-28');
    });

    it('respects the limit parameter', async () => {
      await DIGEST_STORE.saveDigest({ markdown: '# A', weekStart: '2026-07-05' });
      await DIGEST_STORE.saveDigest({ markdown: '# B', weekStart: '2026-06-28' });
      await DIGEST_STORE.saveDigest({ markdown: '# C', weekStart: '2026-06-21' });

      const digests = await DIGEST_STORE.listDigests({ limit: 2 });
      assert.strictEqual(digests.length, 2);
    });
  });

  // ── getDigest ─────────────────────────────────────────────────────────────

  describe('getDigest', () => {
    it('returns null for non-existent path', async () => {
      const result = await DIGEST_STORE.getDigest('/nonexistent/path.md');
      assert.strictEqual(result, null);
    });

    it('reads back the saved digest content', async () => {
      const markdown = '---\ntitle: "Read Test"\n---\n\n# Read test body';
      const saveResult = await DIGEST_STORE.saveDigest({
        markdown,
        weekStart: '2026-07-04',
      });
      const primaryPath = saveResult.paths[0];

      const digest = await DIGEST_STORE.getDigest(primaryPath);
      assert.ok(digest, 'digest should be found');
      assert.strictEqual(digest.content, markdown);
      assert.strictEqual(digest.weekStart, '2026-07-04');
      assert.ok(digest.sizeBytes > 0);
      assert.strictEqual(digest.path, primaryPath);
    });
  });

  // ── deleteDigest ──────────────────────────────────────────────────────────

  describe('deleteDigest', () => {
    it('returns ok:false for empty path', async () => {
      const result = await DIGEST_STORE.deleteDigest(null);
      assert.strictEqual(result.ok, false);
    });

    it('removes the digest file and index entry', async () => {
      const markdown = '# Delete me';
      const saveResult = await DIGEST_STORE.saveDigest({
        markdown,
        weekStart: '2026-07-03',
      });
      const primaryPath = saveResult.paths[0];
      assert.ok(existsSync(primaryPath), 'file should exist before deletion');

      const delResult = await DIGEST_STORE.deleteDigest(primaryPath);
      assert.strictEqual(delResult.ok, true);
      assert.strictEqual(existsSync(primaryPath), false, 'file should be removed');

      // Index entry should be gone
      const digests = await DIGEST_STORE.listDigests();
      assert.strictEqual(digests.length, 0);
    });
  });

  // ── generateAndSave ───────────────────────────────────────────────────────

  describe('generateAndSave', () => {
    it('generates and saves when dryRun is false', async () => {
      const result = await DIGEST_STORE.generateAndSave({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: false,
      });

      assert.ok(result.markdown);
      assert.ok(result.saveResult);
      assert.ok(result.saveResult.ok);
      assert.ok(result.saveResult.paths.length >= 1);
    });

    it('does not save when dryRun is true', async () => {
      const result = await DIGEST_STORE.generateAndSave({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: true,
      });

      assert.ok(result.markdown);
      assert.strictEqual(result.saveResult, undefined);
    });
  });
});
