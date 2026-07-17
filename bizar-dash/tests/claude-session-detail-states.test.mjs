// Loop task #4 — ClaudeSessionDetail ErrorState + EmptyState branches.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirror the conditional rendering logic from ClaudeSessionDetail.tsx
function deriveBranches({ payloadError, loading, messagesLength }) {
  if (payloadError !== null && payloadError !== undefined) {
    return 'error';
  }
  if (loading && messagesLength === 0) {
    return 'loading';
  }
  if (messagesLength === 0) {
    return 'empty';
  }
  return 'list';
}

test('error branch when messages fetch rejects', () => {
  assert.equal(
    deriveBranches({ payloadError: new Error('boom'), loading: false, messagesLength: 0 }),
    'error',
  );
});

test('error branch takes precedence over loading state', () => {
  assert.equal(
    deriveBranches({ payloadError: new Error('boom'), loading: true, messagesLength: 0 }),
    'error',
  );
});

test('error branch takes precedence over populated messages', () => {
  assert.equal(
    deriveBranches({ payloadError: new Error('boom'), loading: false, messagesLength: 3 }),
    'error',
  );
});

test('loading branch when in-flight and no data yet', () => {
  assert.equal(
    deriveBranches({ payloadError: null, loading: true, messagesLength: 0 }),
    'loading',
  );
});

test('empty branch when fetch resolved with []', () => {
  assert.equal(
    deriveBranches({ payloadError: null, loading: false, messagesLength: 0 }),
    'empty',
  );
});

test('list branch when fetch resolved with messages', () => {
  assert.equal(
    deriveBranches({ payloadError: null, loading: false, messagesLength: 5 }),
    'list',
  );
});

test('list branch hides skeleton once messages arrive', () => {
  assert.equal(
    deriveBranches({ payloadError: null, loading: true, messagesLength: 1 }),
    'list',
  );
});
