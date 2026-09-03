#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/sessionstart-prime.test.mjs
 *
 * Unit tests for sessionstart-prime.mjs — the SessionStart hook that reads
 * PROGRESS.md + feature_list.json + git log + .bizar/PROJECT.md and emits a
 * structured briefing.
 *
 * Strategy: spawn the hook binary as a subprocess, feed it stdin JSON, and
 * assert on stdout JSON. This avoids drift between test and source — what
 * the binary emits IS what the tests check.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'sessionstart-prime.mjs');

function runHook(inputJson, cwd) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
    env: { ...process.env, BIZAR_HOME: join(cwd || process.cwd(), '.test-bizar-home') },
    timeout: 8000,
  });
  return {
    status: r.status,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
  };
}

function parseStdout(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

function additionalContext(stdout) {
  const obj = parseStdout(stdout);
  if (!obj) return '';
  return (obj.hookSpecificOutput && obj.hookSpecificOutput.additionalContext) || '';
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeProject({ withProgress = true, withFeatureList = true, withProject = true } = {}) {
  const dir = join(tmpdir(), `bh-prime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.bizar'), { recursive: true });
  if (withProject) {
    writeFileSync(
      join(dir, '.bizar', 'PROJECT.md'),
      '# TestProject\nA test fixture for the SessionStart hook.\n',
    );
  }
  if (withProgress) {
    writeFileSync(
      join(dir, 'PROGRESS.md'),
      [
        '# PROGRESS',
        '',
        '## Current State',
        '',
        'Branch: master | Last: 3b4f6f7 | Status: green',
        '',
        '## In Progress — F-099 hook overhaul',
        '',
        'Sprint S46: rewriting sessionstart-prime.mjs to read project state.',
        '',
        '## Done',
        '',
        '- F-098..F-102 shipped.',
      ].join('\n'),
    );
  }
  if (withFeatureList) {
    writeFileSync(
      join(dir, 'feature_list.json'),
      JSON.stringify({
        features: [
          { id: 'F-100', state: 'passing', behavior: 'old feature' },
          { id: 'F-101', state: 'passing', behavior: 'old feature 2' },
          { id: 'F-103', state: 'active', behavior: 'rewrite sessionstart-prime' },
        ],
      }),
    );
  }
  // Initialize a git repo so `git log` works.
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('SessionStart: startup source emits structured briefing', () => {
  const dir = makeProject();
  try {
    const { stdout, status } = runHook({ source: 'startup', cwd: dir });
    assert.equal(status, 0, `hook exit non-zero (stderr: see above)`);
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(startup\)/);
    assert.match(ctx, /A test fixture for the SessionStart hook/);
    assert.match(ctx, /Active feature: F-103/);
    assert.match(ctx, /rewrite sessionstart-prime/);
    assert.match(ctx, /WIP=1/);
    assert.match(ctx, /You are @mike/);
    assert.match(ctx, /External\/version-sensitive work requires current official docs via WebSearch\/WebFetch/);
    assert.match(ctx, /choose a single isolated worker, native workflow, parallel workers, or an Agent team/);
    assert.doesNotMatch(ctx, /Direct small known local fixes|direct work or bounded delegation/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: clear source is lighter (no feature list, no git reread)', () => {
  const dir = makeProject();
  try {
    const { stdout } = runHook({ source: 'clear', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(clear\)/);
    // clear branch doesn't include feature stats
    assert.doesNotMatch(ctx, /Active feature:/);
    // It DOES include PROGRESS.md current-state (last commit line + Progress: line)
    assert.match(ctx, /Progress:|Last commit:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: resume source reads session-state.json handoff', () => {
  const dir = makeProject();
  try {
    const handoff = {
      lastSessionId: 'prior-session-id',
      lastSessionEnd: '2026-07-22T15:00:00Z',
      reason: 'exit',
      activeFeature: 'F-103',
      nextStep: 'finish the briefing unit tests',
      filesTouched: ['/foo/bar.mjs'],
      blockers: ['Error: ENOENT'],
    };
    writeFileSync(join(dir, '.bizar', 'session-state.json'), JSON.stringify(handoff));
    const { stdout } = runHook({ source: 'resume', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(resume\)/);
    assert.match(ctx, /Last active feature: F-103/);
    assert.match(ctx, /finish the briefing unit tests/);
    assert.match(ctx, /Open blockers: Error: ENOENT/);
    assert.match(ctx, /WARNING: context may have been compacted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: resume with no session-state.json is graceful', () => {
  const dir = makeProject();
  try {
    const { stdout } = runHook({ source: 'resume', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(resume\)/);
    assert.match(ctx, /No prior session-state\.json found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: WIP>1 violation surfaces in briefing', () => {
  const dir = makeProject();
  try {
    writeFileSync(
      join(dir, 'feature_list.json'),
      JSON.stringify({
        features: [
          { id: 'F-A', state: 'active', behavior: 'one' },
          { id: 'F-B', state: 'active', behavior: 'two' },
          { id: 'F-C', state: 'passing', behavior: 'three' },
        ],
      }),
    );
    const { stdout } = runHook({ source: 'startup', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /WIP VIOLATION/);
    assert.match(ctx, /F-A/);
    assert.match(ctx, /F-B/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: zero active features surfaces "pick next"', () => {
  const dir = makeProject();
  try {
    writeFileSync(
      join(dir, 'feature_list.json'),
      JSON.stringify({
        features: [
          { id: 'F-100', state: 'passing', behavior: 'old' },
          { id: 'F-101', state: 'passing', behavior: 'old2' },
        ],
      }),
    );
    const { stdout } = runHook({ source: 'startup', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /2\/2 passing/);
    assert.match(ctx, /No active feature/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: missing PROGRESS.md is graceful', () => {
  const dir = makeProject({ withProgress: false });
  try {
    const { stdout, status } = runHook({ source: 'startup', cwd: dir });
    assert.equal(status, 0);
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(startup\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: missing feature_list.json is graceful', () => {
  const dir = makeProject({ withFeatureList: false });
  try {
    const { stdout, status } = runHook({ source: 'startup', cwd: dir });
    assert.equal(status, 0);
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(startup\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: missing .bizar/PROJECT.md is graceful', () => {
  const dir = makeProject({ withProject: false });
  try {
    const { stdout, status } = runHook({ source: 'startup', cwd: dir });
    assert.equal(status, 0);
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(startup\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: invalid JSON on stdin exits 0 with empty briefing', () => {
  const dir = makeProject();
  try {
    const r = spawnSync('node', [HOOK_PATH], {
      input: '{not valid json',
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, BIZAR_HOME: join(dir, '.test-bizar-home') },
      timeout: 8000,
    });
    assert.equal(r.status, 0);
    const obj = parseStdout(r.stdout);
    assert.ok(obj);
    assert.ok(obj.hookSpecificOutput);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: defaults source to startup when missing', () => {
  const dir = makeProject();
  try {
    const { stdout } = runHook({ cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /Bizar SessionStart \(startup\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: briefing is hard-capped at 800 characters', () => {
  const dir = makeProject();
  try {
    // Bloat each component individually so the composed briefing exceeds 800 chars.
    const giantProject = ['# BigProject', '', 'A '.repeat(200).trim(), ' that is the one-line summary.'].join('\n');
    writeFileSync(join(dir, '.bizar', 'PROJECT.md'), giantProject);
    const giantProgress = '## Current State\n\nBranch: master | ' + 'filler '.repeat(50) + '\n\n' +
      '## In Progress — F-099\n\n' + 'body '.repeat(200);
    writeFileSync(join(dir, 'PROGRESS.md'), giantProgress);
    const manyActive = Array.from({ length: 50 }, (_, i) => ({
      id: `F-${100 + i}`,
      state: 'passing',
      behavior: 'a passing feature with a long description that fills space',
    }));
    manyActive.push({ id: 'F-103', state: 'active', behavior: 'rewrite sessionstart-prime' });
    writeFileSync(join(dir, 'feature_list.json'), JSON.stringify({ features: manyActive }));
    // Make many commits to bloat `git log --oneline -10`.
    for (let i = 0; i < 12; i++) {
      spawnSync('git', ['commit', '--allow-empty', '-q', '-m', `commit ${'x'.repeat(60)} ${i}`], { cwd: dir });
    }
    const { stdout } = runHook({ source: 'startup', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.ok(ctx.length <= 800, `briefing is ${ctx.length} chars, cap is 800`);
    assert.match(ctx, /…$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionStart: project_summary reads first non-heading line', () => {
  const dir = makeProject();
  try {
    writeFileSync(
      join(dir, '.bizar', 'PROJECT.md'),
      '# MyProject\n\nThis is the one-line summary.\n\nOther stuff.\n',
    );
    const { stdout } = runHook({ source: 'startup', cwd: dir });
    const ctx = additionalContext(stdout);
    assert.match(ctx, /This is the one-line summary\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
