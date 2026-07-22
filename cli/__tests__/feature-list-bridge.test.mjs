/**
 * cli/__tests__/feature-list-bridge.test.mjs
 *
 * F-035 — tests for cli/feature-list-bridge.mjs (claim protocol over
 * feature_list.json).
 *
 * Uses Node's built-in `node:test`. No external framework.
 *
 * Coverage:
 *   1. claim — first claim succeeds; second claim rejected ALREADY_CLAIMED.
 *   2. release — reverts to unclaimed; subsequent release errors.
 *   3. handoff — moves claimant to recipient atomically.
 *   4. steal — moves claimant with a stealReason recorded in history.
 *   5. transition — claimStatus moves through allowed states.
 *   6. list — filters by status, claimantId, type.
 *   7. Bad transition — non-allowed status change errors.
 *   8. unknown feature — NOT_FOUND.
 *   9. Persistence: round-trips through file storage.
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  FeatureListBridge,
  CLAIM_STATUSES,
  STEAL_REASONS,
  ClaimError,
} = await import('../feature-list-bridge.mjs');

// ── Fixture loader ────────────────────────────────────────────────────

let tmp;
let bridgeFactory;

function writeFixture(dir, name, features) {
  const file = join(dir, name);
  const payload = { $schema: 'https://bizar.dev/schemas/feature_list.v1.json', features };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

const minimalFeature = (id, extra = {}) => ({
  id,
  behavior: `Behavior for ${id}`,
  verification: 'make check',
  state: 'not_started',
  layer: 'L1',
  category: 'core',
  created: '2026-07-11',
  ...extra,
});

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bizar-bridge-'));
  bridgeFactory = (filePath) => new FeatureListBridge({
    filePath,
    backup: false, // speed up tests
  });
});

after(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

// ── claim ─────────────────────────────────────────────────────────────

describe('claim()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `claim-${Math.random().toString(36).slice(2, 8)}.json`, [
      minimalFeature('F-A'),
      minimalFeature('F-B', { state: 'passing' }),
    ]);
    br = bridgeFactory(file);
  });
  afterEach(() => { /* tmp cleaned in after() */ });

  test('first claim succeeds', () => {
    const result = br.claim('F-A', { type: 'human', id: 'mike', name: 'Odin' }, 'first-run');
    assert.equal(result.ok, true);
    const f = result.feature;
    assert.equal(f.claimant.id, 'mike');
    assert.equal(f.claimStatus, 'claimed');
    assert.ok(f.claimedAt);
    assert.equal(f.claimReason, 'first-run');
    assert.equal(f.claimHistory.length, 1);
    assert.equal(f.claimHistory[0].event, 'claim');
  });

  test('second claim rejected with ALREADY_CLAIMED', () => {
    br.claim('F-A', { type: 'human', id: 'mike', name: 'Odin' }, 'first-run');
    assert.throws(
      () => br.claim('F-A', { type: 'agent', id: 'karen' }, 'second-run'),
      (err) => err instanceof ClaimError && err.code === 'ALREADY_CLAIMED',
    );
  });

  test('claim against unknown feature rejected with NOT_FOUND', () => {
    assert.throws(
      () => br.claim('F-NONE', { type: 'agent', id: 'x' }, ''),
      (err) => err instanceof ClaimError && err.code === 'NOT_FOUND',
    );
  });

  test('claim rejects malformed claimant', () => {
    assert.throws(
      () => br.claim('F-A', { type: 'robot', id: 'x' }, ''),
      (err) => err instanceof ClaimError && err.code === 'BAD_CLAIMANT',
    );
  });

  test('can re-claim a completed feature', () => {
    br.claim('F-A', { type: 'human', id: 'mike' }, '');
    br.transition('F-A', 'completed', { id: 'mike' }, '');
    // released -> re-claimable
    const r2 = br.claim('F-A', { type: 'agent', id: 'karen' }, 'second life');
    assert.equal(r2.ok, true);
  });
});

// ── release ───────────────────────────────────────────────────────────

