/**
 * cli/__tests__/ambiguity.test.mjs
 *
 * CLI surface tests for `bizar ambiguity` (Phase 3 OMX adoption).
 *
 * Covers:
 *   - Human format exits 0 with a clear table on a low-score spec
 *   - JSON format returns a parseable score object
 *   - --breakdown emits per-dimension contributions
 *   - --allow-high is required to exit 0 when the score > 0.10
 *   - Missing positional path on an empty docs/specs/ exits 2 with
 *     a clear error (no stack trace)
 *   - bin.mjs routes `binar ambiguity --help` to the help banner
 *     (regression guard for the bin-help-dispatch dispatcher)
 *
 * The tests exercise the actual file-system code paths via a
 * self-contained fixture written into a tmp dir, so they run
 * without depending on the host repo ever having run a
 * deep-interview.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  run,
  parseFlags,
  parseAmbiguitySection,
  resolveSpecPath,
  validateBreakdown,
  renderHuman,
  renderJson,
} from '../commands/ambiguity.mjs';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const BIN = join(REPO_ROOT, 'cli', 'bin.mjs');

/** Build a tmp directory with a deep-interview spec fixture.
 *
 *  The fixture embeds BOTH the spec-stored `score` (what the operator
 *  recorded at closure time) and a `clarityBreakdown` that, when fed
 *  back through `computeAmbiguity`, yields the same numeric. The
 *  default scores line up with the SKILL.md closure threshold
 *  (`AmbiguityScore ≤ 0.10` for closure).
 */
