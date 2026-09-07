/**
 * cli/__tests__/workflow.test.mjs
 *
 * Tests the bizplan-shaped CLI flag extensions added in Phase 5 of the OMX
 * adoption plan (`docs/plans/2026-09-03-omx-features.md`). The new flags are
 * `--mode`, `--deliberate`, and `--advisory` on `bizar workflow start`.
 *
 * These tests are pure unit tests of `resolveStartRouting(flags)` plus a
 * `parseFlags`-level check via `run()` for round-trip acceptance. They do
 * not touch the live workflow state machine (covered by
 * workflow-state.test.mjs).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStartRouting } from '../commands/workflow.mjs';
import { WorkflowStateError } from '../core/workflow-state.mjs';

test('resolveStartRouting returns default profile when no mode is given', () => {
  const flags = { _: [] };
  const routing = resolveStartRouting(flags);
  assert.deepEqual(routing, {
    profile: 'default',
    deliberate: false,
    advisory: false,
    routing: { mode: null, deliberate: false, advisory: false },
  });
});

test('resolveStartRouting honours explicit --profile', () => {
  const flags = { _: [], profile: 'plan-build-qa' };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'plan-build-qa');
  assert.equal(routing.routing.mode, null);
});

test('resolveStartRouting honours explicit --workflow alias', () => {
  const flags = { _: [], workflow: 'default' };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'default');
  assert.equal(routing.routing.mode, null);
});

test('resolveStartRouting maps --mode bizplan to plan-build-qa profile', () => {
  const flags = { _: [], mode: 'bizplan' };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'plan-build-qa');
  assert.equal(routing.routing.mode, 'bizplan');
  assert.equal(routing.deliberate, false);
  assert.equal(routing.advisory, false);
});

test('resolveStartRouting accepts --mode ralplan as deprecated alias for bizplan', () => {
  const flags = { _: [], mode: 'ralplan' };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'plan-build-qa');
  // `ralplan` is normalised to the canonical `bizplan` mode.
  assert.equal(routing.routing.mode, 'bizplan');
});

test('resolveStartRouting propagates --deliberate and --advisory booleans', () => {
  const flags = { _: [], mode: 'bizplan', deliberate: true, advisory: true };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'plan-build-qa');
  assert.equal(routing.routing.mode, 'bizplan');
  assert.equal(routing.deliberate, true);
  assert.equal(routing.advisory, true);
  assert.deepEqual(routing.routing, {
    mode: 'bizplan',
    deliberate: true,
    advisory: true,
  });
});

test('resolveStartRouting rejects unknown --mode values', () => {
  const flags = { _: [], mode: 'turbo' };
  assert.throws(
    () => resolveStartRouting(flags),
    (error) => error instanceof WorkflowStateError
      && error.code === 'USAGE'
      && /unknown --mode value/.test(error.message),
  );
});

test('resolveStartRouting rejects empty --mode value', () => {
  const flags = { _: [], mode: '' };
  // Empty string is treated as omitted → default profile, no routing hint.
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'default');
  assert.equal(routing.routing.mode, null);
});

test('resolveStartRouting handles --deliberate alone without --mode', () => {
  const flags = { _: [], deliberate: true };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'default');
  assert.equal(routing.routing.mode, null);
  assert.equal(routing.deliberate, true);
  assert.equal(routing.advisory, false);
});

test('resolveStartRouting handles --advisory alone without --mode', () => {
  const flags = { _: [], advisory: true };
  const routing = resolveStartRouting(flags);
  assert.equal(routing.profile, 'default');
  assert.equal(routing.routing.mode, null);
  assert.equal(routing.deliberate, false);
  assert.equal(routing.advisory, true);
});
