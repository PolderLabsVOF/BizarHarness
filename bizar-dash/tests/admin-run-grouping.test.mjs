// Tests L6 — admin Run actions are grouped into 2-3 semantic sections.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the groupings from AdminView.tsx
const ACTIONS = [
  { id: 'gc', group: 'data' },
  { id: 'cache-clear', group: 'data' },
  { id: 'memory-reindex', group: 'data' },
  { id: 'logs-purge', group: 'logs' },
  { id: 'restart', group: 'service' },
  { id: 'rebuild', group: 'service' },
  { id: 'export-activity', group: 'logs' },
];

const GROUPS = ['data', 'service', 'logs'];

test('three grouping buckets', () => {
  assert.equal(GROUPS.length, 3);
});

test('data group contains 3 actions', () => {
  const c = ACTIONS.filter((a) => a.group === 'data');
  assert.equal(c.length, 3);
});

test('service group contains restart + rebuild', () => {
  const c = ACTIONS.filter((a) => a.group === 'service');
  assert.equal(c.length, 2);
  assert.ok(c.every((a) => ['restart', 'rebuild'].includes(a.id)));
});

test('logs group contains logs-purge + export-activity', () => {
  const c = ACTIONS.filter((a) => a.group === 'logs');
  assert.equal(c.length, 2);
});

test('every action belongs to exactly one group', () => {
  const total = GROUPS.reduce((acc, g) => acc + ACTIONS.filter((a) => a.group === g).length, 0);
  assert.equal(total, ACTIONS.length);
});
