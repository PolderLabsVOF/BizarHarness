/**
 * scripts/__tests__/improve-contract.test.mjs — F-194 Phase C drift guard.
 *
 * Pins the surface of `bizar improve` so a regression cannot silently:
 *   - drop the --apply --yes two-key floor
 *   - stop emitting the critical git-workflow-guard advisory
 *   - allow FORBIDDEN_IMPROVE_KEYS (prompt-shaped or raw input bytes)
 *   - skip the sha256 match or find-exactly-once invariants
 *   - skip the verification command exit-code check
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPROVE_PATH = join(REPO_ROOT, 'cli', 'commands', 'improve.mjs');
const PROPOSAL_PATH = join(REPO_ROOT, 'cli', 'commands', 'improve-proposal.mjs');
const BIN_PATH = join(REPO_ROOT, 'cli', 'bin.mjs');
const GIT_GUARD_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'git-workflow-guard.mjs');

test('improve.mjs exports the F-194 Phase C surface', async () => {
  const mod = await import('../../cli/commands/improve.mjs');
  assert.equal(typeof mod.run, 'function');
  assert.equal(typeof mod.appendImproveRow, 'function');
  assert.equal(typeof mod.listImproveRows, 'function');
  assert.equal(typeof mod.resolveImproveEvidenceDir, 'function');
  assert.equal(mod.IMPROVE_LOG, 'improve.jsonl');
  assert.ok(Array.isArray(mod.FORBIDDEN_IMPROVE_KEYS));
  for (const forbidden of ['prompt', 'promptText', 'rawPrompt', 'promptRedacted', 'userInput', 'rawInput', 'rawInputBytes', 'targetBytes']) {
    assert.ok(mod.FORBIDDEN_IMPROVE_KEYS.includes(forbidden), `must forbid ${forbidden}`);
  }
});

test('improve-proposal.mjs exports the proposal schema surface', async () => {
  const mod = await import('../../cli/commands/improve-proposal.mjs');
  assert.equal(typeof mod.newProposalId, 'function');
  assert.equal(typeof mod.validateProposal, 'function');
  assert.equal(typeof mod.planApply, 'function');
  assert.equal(typeof mod.planRollback, 'function');
  assert.equal(typeof mod.sha256Text, 'function');
  assert.ok(Array.isArray(mod.FORBIDDEN_PROPOSAL_KEYS));
});

test('bin.mjs dispatches the improve subcommand', () => {
  const src = readFileSync(BIN_PATH, 'utf8');
  assert.match(src, /case 'improve':/);
  assert.match(src, /importCommand\('improve'\)/);
});

test('git-workflow-guard.mjs emits a critical advisory on bizar improve --apply', () => {
  const src = readFileSync(GIT_GUARD_PATH, 'utf8');
  assert.match(src, /\bbizar\s+improve\s+(?:run|rollback)\b[\s\S]*--(?:apply|yes)/i);
  // Must be critical (not warn) because it mutates a config file.
  assert.match(src, /improveApply[\s\S]{0,400}advisory\(\s*['"]critical['"]/);
});

test('improve.mjs requires --apply --yes two-key floor', () => {
  const src = readFileSync(IMPROVE_PATH, 'utf8');
  // The doRun path must refuse --apply without --yes, and refuse to apply at all without --apply.
  assert.match(src, /if \(!apply\)[\s\S]{0,200}mode:\s*['"]dry-run['"]/);
  assert.match(src, /if \(!flags\.yes\)[\s\S]{0,200}requires\s*--yes/i);
  // The doRollback path must require --yes for replace-back.
  assert.match(src, /if \(!flags\.yes\)[\s\S]{0,200}rollback requires --yes/i);
});

test('improve.mjs verifies sha256 match + find-exactly-once + verification exit 0', () => {
  const proposalSrc = readFileSync(PROPOSAL_PATH, 'utf8');
  const src = readFileSync(IMPROVE_PATH, 'utf8');
  // sha256 match: planApply (in proposal module) must compare currentSha to originalSha256.
  assert.match(proposalSrc, /currentSha !== proposal\.originalSha256/);
  // find-exactly-once: planApply must refuse if count !== 1.
  assert.match(proposalSrc, /count !== 1/);
  // Verification exit code check lives in improve.mjs doRun.
  assert.match(src, /verifyExit !== \(proposal\.verification\.expectedExitCode/);
});

test('improve.mjs appends an evidence row on every apply (success or rolled-back)', () => {
  const src = readFileSync(IMPROVE_PATH, 'utf8');
  // Two appendImproveRow calls: one inside the rolled-back branch, one in the success path.
  const calls = src.match(/appendImproveRow\(\s*\{/g) || [];
  assert.ok(calls.length >= 2, `expected at least 2 appendImproveRow calls, found ${calls.length}`);
});

test('improve.mjs writes the row via the secure-dir evidence path', () => {
  const src = readFileSync(IMPROVE_PATH, 'utf8');
  // Either a static `from './secure-dir.mjs'` or a dynamic `import('./secure-dir.mjs')`
  // is acceptable — both land at the same single source of truth.
  assert.match(src, /(?:from|import)\s*['"]\.\/secure-dir\.mjs['"]/);
  assert.match(src, /ensureSecureDir\(\s*\{[^}]*subdir:\s*'evidence'/);
});
