/**
 * cli/__tests__/learning-behavior.test.mjs — F-194 Phase B.3 CLI tests.
 *
 * Exercises `cli/commands/learning-behavior.mjs`:
 *   - resolveLearningDir precedence (BIZAR_LEARNING_DIR > BIZAR_HOME > XDG > ~/.config/bizar)
 *   - ensureLearningDir creates with 0o700 and tightens pre-existing dirs
 *   - buildLearningContext renders instincts / reject-feedback / behavior summary
 *     and NEVER includes any prompt-shaped field
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveLearningDir,
  ensureLearningDir,
  buildLearningContext,
  appendWorkerSuggestion,
} from '../commands/learning-behavior.mjs';

import {
  createBehaviorRecord,
  fingerprint64,
} from '../../packages/sdk/dist/learning/behavior-capture.js';

let tmp;
let savedHome;
let savedXdg;
let savedBizarHome;
let savedBizarLearningDir;

test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bizar-learning-behavior-'));
  savedHome = process.env.HOME;
  savedXdg = process.env.XDG_CONFIG_HOME;
  savedBizarHome = process.env.BIZAR_HOME;
  savedBizarLearningDir = process.env.BIZAR_LEARNING_DIR;
  process.env.HOME = tmp;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.BIZAR_HOME;
  delete process.env.BIZAR_LEARNING_DIR;
});

test.afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  if (savedBizarHome === undefined) delete process.env.BIZAR_HOME;
  else process.env.BIZAR_HOME = savedBizarHome;
  if (savedBizarLearningDir === undefined) delete process.env.BIZAR_LEARNING_DIR;
  else process.env.BIZAR_LEARNING_DIR = savedBizarLearningDir;
});

test('resolveLearningDir honors BIZAR_LEARNING_DIR > BIZAR_HOME > HOME default', () => {
  process.env.BIZAR_LEARNING_DIR = '/explicit/learning';
  assert.equal(resolveLearningDir(), '/explicit/learning');

  delete process.env.BIZAR_LEARNING_DIR;
  process.env.BIZAR_HOME = join(tmp, 'bizar-home');
  assert.equal(resolveLearningDir(), join(tmp, 'bizar-home', 'learning'));

  delete process.env.BIZAR_HOME;
  assert.equal(resolveLearningDir(), join(tmp, '.config', 'bizar', 'learning'));
});

test('ensureLearningDir creates with mode 0o700 and tightens pre-existing dirs', () => {
  const dir = ensureLearningDir();
  assert.equal(existsSync(dir), true);
  assert.equal(statSync(dir).mode & 0o777, 0o700);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  assert.equal(statSync(dir).mode & 0o777, 0o755);
  ensureLearningDir();
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('buildLearningContext returns empty string when no feeds exist', () => {
  ensureLearningDir();
  const ctx = buildLearningContext();
  assert.equal(ctx, '');
});

test('buildLearningContext renders instincts + reject-feedback + behavior summary without prompt text', () => {
  const dir = ensureLearningDir();
  writeFileSync(join(dir, 'instincts.jsonl'),
    JSON.stringify({ id: 'inst-001', trigger: 'git push', action: 'run', confidence: 0.9 }) + '\n');
  writeFileSync(join(dir, 'reject-feedback.jsonl'),
    JSON.stringify({ workerId: 'todd', reason: 'over-eager on trivial edit' }) + '\n');
  writeFileSync(join(dir, 'behavior.jsonl'),
    JSON.stringify(createBehaviorRecord({
      fingerprint: fingerprint64('audit my repo'),
      workerId: 'mike',
      accept: true,
    })) + '\n' +
    JSON.stringify(createBehaviorRecord({
      fingerprint: fingerprint64('review this plan'),
      workerId: 'linda',
      accept: false,
      rejectReason: 'wrong tier',
    })) + '\n',
  );

  const ctx = buildLearningContext();
  assert.match(ctx, /## Instincts \(top by confidence\)/);
  assert.match(ctx, /git push → run/);
  assert.match(ctx, /## Recent reject-feedback/);
  assert.match(ctx, /todd rejected: over-eager on trivial edit/);
  assert.match(ctx, /## Behavior summary \(no prompt text/);
  assert.match(ctx, /linda: accept=0 reject=1 last-reason="wrong tier"/);
  // Q4 invariant: no prompt field name anywhere in the rendered context.
  for (const forbidden of ['prompt=', 'promptText', 'rawPrompt', 'promptRedacted']) {
    assert.equal(ctx.includes(forbidden), false, `learning context leaked ${forbidden}`);
  }
});

test('behavior.jsonl row has no prompt / promptRedacted / rawPrompt fields', () => {
  const dir = ensureLearningDir();
  const filePath = join(dir, 'behavior.jsonl');
  return import('../../packages/sdk/dist/learning/behavior-capture.js').then((mod) => {
    const c = mod.createFileBehaviorCapture({ filePath });
    c.append(mod.createBehaviorRecord({
      fingerprint: mod.fingerprint64('audit'),
      workerId: 'mike',
      accept: true,
    }));
    const raw = readFileSync(filePath, 'utf8').trim();
    const obj = JSON.parse(raw);
    assert.equal('prompt' in obj, false);
    assert.equal('promptRedacted' in obj, false);
    assert.equal('rawPrompt' in obj, false);
  });
});

// F-194 Phase D: appendWorkerSuggestion writes one fingerprint-only row per
// matched worker to behavior.jsonl. Q4 invariant: no prompt text ever.
test('appendWorkerSuggestion writes one row per worker with shared fingerprint', () => {
  const dir = ensureLearningDir();
  const filePath = join(dir, 'behavior.jsonl');
  if (existsSync(filePath)) rmSync(filePath);
  const matches = [
    { workerId: 'testgaps', weight: 0.8, agent: 'linda', skill: null, matchedPattern: 'coverage' },
    { workerId: 'audit', weight: 0.7, agent: 'linda', skill: null, matchedPattern: 'audit' },
  ];
  const wrote = appendWorkerSuggestion({ matches });
  assert.equal(wrote, true);
  const raw = readFileSync(filePath, 'utf8').trim();
  const rows = raw.split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  // All rows share the same fingerprint (same dispatch).
  assert.equal(rows[0].fingerprint64, rows[1].fingerprint64);
  assert.match(rows[0].fingerprint64, /^[0-9a-f]{16}$/);
  assert.equal(rows[0].kind, 'worker-suggest');
  assert.equal(rows[1].kind, 'worker-suggest');
  assert.equal(rows[0].workerId, 'testgaps');
  assert.equal(rows[1].workerId, 'audit');
  assert.equal(rows[0].accept, false);
  // Q4: no prompt text field names appear.
  for (const row of rows) {
    for (const forbidden of ['prompt', 'promptText', 'rawPrompt', 'promptRedacted', 'userInput', 'rawInput']) {
      assert.equal(forbidden in row, false, `leaked forbidden key ${forbidden}`);
    }
  }
});

test('appendWorkerSuggestion returns false for empty matches', () => {
  const wrote = appendWorkerSuggestion({ matches: [] });
  assert.equal(wrote, false);
});