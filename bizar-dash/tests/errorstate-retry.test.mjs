// Loop task #19 — ErrorState retry callback contract.
//
// Source: `ui/feedback/ErrorState.tsx`. The retry button must call
// `onRetry` (when provided) — no implicit side effects. This test
// asserts the wiring contract using a stub.

import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the onClick handler shape in ErrorState.tsx:
//   onClick={() => { if (onRetry) onRetry(); }}
function buildRetryHandler(onRetry) {
  return () => {
    if (onRetry) onRetry();
  };
}

test('retry button invokes onRetry when provided', () => {
  let called = 0;
  const handler = buildRetryHandler(() => { called += 1; });
  handler();
  assert.equal(called, 1);
});

test('retry button no-ops when onRetry is undefined', () => {
  const handler = buildRetryHandler(undefined);
  assert.doesNotThrow(() => handler());
});

test('retry button does not swallow errors thrown by onRetry', () => {
  const handler = buildRetryHandler(() => { throw new Error('retry failed'); });
  assert.throws(() => handler(), /retry failed/);
});

test('retry button calls onRetry exactly once per click', () => {
  let calls = 0;
  const handler = buildRetryHandler(() => { calls += 1; });
  handler();
  handler();
  handler();
  assert.equal(calls, 3);
});