describe('release()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `rel-${Math.random().toString(36).slice(2, 8)}.json`, [minimalFeature('F-X')]);
    br = bridgeFactory(file);
  });

  test('release after claim sets status to unclaimed', () => {
    br.claim('F-X', { type: 'human', id: 'mike' }, '');
    const result = br.release('F-X', { id: 'mike' }, 'done');
    assert.equal(result.ok, true);
    assert.equal(result.feature.claimStatus, 'unclaimed');
    assert.equal(result.feature.claimant, null);
    assert.equal(result.feature.claimHistory.length, 2);
  });

  test('release without claim errors with NOT_CLAIMED', () => {
    assert.throws(
      () => br.release('F-X', { id: 'mike' }, ''),
      (err) => err instanceof ClaimError && err.code === 'NOT_CLAIMED',
    );
  });

  test('release with wrong claimant errors with WRONG_CLAIMANT', () => {
    br.claim('F-X', { type: 'human', id: 'mike' }, '');
    assert.throws(
      () => br.release('F-X', { id: 'karen' }, ''),
      (err) => err instanceof ClaimError && err.code === 'WRONG_CLAIMANT',
    );
  });
});

// ── handoff ───────────────────────────────────────────────────────────

describe('handoff()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `h-${Math.random().toString(36).slice(2, 8)}.json`, [minimalFeature('F-H')]);
    br = bridgeFactory(file);
  });

  test('handoff moves claimant', () => {
    br.claim('F-H', { type: 'human', id: 'mike' }, '');
    const result = br.handoff(
      'F-H',
      { type: 'human', id: 'mike' },
      { type: 'agent', id: 'karen', name: 'Tyr' },
      'context finished',
    );
    assert.equal(result.ok, true);
    assert.equal(result.feature.claimant.id, 'karen');
    assert.equal(result.feature.claimStatus, 'claimed');
    // history: claim + handoff-initiated + handoff-accepted
    const events = result.feature.claimHistory.map((e) => e.event);
    assert.deepEqual(events, ['claim', 'handoff-initiated', 'handoff-accepted']);
  });

  test('handoff with no current claim errors', () => {
    assert.throws(
      () => br.handoff(
        'F-H',
        { type: 'human', id: 'mike' },
        { type: 'agent', id: 'karen' },
        '',
      ),
      (err) => err instanceof ClaimError && err.code === 'NOT_CLAIMED',
    );
  });
});

// ── steal ─────────────────────────────────────────────────────────────

describe('steal()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `s-${Math.random().toString(36).slice(2, 8)}.json`, [minimalFeature('F-S')]);
    br = bridgeFactory(file);
  });

  test('steal moves the claim', () => {
    br.claim('F-S', { type: 'human', id: 'mike' }, '');
    for (const reason of STEAL_REASONS) {
      // Steal a fresh feature for each reason to avoid ALREADY_CLAIMED.
      const f = minimalFeature(`F-S-${reason}`);
      const fFile = writeFixture(tmp, `s-${reason}.json`, [f]);
      const subBridge = bridgeFactory(fFile);
      subBridge.claim(`F-S-${reason}`, { type: 'agent', id: 'previous' }, '');
      const result = subBridge.steal(`F-S-${reason}`, { type: 'agent', id: 'karen' }, reason);
      assert.equal(result.ok, true);
      assert.equal(result.previousClaimant.id, 'previous');
      assert.equal(result.feature.claimant.id, 'karen');
      assert.equal(result.stealReason, reason);
      assert.ok(
        result.feature.claimHistory.some((e) => e.event === 'steal' && e.reason === reason),
      );
    }
  });

  test('steal rejects unknown reason', () => {
    br.claim('F-S', { type: 'human', id: 'mike' }, '');
    assert.throws(
      () => br.steal('F-S', { type: 'agent', id: 'karen' }, 'bogus-reason'),
      (err) => err instanceof ClaimError && err.code === 'UNKNOWN_STEAL_REASON',
    );
  });
});

// ── transition ────────────────────────────────────────────────────────

describe('transition()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `t-${Math.random().toString(36).slice(2, 8)}.json`, [minimalFeature('F-T')]);
    br = bridgeFactory(file);
  });

  test('claim → active → paused → active → completed', () => {
    br.claim('F-T', { type: 'human', id: 'mike' }, '');
    br.transition('F-T', 'active', { id: 'mike' }, '');
    assert.equal(br.get('F-T').claimStatus, 'active');
    br.transition('F-T', 'paused', { id: 'mike' }, 'lunch');
    assert.equal(br.get('F-T').claimStatus, 'paused');
    br.transition('F-T', 'active', { id: 'mike' }, '');
    assert.equal(br.get('F-T').claimStatus, 'active');
    br.transition('F-T', 'completed', { id: 'mike' }, '');
    assert.equal(br.get('F-T').claimStatus, 'completed');
  });

  test('illegal transition rejected', () => {
    br.claim('F-T', { type: 'human', id: 'mike' }, '');
    // claimed → blocked is NOT in ALLOWED_TRANSITIONS['claimed']
    assert.throws(
      () => br.transition('F-T', 'blocked', { id: 'mike' }, ''),
      (err) => err instanceof ClaimError && err.code === 'BAD_TRANSITION',
    );
  });

  test('unknown status rejected', () => {
    br.claim('F-T', { type: 'human', id: 'mike' }, '');
    assert.throws(
      () => br.transition('F-T', 'bogus', { id: 'mike' }, ''),
      (err) => err instanceof ClaimError && err.code === 'UNKNOWN_STATUS',
    );
  });
});

