/**
 * ambiguity-weights.test.mjs — Invariant guard for the
 * `AMBIGUITY_WEIGHTS` shipped by `packages/sdk/src/ambiguity/score.ts`.
 *
 * Asserts:
 *   - `greenfield` weight set sums to exactly `1.00` (not 1.0001, not
 *     0.9999 — exact).
 *   - `brownfield` weight set sums to exactly `1.00`.
 *   - All weights are non-negative finite numbers in `[0, 1]`.
 *
 * Imports from `dist/` so the test runs against the same compiled
 * output the SDK ships; the source is still the source of truth and
 * is rebuilt by `npm run build:sdk` (and by `npm test` via
 * `with-sdk-dist-lock.mjs`).
 *
 * Rerun whenever the weight tables change; the contract is that any
 * preset sums to `1.00` so the weighted-average output stays in
 * `[0, 1]`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMBIGUITY_WEIGHTS,
  AMBIGUITY_SCHEMA_VERSION,
} from '../../packages/sdk/dist/ambiguity/index.js';

function isAllowedWeight(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

test('greenfield weight set sums to exactly 1.00', () => {
  const weights = AMBIGUITY_WEIGHTS.greenfield;
  const values = Object.values(weights);
  const sum = values.reduce((acc, v) => acc + v, 0);
  assert.equal(sum, 1, `greenfield weights must sum to 1.00 (got ${sum})`);
});

test('brownfield weight set sums to exactly 1.00', () => {
  const weights = AMBIGUITY_WEIGHTS.brownfield;
  const values = Object.values(weights);
  const sum = values.reduce((acc, v) => acc + v, 0);
  assert.equal(sum, 1, `brownfield weights must sum to 1.00 (got ${sum})`);
});

test('every weight is a finite number in [0, 1]', () => {
  for (const [presetName, weights] of Object.entries(AMBIGUITY_WEIGHTS)) {
    for (const [dim, weight] of Object.entries(weights)) {
      assert.ok(
        isAllowedWeight(weight),
        `${presetName}.${dim} must be a finite number in [0, 1] (got ${String(weight)})`,
      );
    }
  }
});

test('schema version is exported', () => {
  assert.equal(typeof AMBIGUITY_SCHEMA_VERSION, 'string');
  assert.match(AMBIGUITY_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});
