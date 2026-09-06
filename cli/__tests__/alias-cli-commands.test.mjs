/**
 * cli/__tests__/alias-cli-commands.test.mjs
 *
 * Behavior-lock test for the CLI command surface after the OmniRoute
 * alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md).
 *
 * After implementation:
 *   - `bizar models`, `bizar model`, `bizar tier` MUST NOT be
 *     registered in `cli/bin.mjs` (the picker surface is removed).
 *   - `bizar doctor`, `bizar workflow`, `bizar worker` MUST retain
 *     their non-picker behavior — the command file exists and does
 *     not import `cli/commands/models.mjs` or the SDK router modules.
 *
 * The pre-implementation tree currently violates the picker-removal
 * assertion and passes the non-picker-behavior assertion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN_PATH = join(repoRoot, 'cli', 'bin.mjs');

function loadBin() {
  return readFileSync(BIN_PATH, 'utf8');
}

function loadSource(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

// Match `case 'models':` / `case "models":` patterns inside the
// bin.mjs switch — including the multi-case `case 'tools': case
// 'tier': case 'upgrade-defaults': {` form. We treat any switch case
// whose quoted label matches the picker family as a registration.
const PICKER_CASES = ['models', 'model', 'tier'];

function findCaseEntries(source, label) {
  // Captures `case 'label':` (with optional preceding whitespace and
  // any other labels on the same line — used by the legacy
  // `case 'tools': case 'tier': case 'upgrade-defaults':` block).
  const re = new RegExp(`(^|\\n)\\s*case\\s+(['"])${label}\\2\\s*:`, 'g');
  return source.match(re) || [];
}

test('alias-cli-commands: `bizar models` is NOT registered in cli/bin.mjs', () => {
  const src = loadBin();
  const entries = findCaseEntries(src, 'models');
  // Also reject the help-banner line that documents the command.
  assert.equal(
    entries.length,
    0,
    `cli/bin.mjs still registers the \`bizar models\` picker surface; found ${entries.length} case entries`,
  );
  assert.ok(
    !/\bmodels\s+Configure the global model picker\b/.test(src),
    'cli/bin.mjs help banner still advertises `bizar models`',
  );
});

test('alias-cli-commands: legacy `bizar model` alias is NOT registered in cli/bin.mjs', () => {
  const src = loadBin();
  const entries = findCaseEntries(src, 'model');
  assert.equal(
    entries.length,
    0,
    `cli/bin.mjs still registers the legacy \`bizar model\` alias; found ${entries.length} case entries`,
  );
  assert.ok(
    !/\bmodel\s+Deprecated alias for models\b/.test(src),
    'cli/bin.mjs help banner still advertises the deprecated `bizar model` alias',
  );
});

test('alias-cli-commands: `bizar tier` is NOT registered in cli/bin.mjs', () => {
  const src = loadBin();
  // `tier` historically shared a case with `tools` and
  // `upgrade-defaults`. We allow `tools` and `upgrade-defaults` to
  // remain — only the `tier` label must be gone.
  const entries = findCaseEntries(src, 'tier');
  assert.equal(
    entries.length,
    0,
    `cli/bin.mjs still registers the \`bizar tier\` picker; found ${entries.length} case entries`,
  );
  assert.ok(
    !/\btier\s+Explain the explicit configured model tier\b/.test(src),
    'cli/bin.mjs help banner still advertises `bizar tier`',
  );
});

test('alias-cli-commands: cli/commands/models.mjs file is removed', () => {
  assert.equal(
    existsSync(join(repoRoot, 'cli', 'commands', 'models.mjs')),
    false,
    'cli/commands/models.mjs must be deleted; static alias contract has no picker module',
  );
});

test('alias-cli-commands: cli/commands/tier.mjs file is removed', () => {
  assert.equal(
    existsSync(join(repoRoot, 'cli', 'commands', 'tier.mjs')),
    false,
    'cli/commands/tier.mjs must be deleted; static alias contract has no picker module',
  );
});

test('alias-cli-commands: `bizar doctor` retains its non-picker behavior', () => {
  // `bizar doctor` is implemented by `cli/doctor.mjs`. After the
  // overhaul, it must NOT import the picker or SDK router modules.
  const doctorPath = join(repoRoot, 'cli', 'doctor.mjs');
  assert.ok(existsSync(doctorPath), 'cli/doctor.mjs must exist (hosts bizar doctor)');
  const src = readFileSync(doctorPath, 'utf8');
  assert.ok(
    !/from\s+['"][^'"]*commands\/models\.mjs['"]/.test(src),
    'cli/doctor.mjs imports cli/commands/models.mjs; static alias contract forbids picker import',
  );
  assert.ok(
    !/from\s+['"][^'"]*router\/model-router\.js['"]/.test(src),
    'cli/doctor.mjs imports SDK router module; static alias contract forbids router import',
  );
  assert.ok(
    !/from\s+['"][^'"]*router\/select-dispatch-model\.js['"]/.test(src),
    'cli/doctor.mjs imports SDK selectDispatchModel; static alias contract forbids router import',
  );
});

test('alias-cli-commands: `bizar workflow` retains its non-picker behavior', () => {
  const workflowPath = join(repoRoot, 'cli', 'commands', 'workflow.mjs');
  assert.ok(existsSync(workflowPath), 'cli/commands/workflow.mjs must exist (hosts bizar workflow)');
  const src = readFileSync(workflowPath, 'utf8');
  assert.ok(
    !/from\s+['"][^'"]*commands\/models\.mjs['"]/.test(src),
    'cli/commands/workflow.mjs imports cli/commands/models.mjs; static alias contract forbids picker import',
  );
  assert.ok(
    !/from\s+['"][^'"]*router\/model-router\.js['"]/.test(src),
    'cli/commands/workflow.mjs imports SDK router module; static alias contract forbids router import',
  );
});

test('alias-cli-commands: `bizar worker` retains its non-picker behavior', () => {
  const workerPath = join(repoRoot, 'cli', 'commands', 'worker.mjs');
  assert.ok(existsSync(workerPath), 'cli/commands/worker.mjs must exist (hosts bizar worker)');
  const src = readFileSync(workerPath, 'utf8');
  assert.ok(
    !/from\s+['"][^'"]*commands\/models\.mjs['"]/.test(src),
    'cli/commands/worker.mjs imports cli/commands/models.mjs; static alias contract forbids picker import',
  );
  assert.ok(
    !/from\s+['"][^'"]*router\/model-router\.js['"]/.test(src),
    'cli/commands/worker.mjs imports SDK router module; static alias contract forbids router import',
  );
});
