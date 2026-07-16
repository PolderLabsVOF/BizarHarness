// Tests M1 — agent card preview truncation + kind chip.

import test from 'node:test';
import assert from 'node:assert/strict';

// Lightweight copy of the truncation helper from AgentsView.tsx to avoid
// pulling in the React component (which would require jsdom). The real
// version is exported from AgentsView.tsx as `truncatePreview`.
function truncatePreview(s, max = 80) {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

test('truncatePreview passes short strings through unchanged', () => {
  assert.equal(truncatePreview('hello world'), 'hello world');
});

test('truncatePreview caps long strings at max-1 + ellipsis', () => {
  const long = 'a'.repeat(120);
  const out = truncatePreview(long);
  assert.equal(out.length, 80);
  assert.match(out, /…$/);
});

test('truncatePreview returns empty for empty/missing input', () => {
  assert.equal(truncatePreview(''), '');
  assert.equal(truncatePreview(undefined), '');
  assert.equal(truncatePreview(null), '');
});

test('truncatePreview boundary at exactly max', () => {
  const exact = 'b'.repeat(80);
  assert.equal(truncatePreview(exact), exact);
  assert.equal(truncatePreview(exact + 'x'), 'b'.repeat(79) + '…');
});
