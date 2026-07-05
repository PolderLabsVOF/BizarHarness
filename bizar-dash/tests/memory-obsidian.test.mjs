/**
 * tests/memory-obsidian.test.mjs
 *
 * v4.7.0 — Tests for the memory-obsidian façade: CRUD re-exports + the
 * higher-level helpers (tree, listBacklinks, linkGraph, diffVault) used by
 * the Memory tab Obsidian panel.
 *
 * Uses an isolated tmp projectRoot per describe so the rest of the repo's
 * memory config is untouched.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const obsidian = await import('../src/server/memory-obsidian.mjs');
const memoryStore = await import('../src/server/memory-store.mjs');

let tmpRoot;

beforeEach(() => {
  tmpRoot = join(tmpdir(), `bizar-memobs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpRoot, '.bizar'), { recursive: true });
  memoryStore.saveConfig(tmpRoot, {
    version: 1,
    backend: 'bizar-local',
    projectId: 'memobs-test',
    memoryRepo: {
      mode: 'local-only',
      path: join(tmpRoot, '.obsidian'),
      remote: null,
      branch: 'main',
      namespace: 'projects/memobs-test',
    },
    namespaces: {
      project: 'projects/memobs-test',
      global: 'global/bizar',
      user: 'users/local',
    },
    lightrag: { enabled: false, host: '127.0.0.1', port: 9621 },
    git: {
      autoPullOnSessionStart: false,
      autoCommitOnMemoryWrite: false,
      autoPushOnSessionEnd: false,
      commitAuthor: 'Test <test@local>',
      commitMessageTemplate: 'memory(test): {summary}',
    },
  });
  memoryStore.initVault(tmpRoot);
});

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Re-exports sanity ─────────────────────────────────────────────────────

describe('memory-obsidian façade', () => {
  test('re-exports the canonical CRUD surface', () => {
    assert.equal(typeof obsidian.listNotes, 'function');
    assert.equal(typeof obsidian.readNote, 'function');
    assert.equal(typeof obsidian.writeNote, 'function');
    assert.equal(typeof obsidian.deleteNote, 'function');
    assert.equal(typeof obsidian.searchVault, 'function');
    assert.equal(typeof obsidian.vaultStats, 'function');
    assert.equal(typeof obsidian.resolveVault, 'function');
  });

  test('exposes the Memory-tab specific helpers', () => {
    assert.equal(typeof obsidian.tree, 'function');
    assert.equal(typeof obsidian.listBacklinks, 'function');
    assert.equal(typeof obsidian.linkGraph, 'function');
    assert.equal(typeof obsidian.diffVault, 'function');
  });
});

// ── tree ──────────────────────────────────────────────────────────────────

describe('tree', () => {
  test('returns null when vault does not exist', () => {
    rmSync(join(tmpRoot, '.obsidian'), { recursive: true, force: true });
    const result = obsidian.tree(tmpRoot);
    assert.equal(result, null);
  });

  test('returns a folder node containing nested notes', () => {
    memoryStore.writeNote(tmpRoot, 'daily/2026-07-04.md', {
      frontmatter: fullFM({ title: 'Day 1' }),
      body: 'first day',
    });
    memoryStore.writeNote(tmpRoot, 'daily/2026-07-05.md', {
      frontmatter: fullFM({ title: 'Day 2' }),
      body: 'second day',
    });
    memoryStore.writeNote(tmpRoot, 'patterns/auth.md', {
      frontmatter: fullFM({ title: 'Auth pattern' }),
      body: 'use bcrypt',
    });
    const root = obsidian.tree(tmpRoot);
    assert.ok(root);
    assert.equal(root.type, 'folder');
    assert.ok(Array.isArray(root.children));
    const folders = root.children.filter((c) => c.type === 'folder').map((c) => c.name);
    assert.ok(folders.includes('daily'));
    assert.ok(folders.includes('patterns'));
  });
});

// ── listBacklinks ─────────────────────────────────────────────────────────

describe('listBacklinks', () => {
  test('returns empty for a note with no incoming links', () => {
    memoryStore.writeNote(tmpRoot, 'target.md', {
      frontmatter: fullFM({ title: 'Target' }),
      body: 'no one links here',
    });
    const links = obsidian.listBacklinks(tmpRoot, 'target.md');
    assert.deepEqual(links, []);
  });

  test('finds incoming wikilinks by basename', () => {
    memoryStore.writeNote(tmpRoot, 'projects/api.md', {
      frontmatter: fullFM({ title: 'API' }),
      body: 'API details.',
    });
    memoryStore.writeNote(tmpRoot, 'daily/today.md', {
      frontmatter: fullFM({ title: 'Today' }),
      body: 'Working on [[api]] and [[projects/api]].',
    });
    const links = obsidian.listBacklinks(tmpRoot, 'projects/api.md');
    assert.ok(links.length >= 1, 'expected at least one backlink');
    const src = links.find((l) => l.fromRelPath === 'daily/today.md');
    assert.ok(src);
    assert.match(src.snippet, /\[\[api\]\]/);
  });

  test('handles wikilinks with aliases and headings', () => {
    memoryStore.writeNote(tmpRoot, 'a.md', { frontmatter: fullFM({ title: 'A' }), body: 'a body' });
    memoryStore.writeNote(tmpRoot, 'b.md', {
      frontmatter: fullFM({ title: 'B' }),
      body: 'See [[a|the A note]] for context.',
    });
    const links = obsidian.listBacklinks(tmpRoot, 'a.md');
    assert.equal(links.length, 1);
    assert.match(links[0].snippet, /\[\[a\|the A note\]\]/);
  });

  test('does not include the target itself', () => {
    memoryStore.writeNote(tmpRoot, 'self.md', {
      frontmatter: fullFM({ title: 'Self' }),
      body: 'See [[self]] for context.',
    });
    const links = obsidian.listBacklinks(tmpRoot, 'self.md');
    assert.deepEqual(links, []);
  });
});

// ── linkGraph ─────────────────────────────────────────────────────────────

describe('linkGraph', () => {
  test('returns nodes for each note + edges for each wikilink', () => {
    memoryStore.writeNote(tmpRoot, 'a.md', { frontmatter: fullFM({ title: 'A' }), body: 'links to [[b]]' });
    memoryStore.writeNote(tmpRoot, 'b.md', { frontmatter: fullFM({ title: 'B' }), body: 'links to [[c]]' });
    memoryStore.writeNote(tmpRoot, 'c.md', { frontmatter: fullFM({ title: 'C' }), body: 'no links' });
    const g = obsidian.linkGraph(tmpRoot);
    assert.ok(g.nodes.length >= 3);
    assert.ok(g.edges.length >= 2);
    for (const e of g.edges) {
      assert.equal(typeof e.from, 'string');
      assert.equal(typeof e.to, 'string');
      assert.equal(typeof e.dangling, 'boolean');
    }
  });

  test('marks non-existent targets as dangling', () => {
    memoryStore.writeNote(tmpRoot, 'a.md', { frontmatter: fullFM({ title: 'A' }), body: 'links to [[ghost-note]]' });
    const g = obsidian.linkGraph(tmpRoot);
    const edge = g.edges.find((e) => e.raw === 'ghost-note');
    assert.ok(edge, 'expected edge for ghost-note');
    assert.equal(edge.dangling, true);
  });
});

// ── diffVault ─────────────────────────────────────────────────────────────

describe('diffVault', () => {
  test('returns empty diff when notes are identical', () => {
    memoryStore.writeNote(tmpRoot, 'a.md', { frontmatter: fullFM({ title: 'A' }), body: 'same body' });
    memoryStore.writeNote(tmpRoot, 'b.md', { frontmatter: fullFM({ title: 'B' }), body: 'same body' });
    const d = obsidian.diffVault(tmpRoot, 'a.md', 'b.md');
    assert.ok(d.lines.length > 0);
    for (const line of d.lines) {
      assert.notEqual(line.kind, 'add');
      assert.notEqual(line.kind, 'del');
    }
  });

  test('returns add + del entries for differing notes', () => {
    memoryStore.writeNote(tmpRoot, 'old.md', { frontmatter: fullFM({ title: 'Old' }), body: 'line1\nline2\nline3' });
    memoryStore.writeNote(tmpRoot, 'new.md', { frontmatter: fullFM({ title: 'New' }), body: 'line1\nline4\nline5' });
    const d = obsidian.diffVault(tmpRoot, 'old.md', 'new.md');
    const adds = d.lines.filter((l) => l.kind === 'add').map((l) => l.text);
    const dels = d.lines.filter((l) => l.kind === 'del').map((l) => l.text);
    assert.ok(adds.includes('line4'), 'expected line4 added');
    assert.ok(adds.includes('line5'), 'expected line5 added');
    assert.ok(dels.includes('line2'), 'expected line2 deleted');
    assert.ok(dels.includes('line3'), 'expected line3 deleted');
  });

  test('handles null fromPath gracefully', () => {
    memoryStore.writeNote(tmpRoot, 'new.md', { frontmatter: fullFM({ title: 'New' }), body: 'fresh content' });
    const d = obsidian.diffVault(tmpRoot, '', 'new.md');
    assert.ok(d.lines.length > 0);
    for (const line of d.lines) {
      assert.ok(['add', 'same'].includes(line.kind));
    }
  });
});

// ── CRUD via the façade ───────────────────────────────────────────────────

describe('CRUD via memory-obsidian façade', () => {
  test('writeNote + readNote + deleteNote round-trip', () => {
    const created = obsidian.writeNote(tmpRoot, 'foo/bar.md', {
      frontmatter: fullFM({ title: 'Foo' }),
      body: 'hello world',
    });
    assert.equal(created.relPath, 'foo/bar.md');
    const read = obsidian.readNote(tmpRoot, 'foo/bar.md');
    assert.ok(read);
    assert.equal(read.frontmatter.title, 'Foo');
    assert.equal(read.body, 'hello world');
    const ok = obsidian.deleteNote(tmpRoot, 'foo/bar.md');
    assert.equal(ok, true);
    const after = obsidian.readNote(tmpRoot, 'foo/bar.md');
    assert.equal(after, null);
  });

  test('searchVault finds notes by content', () => {
    obsidian.writeNote(tmpRoot, 'search/a.md', { frontmatter: fullFM({ title: 'A' }), body: 'contains the magic word auth' });
    obsidian.writeNote(tmpRoot, 'search/b.md', { frontmatter: fullFM({ title: 'B' }), body: 'no match here' });
    const r = obsidian.searchVault(tmpRoot, 'auth', { limit: 5 });
    assert.ok(r.length >= 1);
    assert.ok(r[0].relPath.startsWith('search/'));
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a schema-valid frontmatter object with overrides for the test note.
 * The memory-store schema requires memory_id, project_id, type, status,
 * confidence, created, updated, tags.
 */
function fullFM(overrides = {}) {
  return {
    memory_id: `mem-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'memobs-test',
    type: 'session_summary',
    status: 'draft',
    confidence: 'inferred',
    created: '2026-07-05',
    updated: '2026-07-05',
    tags: ['test'],
    ...overrides,
  };
}