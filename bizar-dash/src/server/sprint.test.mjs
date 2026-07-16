/**
 * bizar-dash/src/server/sprint.test.mjs
 *
 * Pillar B — Tests for scripts/sprint.mjs
 * 3 groups: parser test, fill test, missing-goal tolerance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPTS_SPRINT = join(process.cwd(), 'scripts', 'sprint.mjs');
const PROGRESS_PARSER = join(process.cwd(), 'bizar-dash', 'src', 'server', 'progress-parser.mjs');
const SPRINT_TEMPLATE = join(process.cwd(), 'templates', 'sprint-contract.md');

function runSprintScript(goalId, cwd) {
  try {
    const stdout = execSync(`node "${SCRIPTS_SPRINT}" "${goalId}" "${cwd}" 2>&1`, {
      encoding: 'utf8',
    });
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

function makeTempProject() {
  const tmp = join(tmpdir(), `bizar-sprint-test-${process.pid}-${Date.now()}`);
  mkdirSync(join(tmp, '.bizar', 'sprints'), { recursive: true });
  mkdirSync(join(tmp, 'bizar-dash', 'src', 'server'), { recursive: true });
  mkdirSync(join(tmp, 'templates'), { recursive: true });
  // Symlink progress-parser.mjs
  try {
    const realParser = PROGRESS_PARSER;
    if (existsSync(realParser)) {
      const content = readFileSync(realParser, 'utf8');
      writeFileSync(join(tmp, 'bizar-dash', 'src', 'server', 'progress-parser.mjs'), content, 'utf8');
    }
  } catch {
    // ignore — test will skip
  }
  // Copy template
  try {
    const realTemplate = SPRINT_TEMPLATE;
    if (existsSync(realTemplate)) {
      const content = readFileSync(realTemplate, 'utf8');
      writeFileSync(join(tmp, 'templates', 'sprint-contract.md'), content, 'utf8');
    }
  } catch {
    // ignore
  }
  return tmp;
}

// ── Parser test ───────────────────────────────────────────────────────────────

test('progress-parser correctly extracts id, title, status, keyResults from PROGRESS.md', async () => {
  if (!existsSync(PROGRESS_PARSER)) {
    console.warn('progress-parser.mjs not found — skipping parser test');
    return;
  }
  const { parseProgress } = await import(PROGRESS_PARSER);

  const sample = `
# Current State
## F-099 — My Feature Title
Owner: thor · Due: 2026-07-31
Goal is **active**.

Key results:
- [ ] KR1: First result
- [x] KR2: Second result

## Next Steps
## F-100 — Another Goal
Goal is **done**.
`;

  const result = parseProgress(sample);
  const goal = result.goals.find((g) => g.id === 'F-099');
  assert.ok(goal, 'F-099 should be found');
  assert.equal(goal.title, 'My Feature Title');
  assert.equal(goal.status, 'active');
  assert.equal(goal.keyResults.length, 2);
  assert.equal(goal.keyResults[0].title, 'KR1: First result');
  assert.equal(goal.keyResults[0].done, false);
  assert.equal(goal.keyResults[1].title, 'KR2: Second result');
  assert.equal(goal.keyResults[1].done, true);
});

// ── Fill test ────────────────────────────────────────────────────────────────

test('sprint.mjs writes a file with pre-filled Scope (in) from goal key results', () => {
  const tmp = makeTempProject();

  // Write a progress file with a goal that has KRs
  const progress = `
## F-099 — My Feature
Owner: thor · Due: 2026-07-31
Goal is **active**.

Key results:
- [ ] Pending KR
- [x] Done KR
`;
  writeFileSync(join(tmp, '.bizar', 'PROGRESS.md'), progress, 'utf8');

  try {
    const r = runSprintScript('F-099', tmp);
    assert.equal(r.exitCode, 0, `sprint.mjs should exit 0: ${r.stdout}\n${r.stderr}`);
    const destPath = join(tmp, '.bizar', 'sprints', 'F-099-' + new Date().toISOString().slice(0, 10) + '.md');
    assert.ok(
      existsSync(destPath),
      `Sprint file should exist at ${destPath}. stdout: ${r.stdout}`
    );
    const content = readFileSync(destPath, 'utf8');
    assert.ok(content.includes('F-099'), 'Should include feature ID');
    assert.ok(content.includes('My Feature'), 'Should include title');
    assert.ok(content.includes('Pending KR'), 'Should include pending KR');
    assert.ok(content.includes('Done KR'), 'Should include done KR');
    assert.ok(content.includes('[x]'), 'Should have checked items');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Missing-goal tolerance ───────────────────────────────────────────────────

test('sprint.mjs exits non-zero and prints a clear error when goal not found', () => {
  const tmp = makeTempProject();

  // Write a progress file with a different goal
  writeFileSync(join(tmp, '.bizar', 'PROGRESS.md'), '## F-001 — Something\nGoal is **done**.\n', 'utf8');

  try {
    const r = runSprintScript('F-999', tmp);
    assert.notEqual(r.exitCode, 0, 'Should exit non-zero for missing goal');
    assert.ok(
      r.stdout.includes('F-999') || r.stderr.includes('F-999') || r.stdout.includes('not found'),
      `Error should mention the goal id: ${r.stdout} ${r.stderr}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sprint.mjs exits non-zero when PROGRESS.md is missing', () => {
  const tmp = makeTempProject();
  // Do NOT write PROGRESS.md
  try {
    const r = runSprintScript('F-001', tmp);
    assert.notEqual(r.exitCode, 0, 'Should exit non-zero when PROGRESS.md missing');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