function setupFixture({ kind = 'greenfield', score = 0.05, mtime = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bizar-ambiguity-'));
  mkdirSync(join(root, 'docs', 'specs'), { recursive: true });
  // Pick clarity values that, weighted-averaged with the greenfield
  // preset, yield the requested `score` (round to 4dp to mirror the
  // SDK's rounding). We use uniform clarity across dimensions so the
  // weighted average collapses to the per-dimension value.
  const clarityValue = Number(score);
  const clarity = {
    intent: clarityValue,
    outcome: clarityValue,
    scope: clarityValue,
    constraints: clarityValue,
    success: clarityValue,
    context: clarityValue,
  };
  const specPath = join(root, 'docs', 'specs', 'deep-interview-foo.md');
  const body =
    '# Deep Interview — foo\n' +
    '\n' +
    '## Ambiguity breakdown\n' +
    '\n' +
    '```json\n' +
    JSON.stringify({ kind, score, clarityBreakdown: clarity }, null, 2) +
    '\n```\n' +
    '\n';
  writeFileSync(specPath, body);
  // Touch to the requested mtime so the most-recent selector is stable.
  if (mtime) {
    utimesSync(specPath, mtime, mtime);
  }
  return { root, specPath, clarity };
}

/** Suppress stderr in the captured process output (we assert on stdout only). */
function spawnAmbiguity(args, { cwd = REPO_ROOT, allowFail = false } = {}) {
  return spawnSync(process.execPath, [BIN, 'ambiguity', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    ...(allowFail ? {} : { stdio: ['ignore', 'pipe', 'pipe'] }),
  });
}

// ── parseFlags ────────────────────────────────────────────────────────────

test('parseFlags recognises --format, --breakdown, --allow-high, --kind', () => {
  const flags = parseFlags([
    '--format', 'json',
    '--breakdown',
    '--allow-high',
    '--kind', 'brownfield',
    '--unknown-flag',
    '--help',
  ]);
  assert.equal(flags.format, 'json');
  assert.equal(flags.breakdown, true);
  assert.equal(flags['allow-high'], true);
  assert.equal(flags.kind, 'brownfield');
  assert.equal(flags.help, true);
  assert.equal(flags['unknown-flag'], true);
});

test('parseFlags treats bare --flag as boolean true', () => {
  const flags = parseFlags(['--breakdown']);
  assert.equal(flags.breakdown, true);
});

// ── parseAmbiguitySection ─────────────────────────────────────────────────

test('parseAmbiguitySection parses a JSON code block with clarityBreakdown', () => {
  const spec = [
    '# Spec',
    '',
    '## Ambiguity breakdown',
    '',
    '```json',
    JSON.stringify(
      { kind: 'greenfield', score: 0.05, clarityBreakdown: { intent: 0.9, outcome: 0.9, scope: 0.9, constraints: 0.9, success: 0.9, context: 0.9 } },
      null,
      2,
    ),
    '```',
  ].join('\n');
  const parsed = parseAmbiguitySection(spec);
  assert.equal(parsed.kind, 'greenfield');
  assert.equal(parsed.explicitScore, 0.05);
  assert.equal(parsed.clarityBreakdown.intent, 0.9);
});

test('parseAmbiguitySection recovers clarity values from a breakdown contribution map', () => {
  const spec = [
    '# Spec',
    '',
    '## Ambiguity breakdown',
    '',
    '```json',
    JSON.stringify(
      { kind: 'greenfield', breakdown: { intent: 0.19, outcome: 0.19, scope: 0.1425, constraints: 0.1425, success: 0.1425, context: 0.1425 } },
      null,
      2,
    ),
    '```',
  ].join('\n');
  const parsed = parseAmbiguitySection(spec);
  assert.equal(parsed.clarityBreakdown.intent, 0.95);
  assert.equal(parsed.clarityBreakdown.outcome, 0.95);
});

test('parseAmbiguitySection parses a markdown table when no JSON block is present', () => {
  const spec = [
    '# Spec',
    '',
    '## Ambiguity breakdown',
    '',
    '| Dimension | Clarity |',
    '|---|---|',
    '| intent | 0.95 |',
    '| outcome | 0.95 |',
    '| scope | 0.95 |',
    '| constraints | 0.95 |',
    '| success | 0.95 |',
    '| context | 0.95 |',
    '',
    '**Kind:** greenfield',
    '**AmbiguityScore:** 0.05',
  ].join('\n');
  const parsed = parseAmbiguitySection(spec);
  assert.equal(parsed.kind, 'greenfield');
  assert.equal(parsed.explicitScore, 0.05);
  assert.equal(parsed.clarityBreakdown.intent, 0.95);
});

test('parseAmbiguitySection throws on malformed input', () => {
  assert.throws(() => parseAmbiguitySection('# No section here'), /Ambiguity breakdown/);
  assert.throws(() => parseAmbiguitySection('## Ambiguity breakdown\nno body'), /no JSON block and no markdown table/);
});

// ── validateBreakdown ─────────────────────────────────────────────────────

test('validateBreakdown accepts the greenfield preset with all six dimensions', () => {
  const breakdown = { intent: 0.9, outcome: 0.9, scope: 0.9, constraints: 0.9, success: 0.9, context: 0.9 };
  validateBreakdown(breakdown, 'greenfield');
});

test('validateBreakdown rejects out-of-range values', () => {
  const breakdown = { intent: 1.5, outcome: 0.9, scope: 0.9, constraints: 0.9, success: 0.9, context: 0.9 };
  assert.throws(() => validateBreakdown(breakdown, 'greenfield'), /must be a finite number in \[0, 1\]/);
});

// ── resolveSpecPath ───────────────────────────────────────────────────────

test('resolveSpecPath returns the explicit positional path when supplied', () => {
  const { root, specPath } = setupFixture();
  try {
    assert.equal(resolveSpecPath([specPath], { cwd: root }), specPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveSpecPath throws a clear error when no fixture exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-ambiguity-empty-'));
  try {
    assert.throws(
      () => resolveSpecPath([], { cwd: root }),
      /no positional path supplied and no docs\/specs\/deep-interview-\*\.md files found/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── render functions ──────────────────────────────────────────────────────

test('renderHuman emits aligned columns and a breakdown table when --breakdown is set', () => {
  const out = renderHuman({
    specPath: '/tmp/spec.md',
    kind: 'greenfield',
    score: 0.05,
    breakdown: { intent: 0.19, outcome: 0.19, scope: 0.1425, constraints: 0.1425, success: 0.1425, context: 0.1425 },
    showBreakdown: true,
  });
  assert.match(out, /bizar ambiguity/);
  assert.match(out, /PASS/);
  assert.match(out, /intent/);
  assert.match(out, /contribution/);
});

test('renderJson produces parseable JSON with all expected fields', () => {
  const json = renderJson({
    specPath: '/tmp/spec.md',
    kind: 'greenfield',
    score: 0.05,
    breakdown: { intent: 0.19, outcome: 0.19, scope: 0.1425, constraints: 0.1425, success: 0.1425, context: 0.1425 },
    showBreakdown: false,
  });
  const parsed = JSON.parse(JSON.stringify(json));
  assert.equal(parsed.score, 0.05);
  assert.equal(parsed.kind, 'greenfield');
  assert.equal(parsed.pass, true);
  assert.equal(parsed.closureThreshold, 0.10);
});

// ── run() integration ─────────────────────────────────────────────────────

test('run() returns 0 and prints a human table for a low-score spec', async () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.05 });
  try {
    // Capture by running the function and stubbing console.log.
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
    try {
      const code = await run([specPath]);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const text = captured.join('\n');
    assert.match(text, /bizar ambiguity — deep-interview-foo\.md/);
    assert.match(text, /computed score:/);
    assert.match(text, /PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run() --format json returns valid JSON', async () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.05 });
  try {
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
    try {
      const code = await run([specPath, '--format', 'json']);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const parsed = JSON.parse(captured.join('\n'));
    assert.equal(parsed.score, 0.05);
    assert.equal(parsed.kind, 'greenfield');
    assert.equal(parsed.pass, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run() --breakdown includes per-dimension output', async () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.05 });
  try {
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
    try {
      const code = await run([specPath, '--breakdown']);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
    const text = captured.join('\n');
    assert.match(text, /contribution/);
    assert.match(text, /intent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run() exits 1 when score > 0.10 and --allow-high is NOT set', async () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.50 });
  try {
    const origLog = console.log;
    const origErr = console.error;
    let stderrCaptured = '';
    console.log = () => {};
    console.error = (msg) => { stderrCaptured += msg + '\n'; };
    try {
      const code = await run([specPath]);
      assert.equal(code, 1);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    assert.match(stderrCaptured, /exceeds closure threshold/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run() exits 0 with --allow-high even when score > 0.10', async () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.50 });
  try {
    const origLog = console.log;
    console.log = () => {};
    try {
      const code = await run([specPath, '--allow-high']);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run() exits 2 with a clear error (no stack trace) when the path is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-ambiguity-err-'));
  try {
    const origErr = console.error;
    let stderrCaptured = '';
    console.error = (msg) => { stderrCaptured += msg + '\n'; };
    try {
      const code = await run([], { cwd: root });
      assert.equal(code, 2);
    } finally {
      console.error = origErr;
    }
    assert.match(stderrCaptured, /ambiguity:/);
    // Must NOT include a stack trace or TypeError prefix.
    assert.doesNotMatch(stderrCaptured, /TypeError:/);
    assert.doesNotMatch(stderrCaptured, /at run \(/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── bin.mjs dispatch ──────────────────────────────────────────────────────

test('binar ambiguity --help prints the usage banner via bin.mjs', () => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [BIN, 'ambiguity', '--help'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(status, 0, `exit code mismatch; stderr:\n${stderr}`);
  assert.match(stdout, /bizar ambiguity — score a deep-interview spec/);
});

test('binar ambiguity exits non-zero when a high-score spec lacks --allow-high', () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.40 });
  try {
    const { status, stderr } = spawnAmbiguity([specPath], { cwd: root, allowFail: true });
    assert.notEqual(status, 0, `expected non-zero exit; stderr:\n${stderr}`);
    assert.match(stderr, /exceeds closure threshold/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('binar ambiguity --format json prints valid JSON', () => {
  const { root, specPath } = setupFixture({ kind: 'greenfield', score: 0.05 });
  try {
    const { stdout, status } = spawnAmbiguity([specPath, '--format', 'json'], { cwd: root, allowFail: true });
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.kind, 'greenfield');
    assert.equal(parsed.pass, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
