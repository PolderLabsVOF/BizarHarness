/**
 * cli/__tests__/evidence-bundles.test.mjs — F-194 typed EvidenceBundle
 * ledger tests. Exercises `cli/commands/evidence-bundles.mjs`:
 *
 *   - resolveEvidenceDir precedence (BIZAR_EVIDENCE_DIR > BIZAR_HOME > XDG > ~/.config)
 *   - ensureEvidenceDir creates with 0o700 mode and tightens pre-existing dirs
 *   - appendBundle appends one JSONL line + updates signatures.bundle
 *   - appendBundle refuses rows whose signature does not verify
 *   - appendBundle rejects path-traversal objectiveRunIds
 *   - listBundles enumerates every per-run JSONL with row counts
 *   - verifyBundles passes on a clean ledger + fails on tamper
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EVIDENCE_DIR_MODE,
  SIGNATURES_BUNDLE,
  resolveEvidenceDir,
  ensureEvidenceDir,
  appendBundle,
  listBundles,
  verifyBundles,
} from '../commands/evidence-bundles.mjs';

import {
  createEvidenceBundle,
  sha256Hex,
} from '../../packages/sdk/dist/autonomy/evidence-bundle.js';

const abcSha = sha256Hex('abc');
const zeroSha = sha256Hex('');

function fixtureFields(objectiveRunId) {
  return {
    objectiveRunId,
    command: 'npm test',
    cwd: '/tmp/run',
    envDigest: zeroSha,
    exitCode: 0,
    stdoutSha256: abcSha,
    stderrSha256: zeroSha,
    testCounts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    testReports: [
      { framework: 'node:test', suite: 'smoke', reportSha256: abcSha, durationMs: 1 },
    ],
    baselineRevision: 'deadbeef',
    resultingRevision: 'deadbeef',
    patchSha256: zeroSha,
    lockfileSha256: zeroSha,
    evaluatorVersion: 'v1',
    evaluatorSha256: abcSha,
    rubricSha256: abcSha,
    resourceUsage: { wallClockMs: 1, peakMemoryMb: 1, costUsdMicroCents: 0, tokens: { input: 0, output: 0 } },
  };
}

let tmp;
let savedHome;
let savedBizarHome;
let savedBizarEvidenceDir;
let savedXdgConfigHome;

test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bizar-evidence-bundles-'));
  savedHome = process.env.HOME;
  savedBizarHome = process.env.BIZAR_HOME;
  savedBizarEvidenceDir = process.env.BIZAR_EVIDENCE_DIR;
  savedXdgConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.HOME = tmp;
  delete process.env.BIZAR_HOME;
  delete process.env.BIZAR_EVIDENCE_DIR;
  delete process.env.XDG_CONFIG_HOME;
});

test.afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedBizarHome === undefined) delete process.env.BIZAR_HOME;
  else process.env.BIZAR_HOME = savedBizarHome;
  if (savedBizarEvidenceDir === undefined) delete process.env.BIZAR_EVIDENCE_DIR;
  else process.env.BIZAR_EVIDENCE_DIR = savedBizarEvidenceDir;
  if (savedXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdgConfigHome;
});

test('EVIDENCE_DIR_MODE is 0o700', () => {
  assert.equal(EVIDENCE_DIR_MODE, 0o700);
});

test('resolveEvidenceDir honors BIZAR_EVIDENCE_DIR > BIZAR_HOME > HOME default', () => {
  process.env.BIZAR_EVIDENCE_DIR = '/explicit/path';
  assert.equal(resolveEvidenceDir(), '/explicit/path');

  delete process.env.BIZAR_EVIDENCE_DIR;
  process.env.BIZAR_HOME = join(tmp, 'bizar-home');
  assert.equal(resolveEvidenceDir(), join(tmp, 'bizar-home', 'evidence'));

  delete process.env.BIZAR_HOME;
  assert.equal(resolveEvidenceDir(), join(tmp, '.config', 'bizar', 'evidence'));
});

test('ensureEvidenceDir creates the dir with mode 0o700 and tightens pre-existing dirs', () => {
  const dir = ensureEvidenceDir();
  assert.equal(existsSync(dir), true);
  assert.equal(statSync(dir).mode & 0o777, 0o700);

  // Pre-create with looser perms and re-run; it must tighten back to 0o700.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  assert.equal(statSync(dir).mode & 0o777, 0o755);
  ensureEvidenceDir();
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('appendBundle writes one JSONL line + updates signatures.bundle', () => {
  const secret = 's1';
  const runId = '00000000-0000-4000-8000-000000000001';
  const bundle = createEvidenceBundle(fixtureFields(runId), secret);
  const { path } = appendBundle({ bundle, secret });

  assert.equal(existsSync(path), true);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 1);
  const stored = JSON.parse(lines[0]);
  assert.equal(stored.bundleId, bundle.bundleId);
  assert.equal(stored.signature, bundle.signature);

  const dir = resolveEvidenceDir();
  const sigPath = join(dir, SIGNATURES_BUNDLE);
  assert.equal(existsSync(sigPath), true);
  const sigs = JSON.parse(readFileSync(sigPath, 'utf8'));
  assert.equal(sigs[runId].length, 1);
  assert.equal(sigs[runId][0].bundleId, bundle.bundleId);
  assert.equal(sigs[runId][0].signature, bundle.signature);
  assert.match(sigs[runId][0].sha256BundleLine, /^[0-9a-f]{64}$/);
});

test('appendBundle rejects when the signature does not verify', () => {
  const runId = '00000000-0000-4000-8000-000000000002';
  const bundle = createEvidenceBundle(fixtureFields(runId), 'good');
  const tampered = { ...bundle, exitCode: 1 };
  assert.throws(
    () => appendBundle({ bundle: tampered, secret: 'good' }),
    /bundle signature failed verification/,
  );
});

test('appendBundle rejects an empty secret', () => {
  const runId = '00000000-0000-4000-8000-000000000003';
  const bundle = createEvidenceBundle(fixtureFields(runId), 'good');
  assert.throws(() => appendBundle({ bundle, secret: '' }), /secret must be a non-empty string/);
});

test('appendBundle rejects path-traversal objectiveRunIds', () => {
  const runId = '00000000-0000-4000-8000-000000000004';
  const bundle = createEvidenceBundle(fixtureFields(runId), 'good');
  const malicious = { ...bundle, objectiveRunId: '../../../etc/passwd' };
  assert.throws(
    () => appendBundle({ bundle: malicious, secret: 'good' }),
    /unsafe characters/,
  );
});

test('listBundles enumerates every per-run JSONL with row counts', () => {
  const secret = 's2';
  const ids = [
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000011',
  ];
  for (const id of ids) {
    appendBundle({ bundle: createEvidenceBundle(fixtureFields(id), secret), secret });
    appendBundle({ bundle: createEvidenceBundle(fixtureFields(id), secret), secret });
  }
  const listed = listBundles();
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((r) => r.objectiveRunId).sort(), ids.slice().sort());
  for (const row of listed) {
    assert.equal(row.rowCount, 2);
    assert.match(row.lastAppendedAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test('verifyBundles passes on a clean ledger and fails on a tampered row', () => {
  const secret = 'v';
  const runId = '00000000-0000-4000-8000-000000000020';
  appendBundle({ bundle: createEvidenceBundle(fixtureFields(runId), secret), secret });

  const ok = verifyBundles({ secret });
  assert.equal(ok.ok, true);
  assert.equal(ok.verifiedRuns, 1);
  assert.equal(ok.totalRows, 1);

  // Tamper: append a row whose signature doesn't match.
  const bad = createEvidenceBundle(fixtureFields(runId), 'good');
  const tampered = { ...bad, exitCode: 1 }; // signature was for exitCode 0
  const jsonl = join(resolveEvidenceDir(), `${runId}.jsonl`);
  writeFileSync(jsonl, readFileSync(jsonl, 'utf8') + JSON.stringify(tampered) + '\n');

  const fail = verifyBundles({ secret });
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'bundle-signature-mismatch');
  assert.equal(fail.runId, runId);
});