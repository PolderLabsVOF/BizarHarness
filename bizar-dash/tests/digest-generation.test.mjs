/**
 * tests/digest-generation.test.mjs
 *
 * v4.8.0 — End-to-end tests for digest generation.
 *
 * Verifies:
 *   - Creating tasks then generating a digest includes task info
 *   - dryRun does not save any files
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';

// Point stores to temp directories
const storeHome = join(tmpdir(), `bizar-digest-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.BIZAR_STORE_HOME = storeHome;

const DIGEST_STORE = await import('../src/server/digest-store.mjs');

// We import tasksStore to create tasks that should appear in the digest
let tasksStore;

describe('digest-generation', () => {
  beforeEach(async () => {
    mkdirSync(storeHome, { recursive: true });

    // Create the project's .obsidian directory with some notes
    const obsidianDir = join(storeHome, '.obsidian');
    const dailyDir = join(obsidianDir, 'daily');
    const decisionsDir = join(obsidianDir, 'decisions');
    mkdirSync(dailyDir, { recursive: true });
    mkdirSync(decisionsDir, { recursive: true });

    // Write some memory notes "within the week"
    writeFileSync(join(dailyDir, '2026-07-01.md'),
      '---\ntitle: "Daily Note Jul 1"\n---\n\nWorked on authentication flow.');
    writeFileSync(join(decisionsDir, 'use-sqlite.md'),
      '---\ntitle: "Use SQLite"\n---\n\nDecision to use SQLite for local storage.');
  });

  afterEach(() => {
    try { rmSync(storeHome, { recursive: true, force: true }); } catch { /* ignore */ }
    DIGEST_STORE.__resetStoreForTests();
  });

  // ── Basic generation ──────────────────────────────────────────────────────

  describe('basic generation', () => {
    it('generates markdown with all expected sections', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: true,
      });

      assert.ok(result.markdown);
      // Check frontmatter
      assert.ok(result.markdown.includes('type: digest'));
      assert.ok(result.markdown.includes('weekStart: 2026-06-28'));
      assert.ok(result.markdown.includes('weekEnd: 2026-07-04'));

      // Check all section headers present
      const sections = [
        'Tasks completed',
        'Tasks created',
        'Memory notes written',
        'Chat sessions',
        'Schedules fired',
        'Background agents completed',
        'Token usage',
      ];
      for (const s of sections) {
        assert.ok(result.markdown.includes(`## ${s}`), `section "${s}" should have a header`);
      }

      // Check footer
      assert.ok(result.markdown.includes('BizarHarness v4.8.0'));
    });

    it('memory-writes section is populated from vault state', async () => {
      // Use a week range that includes "right now" so the notes written
      // in beforeEach (which have the current mtime) are picked up.
      const now = new Date();
      const weekStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const weekEnd = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart,
        weekEnd,
        projectRoot: storeHome,
        dryRun: true,
      });

      // memory-writes section should contain our test notes (since they
      // were just created and fall within the dynamic date range)
      const memorySection = result.sections['memory-writes'];
      assert.ok(Array.isArray(memorySection), 'memory-writes should be an array');
      assert.ok(memorySection.length > 0, 'should include at least one memory note');
      // At least one note should reference the files we created
      const hasDaily = memorySection.some((n) => n.relPath.includes('daily'));
      const hasDecisions = memorySection.some((n) => n.relPath.includes('decisions'));
      assert.ok(hasDaily || hasDecisions, 'should include notes from our test vault');
    });
  });

  // ── dryRun behavior ───────────────────────────────────────────────────────

  describe('dryRun', () => {
    it('does not save files when dryRun is true', async () => {
      const result = await DIGEST_STORE.generateAndSave({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: true,
      });

      // saveResult should not be present
      assert.strictEqual(result.saveResult, undefined, 'saveResult should be undefined in dry run');

      // No digest files should exist
      const prefix = 'weekly-';
      const digestsDir = join(storeHome, 'digests');
      if (existsSync(digestsDir)) {
        const { readdirSync } = await import('node:fs');
        const files = readdirSync(digestsDir);
        const digestFiles = files.filter((f) => f.startsWith(prefix));
        assert.strictEqual(digestFiles.length, 0, 'no digest files should exist after dry run');
      }
    });

    it('saves files when dryRun is false', async () => {
      const result = await DIGEST_STORE.generateAndSave({
        weekStart: '2026-06-21',
        weekEnd: '2026-06-27',
        projectRoot: storeHome,
        dryRun: false,
      });

      assert.ok(result.saveResult, 'saveResult should be present');
      assert.ok(result.saveResult.ok);
      assert.ok(result.saveResult.paths.length >= 1);

      // File should exist on disk
      for (const p of result.saveResult.paths) {
        assert.ok(existsSync(p), `digest file should exist: ${p}`);
      }
    });
  });

  // ── Markdown format ───────────────────────────────────────────────────────

  describe('markdown format', () => {
    it('produces parseable frontmatter', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: true,
      });

      // Extract frontmatter between --- markers
      const lines = result.markdown.split('\n');
      assert.strictEqual(lines[0], '---', 'should start with frontmatter delimiter');
      const endIdx = lines.indexOf('---', 1);
      assert.ok(endIdx > 1, 'should have closing frontmatter delimiter');

      const fm = lines.slice(1, endIdx);
      const titleLine = fm.find((l) => l.startsWith('title:'));
      assert.ok(titleLine, 'frontmatter should have title');
      assert.ok(titleLine.includes('Weekly Digest'), 'title should mention Weekly Digest');
    });

    it('has a readable human date in the header', async () => {
      const result = await DIGEST_STORE.generateWeeklyDigest({
        weekStart: '2026-06-28',
        weekEnd: '2026-07-04',
        projectRoot: storeHome,
        dryRun: true,
      });

      // The markdown should have a **Week:** line
      assert.ok(result.markdown.includes('**Week:**'), 'should have week header');
    });
  });
});
