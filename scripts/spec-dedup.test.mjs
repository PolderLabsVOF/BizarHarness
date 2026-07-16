/**
 * scripts/spec-dedup.test.mjs
 *
 * Pillar B — Tests for spec dedup logic.
 * Parses sample issues, computes similarity, flags dupes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tokenize a title into a Set of lowercase words.
 * @param {string} title
 * @returns {Set<string>}
 */
function tokenize(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Compute overlap coefficient between two titles.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 - 1.0
 */
function similarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  return intersection / Math.min(setA.size, setB.size);
}

/**
 * Check if a new title is a potential duplicate of existing issues.
 * @param {string} newTitle
 * @param {Array<{number: number, title: string, body?: string}>} existingIssues
 * @param {number} threshold — 0.0-1.0
 * @returns {Array<{number: number, title: string, similarity: number}>}
 */
function findDuplicates(newTitle, existingIssues, threshold = 0.5) {
  const results = [];
  for (const issue of existingIssues) {
    const sim = similarity(newTitle, issue.title);
    if (sim >= threshold) {
      results.push({ number: issue.number, title: issue.title, similarity: sim });
    }
  }
  return results.sort((a, b) => b.similarity - a.similarity);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('similarity returns 1.0 for identical titles', () => {
  const s = similarity('Add feature X', 'Add feature X');
  assert.equal(s, 1.0);
});

test('similarity returns 0.0 for completely different titles', () => {
  const s = similarity('Add feature X', 'Fix bug Y');
  assert.equal(s, 0.0);
});

test('similarity returns high score for partial overlap', () => {
  const s = similarity('Add OAuth login', 'Add Google OAuth login');
  // intersection: {add, oauth, login} = 3, min size = 3 → 3/3 = 1.0
  assert.equal(s, 1.0);
});

test('similarity handles punctuation and case', () => {
  const s = similarity('Add feature: OAuth!', 'add oauth feature');
  assert.equal(s, 1.0);
});

test('findDuplicates returns empty array when nothing overlaps', () => {
  const issues = [
    { number: 1, title: 'Fix memory leak' },
    { number: 2, title: 'Add dark mode' },
  ];
  const dups = findDuplicates('Improve performance', issues);
  assert.equal(dups.length, 0);
});

test('findDuplicates returns matching issues above threshold', () => {
  const issues = [
    { number: 1, title: 'Fix memory leak in agent startup' },
    { number: 2, title: 'Add dark mode support' },
    { number: 3, title: 'Memory leak in background agents' },
  ];
  const dups = findDuplicates('Fix memory leak in agents', issues, 0.5);
  assert.ok(dups.length >= 1, 'Should find at least one dup');
  const titles = dups.map((d) => d.title);
  assert.ok(titles.some((t) => t.includes('memory')), 'Should match memory issues');
});

test('findDuplicates threshold 0.7 requires near-exact match', () => {
  const issues = [{ number: 1, title: 'Add OAuth login support' }];
  const dups = findDuplicates('Add OAuth login', issues, 0.7);
  assert.equal(dups.length, 1, 'Exact same words should score 1.0');
});

test('findDuplicates returns similarity scores sorted descending', () => {
  const issues = [
    { number: 1, title: 'Memory profiler' },
    { number: 2, title: 'Memory leak detection' },
    { number: 3, title: 'Fix memory issue' },
  ];
  const dups = findDuplicates('Memory profiling', issues, 0.3);
  const scores = dups.map((d) => d.similarity);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'Should be sorted desc');
});

test('empty existing issues list returns empty duplicates', () => {
  const dups = findDuplicates('Add something', []);
  assert.equal(dups.length, 0);
});