// ── list ──────────────────────────────────────────────────────────────

describe('list()', () => {
  let file;
  let br;
  beforeEach(() => {
    file = writeFixture(tmp, `l-${Math.random().toString(36).slice(2, 8)}.json`, [
      minimalFeature('F-1'),
      minimalFeature('F-2'),
      minimalFeature('F-3'),
      minimalFeature('F-4'),
    ]);
    br = bridgeFactory(file);
  });

  test('claims 2, handoffs 1, steals 1 — list filters', () => {
    br.claim('F-1', { type: 'human', id: 'mike' }, '');
    br.claim('F-2', { type: 'agent', id: 'karen' }, '');
    br.claim('F-3', { type: 'human', id: 'mike' }, '');
    br.handoff('F-3', { type: 'human', id: 'mike' }, { type: 'agent', id: 'karen' }, '');
    br.claim('F-4', { type: 'human', id: 'greg' }, '');
    br.steal('F-4', { type: 'agent', id: 'karen' }, 'voluntary');

    const all = br.list();
    assert.equal(all.length, 4);
    const claimed = br.list({ status: 'claimed' });
    assert.equal(claimed.length, 4, 'all four are claimed at this point');
    const humanClaims = br.list({ claimedByHuman: true });
    // All four claimants are human-type except F-2 (initial agent) and F-3 (after handoff).
    // Once F-3 is handed off it has an agent claimant. F-4 was stolen by an agent.
    const humanIds = humanClaims.map((f) => f.id);
    assert.ok(humanIds.includes('F-1'), 'F-1 stayed human');
    assert.ok(!humanIds.includes('F-4'), 'F-4 is now an agent claim');

    const byOdin = br.list({ claimantId: 'mike' });
    assert.equal(byOdin.length, 1, 'only F-1 still belongs to mike');
    assert.equal(byOdin[0].id, 'F-1');
  });

  test('list with no filters returns every feature', () => {
    const all = br.list();
    assert.equal(all.length, 4);
  });
});

// ── Persistence ───────────────────────────────────────────────────────

describe('persistence', () => {
  test('bridges are independent — each gets its own file', () => {
    const file = writeFixture(tmp, `p-${Math.random().toString(36).slice(2, 6)}.json`, [minimalFeature('F-P')]);
    const a = bridgeFactory(file);
    a.claim('F-P', { type: 'human', id: 'mike' }, '');
    const b = bridgeFactory(file);
    assert.equal(b.get('F-P').claimant.id, 'mike');
    assert.equal(b.get('F-P').claimStatus, 'claimed');
  });

  test('atomic write produces a parseable file', () => {
    const file = writeFixture(tmp, `pw-${Math.random().toString(36).slice(2, 6)}.json`, [minimalFeature('F-PW')]);
    const a = bridgeFactory(file);
    a.claim('F-PW', { type: 'agent', id: 'first' }, '');
    a.release('F-PW', { id: 'first' }, 'round-trip test');
    a.claim('F-PW', { type: 'agent', id: 'second' }, 're-claim after release');
    // verify file is valid JSON
    const txt = readFileSync(file, 'utf8');
    const data = JSON.parse(txt);
    assert.ok(Array.isArray(data.features));
    assert.equal(data.features.length, 1);
    const f = data.features[0];
    assert.equal(f.claimant.id, 'second');
    assert.equal(f.claimStatus, 'claimed');
    assert.ok(Array.isArray(f.claimHistory));
    assert.equal(f.claimHistory.length, 3);
  });
});

// ── CLAIM_STATUSES + STEAL_REASONS shape ──────────────────────────────

describe('exported constants', () => {
  test('CLAIM_STATUSES matches the spec', () => {
    assert.deepEqual(
      [...CLAIM_STATUSES].sort(),
      ['active', 'blocked', 'claimed', 'completed', 'handoff-pending', 'paused', 'unclaimed'].sort(),
    );
  });

  test('STEAL_REASONS matches the spec', () => {
    assert.deepEqual(
      [...STEAL_REASONS].sort(),
      ['blocked-timeout', 'overloaded', 'stale', 'voluntary'].sort(),
    );
  });
});
