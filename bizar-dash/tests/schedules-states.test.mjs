// Loop task #2 — Schedules ErrorState + EmptyState + Skeleton branches.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the conditional rendering logic from SchedulesView.tsx (after fix)
function deriveBranches({ resError, loading, schedulesLength }) {
  if (resError !== null && resError !== undefined) {
    return 'error';
  }
  if (loading && schedulesLength === 0) {
    return 'loading';
  }
  if (schedulesLength === 0) {
    return 'empty';
  }
  return 'list';
}

test('error branch when fetch rejects', () => {
  assert.equal(
    deriveBranches({ resError: new Error('boom'), loading: false, schedulesLength: 0 }),
    'error',
  );
});

test('error branch takes precedence even when data would otherwise be loading', () => {
  assert.equal(
    deriveBranches({ resError: new Error('boom'), loading: true, schedulesLength: 0 }),
    'error',
  );
});

test('loading branch when fetch in-flight and no data yet', () => {
  assert.equal(
    deriveBranches({ resError: null, loading: true, schedulesLength: 0 }),
    'loading',
  );
});

test('loading branch hidden once data arrives', () => {
  assert.equal(
    deriveBranches({ resError: null, loading: true, schedulesLength: 3 }),
    'list',
  );
});

test('empty branch when fetch resolved with []', () => {
  assert.equal(
    deriveBranches({ resError: null, loading: false, schedulesLength: 0 }),
    'empty',
  );
});

test('list branch when fetch resolved with >=1 schedule', () => {
  assert.equal(
    deriveBranches({ resError: null, loading: false, schedulesLength: 1 }),
    'list',
  );
});

test('list branch with many schedules', () => {
  assert.equal(
    deriveBranches({ resError: null, loading: false, schedulesLength: 50 }),
    'list',
  );
});
