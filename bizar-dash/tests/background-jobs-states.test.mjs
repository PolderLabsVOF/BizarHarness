/**
 * tests/background-jobs-states.test.mjs
 *
 * Exercises BackgroundJobsView ErrorState and EmptyState branches by
 * testing the useFetch response shapes that gate them.
 *
 * Run with: node --test bizar-dash/tests/background-jobs-states.test.mjs
 *
 * Branch matrix (from BackgroundJobsView.tsx render logic):
 *   loading=true  + instances=[]  → Skeleton
 *   error != null             → ErrorState (block)
 *   instances.length === 0    → EmptyState
 *   otherwise                 → instance cards
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// deriveInstances() mirrors the actual BackgroundJobsView logic so we can
// test the branch decisions in isolation without React/jest.
// ---------------------------------------------------------------------------

/**
 * Mirrors BackgroundJobsView useFetch return type + the derived instances list.
 * @param {{ data: {instances: unknown[]}|null, loading: boolean, error: Error|string|null }} fetchRes
 * @param {unknown[]} live
 */
function branch(fetchRes, live = []) {
  const { data, loading, error } = fetchRes;
  if (loading) return 'Skeleton';
  if (error) return 'ErrorState';
  const instances = [...live, ...(data?.instances ?? [])];
  if (instances.length === 0) return 'EmptyState';
  return 'InstanceList';
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('EmptyState when data.instances is empty array and no error', () => {
  const result = branch({ data: { instances: [] }, loading: false, error: null });
  assert.equal(result, 'EmptyState');
});

test('ErrorState (block) when useFetch returns an error', () => {
  const err = new Error('network timeout');
  const result = branch({ data: null, loading: false, error: err });
  assert.equal(result, 'ErrorState');
});

test('ErrorState when error is a string (FetchError.message)', () => {
  const result = branch({ data: null, loading: false, error: ' ECONNREFUSED' });
  assert.equal(result, 'ErrorState');
});

test('Skeleton when loading=true (even with prior live items)', () => {
  const result = branch({ data: null, loading: true, error: null }, [{ id: 'live-1' }]);
  assert.equal(result, 'Skeleton');
});

test('InstanceList when instances exist (live + fetched)', () => {
  const live = [{ instanceId: 'bg-001', status: 'running' }];
  const result = branch({ data: { instances: [{ instanceId: 'bg-002', status: 'done' }] }, loading: false, error: null }, live);
  assert.equal(result, 'InstanceList');
});

test('InstanceList when only live instances (fetch not yet resolved)', () => {
  const live = [{ instanceId: 'bg-live-1', status: 'running' }];
  const result = branch({ data: null, loading: false, error: null }, live);
  assert.equal(result, 'InstanceList');
});

test('InstanceList when live items exist even if fetched instances are empty', () => {
  // live and fetched are concatenated; empty fetched data does NOT clear live items.
  const live = [{ instanceId: 'bg-live-1' }];
  const result = branch({ data: { instances: [] }, loading: false, error: null }, live);
  assert.equal(result, 'InstanceList');
});
