/**
 * cli/__tests__/workflow-barrier-ref.test.mjs — Phase B (v10.21.0) B.2
 *
 * Snapshot test for the 4-line barrier reference block emitted by
 * `barrierRef()`. Pins the exact format so a future "let me make the
 * block bigger" change fails the test (per Phase B plan §4.3).
 *
 * Verifies:
 *   1. Stays under MAX_BARRIER_BYTES (3072) for representative inputs.
 *   2. Produces a deterministic 4-line block (prior phase, prior label,
 *      summary, path).
 *   3. Slug derivation is data-driven (phase + label are kebab-cased,
 *      not hardcoded).
 *   4. Truncates summaries longer than MAX_SUMMARY_BYTES (200 chars).
 *   5. Reuses the same path format as writeArtifact/readArtifact.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = fileURLToPath(import.meta.url);
const dispatchPath = resolve(here, '..', '..', '..', 'config', 'workflows', 'lib', 'dispatch.js');
const dispatch = await import(pathToFileURL(dispatchPath).href);

const { barrierRef, writeArtifact, readArtifact, MAX_BARRIER_BYTES, MAX_SUMMARY_BYTES } = dispatch;

describe('workflow-barrier-ref B.2', () => {
  const FIXTURES = [
    { runId: 'r1', phase: 'Research', label: 'plan', summary: 'research complete', expectedSlug: 'research__plan' },
    { runId: 'r2', phase: 'Plan', label: 'plan-audit', summary: '3 lanes', expectedSlug: 'plan__plan-audit' },
    { runId: 'r3', phase: 'Implement', label: 'implement:1:foo-bar', summary: 'lane foo-bar', expectedSlug: 'implement__implement-1-foo-bar' },
    { runId: 'r4', phase: 'Verify', label: 'review:1', summary: 'no findings', expectedSlug: 'verify__review-1' },
    { runId: 'r5', phase: 'AdversarialVerify', label: 'verify:1', summary: 'confirmed', expectedSlug: 'adversarialverify__verify-1' },
  ];

  test('each fixture produces a deterministic 4-line block under the byte budget', () => {
    for (const f of FIXTURES) {
      const ref = barrierRef(f);
      const lines = ref.promptBlock.split('\n');
      assert.equal(lines.length, 4, `${f.label}: must produce exactly 4 lines`);
      assert.match(lines[0], /^prior phase: /);
      assert.match(lines[1], /^prior label: /);
      assert.match(lines[2], /^summary:     /);
      assert.match(lines[3], /^path:        /);
      assert.ok(ref.path.endsWith(`${f.expectedSlug}.json`), `${f.label}: path must end with ${f.expectedSlug}.json (got ${ref.path})`);
      assert.ok(ref.bytes <= MAX_BARRIER_BYTES, `${f.label}: ${ref.bytes} bytes exceeds budget ${MAX_BARRIER_BYTES}`);
      assert.equal(ref.truncated, false, `${f.label}: short summary must not be truncated`);
    }
  });

  test('summary longer than MAX_SUMMARY_BYTES is truncated and flagged', () => {
    const longSummary = 'x'.repeat(500);
    const ref = barrierRef({ runId: 'r6', phase: 'Plan', label: 'audit', summary: longSummary });
    // The summary line in the block is bounded by MAX_SUMMARY_BYTES (200).
    const summaryLine = ref.promptBlock.split('\n')[2];
    assert.ok(summaryLine.length <= 'summary:     '.length + MAX_SUMMARY_BYTES);
    assert.equal(ref.truncated, true, 'oversized summary must set truncated=true');
  });

  test('snapshot: barrier block format is stable', () => {
    const ref = barrierRef({ runId: 'snap', phase: 'Research', label: 'plan', summary: 'short summary line' });
    // Exact format — pinning future edits.
    assert.equal(
      ref.promptBlock,
      [
        'prior phase: Research',
        'prior label: plan',
        'summary:     short summary line',
        `path:        ${ref.path}`,
      ].join('\n'),
    );
  });

  test('barrierRef path aligns with writeArtifact/readArtifact for the same (phase, label)', () => {
    const root = mkdtempSync(join(tmpdir(), 'bizar-barrier-path-'));
    try {
      const runId = 'run-path';
      const ref = barrierRef({ runId, phase: 'Plan', label: 'audit', summary: 's', runRoot: root });
      const write = writeArtifact({ runId, phase: 'Plan', label: 'audit', payload: { x: 1 }, summary: 's', runRoot: root });
      assert.equal(ref.path, write.artifactPath, 'barrierRef and writeArtifact must produce the same path');
      const read = readArtifact({ runId, phase: 'Plan', label: 'audit', runRoot: root });
      assert.equal(read.artifactPath, ref.path);
      assert.equal(read.stale, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
