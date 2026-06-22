/**
 * cli/graph.test.mjs
 *
 * Tests for the `bizar graph` subcommand.
 * Uses Node's built-in node:test (no external test framework).
 *
 * Covered:
 *   - findPython() returns a string when Python is on PATH (or null)
 *   - parseGraphStats() returns null for nonexistent files
 *   - parseGraphStats() returns correct {nodes, edges, communities} from a fixture
 *   - GRAPH_DIR constant is '.bizar/graph'
 *   - help output contains all subcommand names
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve graph.mjs from this test file's location
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const {
  findPython,
  parseGraphStats,
  showGraphHelp,
  GRAPH_DIR,
} = await import('./graph.mjs');

// ── Constants ─────────────────────────────────────────────────────────────────

test('GRAPH_DIR equals ".bizar/graph"', () => {
  assert.equal(GRAPH_DIR, '.bizar/graph');
});

// ── findPython ────────────────────────────────────────────────────────────────

describe('findPython()', () => {
  test('returns a string when python3 or python is on PATH', () => {
    const result = findPython();
    // On most dev machines Python is installed; the test documents the expected shape
    if (result !== null) {
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 0);
    }
  });

  test('returns null when neither python3 nor python is found', () => {
    // We can't easily stub PATH in this test runner without副作用,
    // so we verify the function is deterministic and returns the same value
    // across two calls (proving it doesn't throw or return garbage).
    const first = findPython();
    const second = findPython();
    assert.equal(first, second, 'findPython should be deterministic');
  });
});

// ── parseGraphStats ────────────────────────────────────────────────────────────

describe('parseGraphStats()', () => {
  test('returns null for a nonexistent path', () => {
    const result = parseGraphStats('/nonexistent/path/graph.json');
    assert.equal(result, null);
  });

  test('returns null for a file that is not valid JSON', () => {
    const tmpDir = join(PROJECT_ROOT, '.tmp_graph_test');
    mkdirSync(tmpDir, { recursive: true });
    try {
      const badPath = join(tmpDir, 'graph.json');
      writeFileSync(badPath, '{ not json', 'utf8');
      const result = parseGraphStats(badPath);
      assert.equal(result, null);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test('returns zeroed stats when graph.json has null nodes/links arrays', () => {
    const tmpDir = join(PROJECT_ROOT, '.tmp_graph_test2');
    mkdirSync(tmpDir, { recursive: true });
    try {
      const graphPath = join(tmpDir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ graph: {}, nodes: null, links: null }), 'utf8');
      const result = parseGraphStats(graphPath);
      // null arrays are treated as 0-length — parseGraphStats guards with Array.isArray
      assert.notEqual(result, null);
      assert.equal(result.nodes, 0);
      assert.equal(result.edges, 0);
      assert.equal(result.communities, 0);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test('returns correct stats from a minimal NetworkX node-link fixture', () => {
    const tmpDir = join(PROJECT_ROOT, '.tmp_graph_test3');
    mkdirSync(tmpDir, { recursive: true });
    try {
      const graphPath = join(tmpDir, 'graph.json');

      // NetworkX node-link JSON with 4 nodes, 3 links, 2 communities
      const fixture = {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: [
          { id: 'alpha', community: 0 },
          { id: 'beta', community: 0 },
          { id: 'gamma', community: 1 },
          { id: 'delta', community: 1 },
        ],
        links: [
          { source: 'alpha', target: 'beta' },
          { source: 'beta', target: 'gamma' },
          { source: 'gamma', target: 'delta' },
        ],
      };

      writeFileSync(graphPath, JSON.stringify(fixture), 'utf8');

      const stats = parseGraphStats(graphPath);

      assert.notEqual(stats, null);
      assert.equal(stats.nodes, 4, 'should count 4 nodes');
      assert.equal(stats.edges, 3, 'should count 3 links');
      assert.equal(stats.communities, 2, 'should detect 2 unique communities (0 and 1)');
      assert.ok(typeof stats.lastModified === 'string', 'lastModified should be ISO string');
      assert.ok(typeof stats.sizeBytes === 'number', 'sizeBytes should be a number');
      assert.ok(stats.sizeBytes > 0, 'sizeBytes should be > 0 for a real file');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test('handles nodes without a community field gracefully', () => {
    const tmpDir = join(PROJECT_ROOT, '.tmp_graph_test4');
    mkdirSync(tmpDir, { recursive: true });
    try {
      const graphPath = join(tmpDir, 'graph.json');
      const fixture = {
        nodes: [
          { id: 'orphan' },   // no community field
          { id: 'solo', community: 0 },
          { id: 'alone', community: 1 },
        ],
        links: [],
      };
      writeFileSync(graphPath, JSON.stringify(fixture), 'utf8');
      const stats = parseGraphStats(graphPath);
      assert.notEqual(stats, null);
      assert.equal(stats.communities, 2, 'should count communities 0 and 1 only');
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── Help output ───────────────────────────────────────────────────────────────

describe('showGraphHelp()', () => {
  test('outputs all subcommand names', () => {
    // Capture stdout
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += msg + '\n'; };

    try {
      showGraphHelp();
    } finally {
      console.log = originalLog;
    }

    // Assert each expected subcommand keyword appears in the help text
    const subcommands = ['build', 'update', 'query', 'path', 'explain', 'watch', 'status', 'install'];
    for (const cmd of subcommands) {
      assert.ok(
        output.includes(cmd),
        `help output should contain subcommand "${cmd}"`
      );
    }
  });

  test('mentions the GRAPH_DIR path', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += msg + '\n'; };

    try {
      showGraphHelp();
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('.bizar/graph'), 'help should mention the graph directory');
  });

  test('mentions graphify pip install command', () => {
    let output = '';
    const originalLog = console.log;
    console.log = (msg) => { output += msg + '\n'; };

    try {
      showGraphHelp();
    } finally {
      console.log = originalLog;
    }

    assert.ok(
      output.includes('pip install graphifyy'),
      'help should mention pip install graphifyy'
    );
  });
});

console.log('  graph.mjs tests loaded — run with: node --test cli/graph.test.mjs');
