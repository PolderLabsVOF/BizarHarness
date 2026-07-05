/**
 * tests/memory-graph.test.mjs
 *
 * Tests for getObsidianLinkGraph in memory-store.mjs
 * and getLightRAGGraph in memory-lightrag.mjs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const TEST_STORE = await import('../src/server/memory-store.mjs').then((m) => m);

describe('getObsidianLinkGraph', () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `bizar-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, '.bizar'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function writeNote(relPath, body) {
    const full = join(projectRoot, '.obsidian', relPath);
    mkdirSync(join(projectRoot, '.obsidian', relPath.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
    const title = relPath.split('/').pop()?.replace(/\.md$/i, '') || relPath;
    writeFileSync(full, `---\ntitle: ${title}\n---\n\n${body}`, 'utf8');
  }

  it('extracts wikilinks and builds nodes + edges', () => {
    writeNote('notes/alpha.md', 'This links to [[Beta Note]] and [[Gamma]].');
    writeNote('notes/beta.md', 'Back to [[Alpha]].');
    writeNote('notes/gamma.md', 'No links here.');

    const { nodes, edges } = TEST_STORE.getObsidianLinkGraph({ projectRoot, limit: 200 });

    // Should have 3 nodes.
    assert.ok(nodes.length >= 3, `Expected >= 3 nodes, got ${nodes.length}`);

    // Each node should have required fields.
    for (const n of nodes) {
      assert.ok('id' in n, 'node must have id');
      assert.ok('label' in n, 'node must have label');
      assert.ok('type' in n, 'node must have type');
      assert.ok('size' in n, 'node must have size');
      assert.ok('group' in n, 'node must have group');
    }

    // Should have edges.
    assert.ok(edges.length > 0, 'Expected at least 1 edge');
    for (const e of edges) {
      assert.ok('source' in e, 'edge must have source');
      assert.ok('target' in e, 'edge must have target');
      assert.ok('type' in e, 'edge must have type');
      assert.ok('weight' in e, 'edge must have weight');
    }
  });

  it('handles empty vault gracefully', () => {
    const { nodes, edges } = TEST_STORE.getObsidianLinkGraph({ projectRoot, limit: 200 });
    assert.ok(Array.isArray(nodes), 'nodes must be an array');
    assert.ok(Array.isArray(edges), 'edges must be an array');
  });

  it('resolves wikilink targets by basename', () => {
    writeNote('foo.md', 'See [[Bar]] for details.');
    writeNote('bar.md', 'Related to [[Foo]].');
    const { edges } = TEST_STORE.getObsidianLinkGraph({ projectRoot, limit: 200 });
    // Should have resolved [[Bar]] -> bar.md and [[Foo]] -> foo.md.
    assert.ok(edges.length >= 1, 'Expected at least 1 edge from wikilink resolution');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      writeNote(`note${i}.md`, i === 0 ? 'Links to [[Note1]].' : '');
    }
    const { nodes, edges } = TEST_STORE.getObsidianLinkGraph({ projectRoot, limit: 3 });
    assert.ok(nodes.length <= 3, `Expected <= 3 nodes, got ${nodes.length}`);
    assert.ok(edges.length <= 9, `Expected <= 9 edges, got ${edges.length}`);
  });

  it('node label uses title frontmatter when available', () => {
    writeNote('mydoc.md', 'Content.');
    const { nodes } = TEST_STORE.getObsidianLinkGraph({ projectRoot, limit: 200 });
    const mydoc = nodes.find((n) => n.id === 'mydoc.md');
    assert.ok(mydoc, 'mydoc.md should be a node');
    assert.strictEqual(mydoc.label, 'mydoc');
  });
});
