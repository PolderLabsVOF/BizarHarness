/**
 * cli/__tests__/evidence.test.mjs
 *
 * F-191 / IMP-018 — `bizar evidence ...` regression coverage.
 *
 * Drives the CLI binary against a tmpfs evidence dir so the JSONL
 * round-trip is exercised end-to-end. Pin the operator-facing
 * contract:
 *
 *   - `bizar evidence tail --limit N` prints the last N rows
 *   - `bizar evidence show <id>` exits 2 with actionable error
 *     when the id is missing
 *   - `bizar evidence verify <id>` exits 1 when the row is
 *     tampered and prints the reason
 *   - `bizar evidence audit` lists rows missing `outcome` or with
 *     `actualProviderModel !== decision.modelId`
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CWD = process.cwd();
const BIN = join(CWD, 'cli', 'bin.mjs');

const EVIDENCE_MOD = await import('../../config/workflows/lib/dispatch.js');

function makeEvidenceDir() {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-evidence-cli-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedRow({ evidenceDir, routingDecisionId, runId, modelId, agentName = 'todd', phase = 'implement', outcome = null }) {
  EVIDENCE_MOD.appendEvidence({
    routingDecisionId,
    decision: {
      modelId,
      tier: 'high',
      confidence: 0.9,
      ineligibleReasons: [],
      routingDecisionId,
      reason: 'exact-capability',
      fallbackChain: [modelId],
    },
    taskFeatures: { task: 'demo', role: 'implementer', risk: 'medium' },
    runId,
    agentName,
    workflowPhase: phase,
    selectedProfiles: [{ id: modelId }],
    staticProfiles: [],
    activeSessionModel: 'anthropic/claude-sonnet',
    budget: {},
    health: {},
  }, { evidenceDir });
  if (outcome) {
    EVIDENCE_MOD.attachEvidenceOutcome(routingDecisionId, outcome, { evidenceDir });
  }
}

function runCli(args, { evidenceDir } = {}) {
  return spawnSync(process.execPath, [BIN, 'evidence', ...args], {
    cwd: CWD,
    env: {
      ...process.env,
      BIZAR_EVIDENCE_DIR: evidenceDir || join(CWD, '.harness', 'evidence'),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('evidence tail --limit 5 exits 0 and prints the seeded rows', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    for (let i = 0; i < 8; i++) {
      seedRow({
        evidenceDir,
        routingDecisionId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        runId: `run-${i}`,
        modelId: i % 2 ? 'anthropic/claude-haiku' : 'anthropic/claude-sonnet',
      });
    }
    const result = runCli(['tail', '--limit', '5'], { evidenceDir });
    assert.equal(result.status, 0, `cli failed: ${result.stderr}`);
    // The tail prints 5 rows; each row's heading is `routingDecisionId  seq=...`.
    const lines = (result.stdout || '').split('\n').filter(Boolean);
    assert.ok(lines.length >= 5, `expected at least 5 lines, saw ${lines.length}`);
    const idPattern = /^[0-9a-f-]{36}\s+seq=/;
    assert.ok(lines.some((line) => idPattern.test(line)), 'at least one heading line is present');
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence show <id> for a missing id exits 2 with an actionable error', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    const result = runCli(['show', '00000000-0000-4000-8000-000000000099'], { evidenceDir });
    assert.equal(result.status, 2, `cli should exit 2; saw ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /not found/);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence show <id> for a seeded id prints the row + outcome', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000050',
      runId: 'demo',
      modelId: 'anthropic/claude-haiku',
      outcome: { status: 'success', durationMs: 4242 },
    });
    const result = runCli(['show', '00000000-0000-4000-8000-000000000050'], { evidenceDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /00000000-0000-4000-8000-000000000050/);
    assert.match(result.stdout, /outcome\.status\s*=\s*success/);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence verify <id> for a tampered row exits 1 with the reason', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000060',
      runId: 'tamper',
      modelId: 'anthropic/claude-haiku',
    });
    // Tamper: rewrite the JSONL with a non-hex hash on the first row.
    const path = join(evidenceDir, 'dispatch.jsonl');
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0]);
    parsed.inputs.selectedProfilesHash = 'not-a-hash';
    lines[0] = JSON.stringify(parsed);
    writeFileSync(path, lines.join('\n') + '\n');
    const result = runCli(['verify', '00000000-0000-4000-8000-000000000060'], { evidenceDir });
    assert.equal(result.status, 1, `cli should exit 1; saw ${result.status}`);
    assert.match(result.stderr, /inputs-hash-mismatch/);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence verify <id> for a clean row exits 0', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000070',
      runId: 'clean',
      modelId: 'anthropic/claude-haiku',
    });
    const result = runCli(['verify', '00000000-0000-4000-8000-000000000070'], { evidenceDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /integrity OK/);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence run <runId> prints every row for the run', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000080',
      runId: 'shared',
      modelId: 'anthropic/claude-haiku',
    });
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000081',
      runId: 'shared',
      modelId: 'anthropic/claude-sonnet',
    });
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000082',
      runId: 'other',
      modelId: 'anthropic/claude-haiku',
    });
    const result = runCli(['run', 'shared'], { evidenceDir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /00000000-0000-4000-8000-000000000080/);
    assert.match(result.stdout, /00000000-0000-4000-8000-000000000081/);
    assert.doesNotMatch(result.stdout, /00000000-0000-4000-8000-000000000082/);
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('evidence audit lists rows missing outcome or with provider-model mismatch', () => {
  const evidenceDir = makeEvidenceDir();
  try {
    // Row 1: clean (outcome attached, model matches).
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000090',
      runId: 'audit-clean',
      modelId: 'anthropic/claude-haiku',
      outcome: { status: 'success', actualProviderModel: 'anthropic/claude-haiku' },
    });
    // Row 2: missing outcome.
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000091',
      runId: 'audit-missing',
      modelId: 'anthropic/claude-haiku',
      outcome: null,
    });
    // Row 3: provider-model mismatch.
    seedRow({
      evidenceDir,
      routingDecisionId: '00000000-0000-4000-8000-000000000092',
      runId: 'audit-mismatch',
      modelId: 'anthropic/claude-haiku',
      outcome: { status: 'success', actualProviderModel: 'anthropic/claude-sonnet' },
    });
    const result = runCli(['audit', '--json'], { evidenceDir });
    assert.equal(result.status, 1, 'audit should exit 1 when there is at least one mismatch or missing outcome');
    const report = JSON.parse(result.stdout);
    assert.equal(report.missingOutcome.length, 1);
    assert.equal(report.missingOutcome[0].routingDecisionId, '00000000-0000-4000-8000-000000000091');
    assert.equal(report.mismatched.length, 1);
    assert.equal(report.mismatched[0].routingDecisionId, '00000000-0000-4000-8000-000000000092');
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});