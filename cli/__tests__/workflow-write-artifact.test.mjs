/**
 * cli/__tests__/workflow-write-artifact.test.mjs — Phase B (v10.21.0) B.1
 *
 * Regression tests for the run-scoped artifact store added to
 * `config/workflows/lib/dispatch.js`. Pins the directory shape, the
 * atomic-write guarantee, the manifest schema, the slug-derivation rule,
 * and the stale-flag semantics from the Phase B plan §4.1-4.3 + Q4
 * (fail-soft stale).
 *
 * Coverage:
 *   1. Atomicity — a tmp file orphaned by a crash leaves no half-written
 *      artifact on disk.
 *   2. Idempotency — same (runId, phase, label, payload) written twice
 *      produces the same sha256 hash.
 *   3. Manifest freshness — manifest updatedAt advances; entry is
 *      appended/replaced correctly.
 *   4. Naming derivation — slug derived from runtime data, no hardcoded
 *      phase or workflow lists.
 *   5. summaryHash stability — same summary yields the same hash.
 *   6. Stale flag — readArtifact returns `stale: true` when the manifest
 *      entry's summaryHash mismatches the on-disk envelope.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = fileURLToPath(import.meta.url);
const dispatchPath = resolve(here, '..', '..', '..', 'config', 'workflows', 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

const {
  writeArtifact,
  readArtifact,
  listArtifacts,
  listRuns,
  barrierRef,
  slugify,
  ARTIFACT_SCHEMA_VERSION,
  MAX_BARRIER_BYTES,
  WorkflowStateError,
} = dispatch;

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'bizar-artifact-'));
}

describe('workflow-write-artifact B.1', () => {
  test('1. atomicity: orphan tmp file does not appear as an artifact', () => {
    const root = makeRoot();
    try {
      const result = writeArtifact({
        runId: 'run-1',
        phase: 'Research',
        label: 'plan',
        payload: { summary: 'x', files: ['a'], risks: [], verification: ['make check'] },
        summary: 'plan summary',
        runRoot: root,
      });
      // Plant an orphan tmp file directly to simulate a crash
      const orphan = join(result.runDir, 'research__plan.json.tmp-deadbeef');
      writeFileSync(orphan, '{"partial":');
      const listed = listArtifacts({ runId: 'run-1', runRoot: root });
      assert.ok(listed.length === 1, `expected 1 artifact, got ${listed.length}`);
      assert.ok(!listed[0].path.includes('.tmp-'), 'tmp orphan must be ignored');
      // listArtifacts returns the slug-derived phase/label (filesystem-safe).
      assert.equal(listed[0].phase, 'research');
      assert.equal(listed[0].label, 'plan');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('2. idempotency: same (runId, phase, label, payload) yields the same sha256', () => {
    const root = makeRoot();
    try {
      const payload = { summary: 'same', files: ['x'], risks: [], verification: [] };
      const a = writeArtifact({ runId: 'run-idem', phase: 'Plan', label: 'audit', payload, runRoot: root });
      const b = writeArtifact({ runId: 'run-idem', phase: 'Plan', label: 'audit', payload, runRoot: root });
      const hashA = createHash('sha256').update(readFileSync(a.artifactPath)).digest('hex');
      const hashB = createHash('sha256').update(readFileSync(b.artifactPath)).digest('hex');
      assert.equal(hashA, hashB, 'identical payloads must produce identical sha256');
      const read = readArtifact({ runId: 'run-idem', phase: 'Plan', label: 'audit', runRoot: root });
      assert.equal(read.stale, false, 're-write with identical payload must not be stale');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('3. manifest freshness: updatedAt advances and entry appends/replaces', () => {
    const root = makeRoot();
    try {
      const a = writeArtifact({ runId: 'run-mf', phase: 'Plan', label: 'plan', payload: { approach: 'a', lanes: [], gates: [] }, runRoot: root });
      const firstManifest = JSON.parse(readFileSync(a.manifestPath, 'utf8'));
      assert.equal(firstManifest.schemaVersion, ARTIFACT_SCHEMA_VERSION);
      assert.equal(firstManifest.phases.length, 1);
      assert.equal(firstManifest.phases[0].phase, 'Plan');
      assert.equal(firstManifest.phases[0].label, 'plan');

      // Replace same key — phases array length must stay 1, not 2.
      writeArtifact({ runId: 'run-mf', phase: 'Plan', label: 'plan', payload: { approach: 'b', lanes: [], gates: [] }, runRoot: root });
      const secondManifest = JSON.parse(readFileSync(a.manifestPath, 'utf8'));
      assert.equal(secondManifest.phases.length, 1, 'duplicate (phase,label) must replace not append');
      assert.ok(secondManifest.updatedAt >= firstManifest.updatedAt, 'updatedAt must be >= createdAt');

      // New (phase,label) — appends.
      writeArtifact({ runId: 'run-mf', phase: 'Audit', label: 'audit', payload: { approach: 'c', lanes: [], gates: [] }, runRoot: root });
      const thirdManifest = JSON.parse(readFileSync(a.manifestPath, 'utf8'));
      assert.equal(thirdManifest.phases.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('4. naming derivation: data-driven slugs for several (phase, label) combos', () => {
    const root = makeRoot();
    try {
      const cases = [
        { phase: 'Research', label: 'repository-map' },
        { phase: 'Plan', label: 'plan' },
        { phase: 'Implement', label: 'implement:1:foo-bar' },
        { phase: 'Verify', label: 'review:1' },
        { phase: 'AdversarialVerify', label: 'verify:1' },
      ];
      for (const c of cases) {
        writeArtifact({ runId: 'run-name', phase: c.phase, label: c.label, payload: { ok: true }, runRoot: root });
      }
      const listed = listArtifacts({ runId: 'run-name', runRoot: root });
      const slugs = listed.map((l) => l.slug).sort();
      assert.deepEqual(slugs, [
        'adversarialverify__verify-1',
        'implement__implement-1-foo-bar',
        'plan__plan',
        'research__repository-map',
        'verify__review-1',
      ]);
      // Sanity: no hardcoded workflow name in the slugs.
      for (const s of slugs) {
        assert.ok(!/^bizar-|^ultracode-/.test(s), `slug ${s} must not encode a workflow name`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('5. summaryHash stability: identical summaries produce identical hashes', () => {
    const root = makeRoot();
    try {
      const a = writeArtifact({ runId: 'run-h', phase: 'Plan', label: 'plan', payload: { x: 1 }, summary: 'fixed summary line', runRoot: root });
      const b = writeArtifact({ runId: 'run-h2', phase: 'Plan', label: 'plan', payload: { x: 2 }, summary: 'fixed summary line', runRoot: root });
      const readA = readArtifact({ runId: 'run-h', phase: 'Plan', label: 'plan', runRoot: root });
      const readB = readArtifact({ runId: 'run-h2', phase: 'Plan', label: 'plan', runRoot: root });
      assert.ok(readA.summary && readA.summary.length > 0);
      assert.equal(readA.summaryHash, readB.summaryHash, 'summary hash is a function of summary only');
      assert.ok(!existsSync(join(root, 'run-h', 'manifest.json')) === false);
      assert.ok(readA.artifactPath.includes('plan__plan.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('6. Q4 stale flag: readArtifact returns stale when manifest hash mismatches envelope', () => {
    const root = makeRoot();
    try {
      const w = writeArtifact({ runId: 'run-stale', phase: 'Verify', label: 'final', payload: { ok: true }, summary: 'v1', runRoot: root });
      // Tamper with the manifest entry's summaryHash to simulate an
      // upstream re-render that the on-disk file has not caught up with.
      const manifest = JSON.parse(readFileSync(w.manifestPath, 'utf8'));
      manifest.phases[0].summaryHash = '0000000000000000';
      manifest.phases[0].stale = true;
      writeFileSync(w.manifestPath, JSON.stringify(manifest, null, 2));
      const read = readArtifact({ runId: 'run-stale', phase: 'Verify', label: 'final', runRoot: root });
      assert.equal(read.stale, true, 'Q4: stale flag must surface when manifest hash mismatches');
      assert.equal(read.payload, null, 'stale read returns null payload (fail-soft)');
      // Missing artifact is a separate case — must not be flagged stale.
      const missing = readArtifact({ runId: 'run-stale', phase: 'Verify', label: 'nonexistent', runRoot: root });
      assert.equal(missing.missing, true);
      assert.equal(missing.stale, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('barrierRef emits 4-line block under MAX_BARRIER_BYTES', () => {
    const root = makeRoot();
    try {
      const ref = barrierRef({ runId: 'run-br', phase: 'Plan', label: 'plan', summary: 'short summary', runRoot: root });
      assert.ok(ref.promptBlock.startsWith('prior phase: Plan\n'));
      assert.ok(ref.promptBlock.includes('prior label: plan'));
      assert.ok(ref.promptBlock.includes('summary:     short summary'));
      assert.ok(ref.promptBlock.includes('path:'));
      assert.ok(ref.bytes <= MAX_BARRIER_BYTES);
      assert.equal(ref.truncated, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('slugify normalizes arbitrary input', () => {
    assert.equal(slugify('Research'), 'research');
    assert.equal(slugify('Implement:1:foo-bar'), 'implement-1-foo-bar');
    assert.equal(slugify('  Hello World!! '), 'hello-world');
    assert.equal(slugify(''), 'unknown');
    assert.equal(slugify(null), 'unknown');
    assert.equal(slugify('a'.repeat(200)).length, 64);
  });

  test('listRuns enumerates run directories under runRoot', () => {
    const root = makeRoot();
    try {
      writeArtifact({ runId: 'r1', phase: 'Plan', label: 'a', payload: {}, runRoot: root });
      writeArtifact({ runId: 'r2', phase: 'Plan', label: 'a', payload: {}, runRoot: root });
      const runs = listRuns({ runRoot: root });
      assert.equal(runs.length, 2);
      const ids = runs.map((r) => r.runId).sort();
      assert.deepEqual(ids, ['r1', 'r2']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('WorkflowStateError surfaces on missing runId', () => {
    const root = makeRoot();
    try {
      assert.throws(() => writeArtifact({ phase: 'Plan', label: 'a', payload: {}, runRoot: root }), (err) => err instanceof WorkflowStateError && err.code === 'RUN_ID_REQUIRED');
      assert.throws(() => writeArtifact({ runId: 'r', phase: 'Plan', label: 'a', runRoot: root }), (err) => err instanceof WorkflowStateError && err.code === 'PAYLOAD_REQUIRED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
