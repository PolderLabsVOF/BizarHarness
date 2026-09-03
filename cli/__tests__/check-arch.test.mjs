/**
 * cli/__tests__/check-arch.test.mjs — DEC-022 regression
 *
 * Pins the architectural rule defined in `.harness/arch-rules.json`
 * under id `omx-canonical-location`. The rule is invoked by
 * `scripts/check-arch.sh` and must:
 *
 *   - Pass (exit 0) when every deep-interview / ultragoal / ralplan
 *     artifact lives under `docs/specs/`.
 *   - Fail (exit non-zero) and emit a DEC-022 violation message when
 *     any such artifact is written outside `docs/specs/`.
 *
 * The test extracts the rule's `check` command from the JSON config
 * and runs it inside an isolated fixture tree, so a regression cannot
 * pollute the real repo or be masked by unrelated state.
 *
 * See: docs/decisions/DEC-022-omx-canonical-artifact-location.md
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function loadRuleCheck() {
  const data = JSON.parse(
    readFileSync(join(repoRoot, '.harness', 'arch-rules.json'), 'utf8'),
  );
  const rule = data.rules.find((r) => r.id === 'omx-canonical-location');
  if (!rule) throw new Error('omx-canonical-location rule missing from .harness/arch-rules.json');
  if (rule.expect !== 'pass') {
    throw new Error(`omx-canonical-location rule must expect "pass" — saw "${rule.expect}"`);
  }
  return rule.check;
}

function runCheck(check, cwd) {
  return spawnSync('bash', ['-c', check], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: process.env.PATH },
  });
}

/**
 * Build a fresh fixture tree under tmpdir and stage the supplied files.
 * `files` is an array of `{ dir, name, content }` records (dirs created on demand).
 * Each test gets its own mkdtemp so leftover state cannot leak across cases.
 */
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'bizar-check-arch-'));
  // Always materialize docs/specs/ so the rule's prune expression is well-defined.
  mkdirSync(join(root, 'docs', 'specs'), { recursive: true });
  for (const f of files) {
    mkdirSync(join(root, f.dir), { recursive: true });
    writeFileSync(join(root, f.dir, f.name), f.content ?? '# fixture');
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

describe('check-arch rule: omx-canonical-location (DEC-022)', () => {
  const check = loadRuleCheck();

  test('empty fixture tree passes (no OMX artifacts anywhere)', (t) => {
    const root = fixture(t, []);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  test('non-matching filenames anywhere are ignored', (t) => {
    const root = fixture(t, [
      { dir: 'random', name: 'README.md' },
      { dir: 'cli/specs', name: 'spec.md' },
      { dir: '.harness/specs', name: 'legacy.md' },
    ]);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  // ── Positive cases: docs/specs/ is the only allowed sink. ─────────────

  test('allows docs/specs/deep-interview-foo.md (canonical deep-interview path)', (t) => {
    const root = fixture(t, [
      { dir: 'docs/specs', name: 'deep-interview-foo.md' },
    ]);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  test('allows docs/specs/ultragoal-F-176.md (canonical ultragoal spec)', (t) => {
    const root = fixture(t, [
      { dir: 'docs/specs', name: 'ultragoal-F-176.md' },
    ]);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  test('allows docs/specs/ralplan-feature-x.md (canonical ralplan spec)', (t) => {
    const root = fixture(t, [
      { dir: 'docs/specs', name: 'ralplan-feature-x.md' },
    ]);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  test('allows nested files under docs/specs/ (deep paths still allowed)', (t) => {
    const root = fixture(t, [
      { dir: 'docs/specs/sub', name: 'deep-interview-foo.md' },
      { dir: 'docs/specs/ultragoal', name: 'F-176.jsonl' },
      { dir: 'docs/specs/ralplan', name: 'feature-x.handoff.json' },
    ]);
    const r = runCheck(check, root);
    assert.equal(r.status, 0, `expected exit 0; stdout=${r.stdout}; stderr=${r.stderr}`);
  });

  // ── Negative cases: anything outside docs/specs/ fails the rule. ──────

  test('rejects cli/specs/deep-interview-foo.md (DEC-022 violation)', (t) => {
    const root = fixture(t, [
      { dir: 'cli/specs', name: 'deep-interview-foo.md' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0, 'expected non-zero exit');
    assert.match(r.stdout, /DEC-022/, 'output must mention DEC-022');
    assert.match(r.stdout, /deep-interview-foo\.md/, 'output must name the offending file');
    assert.match(r.stdout, /docs\/specs/, 'output must point at the canonical sink');
  });

  test('rejects packages/omx/ultragoal-F-176.md (ultragoal spec outside docs/specs)', (t) => {
    const root = fixture(t, [
      { dir: 'packages/omx', name: 'ultragoal-F-176.md' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0, 'expected non-zero exit');
    assert.match(r.stdout, /DEC-022/);
    assert.match(r.stdout, /ultragoal-F-176\.md/);
  });

  test('rejects .bizar/ultragoal-F-176.jsonl (ultragoal ledger outside docs/specs)', (t) => {
    const root = fixture(t, [
      { dir: '.bizar', name: 'ultragoal-F-176.jsonl' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0, 'expected non-zero exit');
    assert.match(r.stdout, /DEC-022/);
    assert.match(r.stdout, /ultragoal-F-176\.jsonl/);
  });

  test('rejects config/workflows/ralplan-feature-x.handoff.json (ralplan handoff outside docs/specs)', (t) => {
    const root = fixture(t, [
      { dir: 'config/workflows', name: 'ralplan-feature-x.handoff.json' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0, 'expected non-zero exit');
    assert.match(r.stdout, /DEC-022/);
    assert.match(r.stdout, /ralplan-feature-x\.handoff\.json/);
  });

  test('rejects cli/ralplan-feature-x.md (ralplan spec outside docs/specs)', (t) => {
    const root = fixture(t, [
      { dir: 'cli', name: 'ralplan-feature-x.md' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0, 'expected non-zero exit');
    assert.match(r.stdout, /DEC-022/);
  });

  test('multiple violations all surface in a single run', (t) => {
    const root = fixture(t, [
      { dir: 'cli/specs', name: 'deep-interview-foo.md' },
      { dir: 'packages/omx', name: 'ultragoal-F-176.md' },
      { dir: 'config/workflows', name: 'ralplan-feature-x.handoff.json' },
      { dir: '.bizar', name: 'ultragoal-F-176.jsonl' },
    ]);
    const r = runCheck(check, root);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /DEC-022/);
    assert.match(r.stdout, /deep-interview-foo\.md/);
    assert.match(r.stdout, /ultragoal-F-176\.md/);
    assert.match(r.stdout, /ralplan-feature-x\.handoff\.json/);
    assert.match(r.stdout, /ultragoal-F-176\.jsonl/);
  });
});
