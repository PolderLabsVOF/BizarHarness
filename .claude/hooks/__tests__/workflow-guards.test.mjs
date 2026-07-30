import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const hooksDir = join(import.meta.dirname, '..');
const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function runHook(name, input, env = {}) {
  const result = spawnSync('node', [join(hooksDir, name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function decision(result) {
  return result.hookSpecificOutput?.permissionDecision;
}

describe('Git and publication guard', () => {
  test('denies history rewriting', () => {
    const result = runHook('git-workflow-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push --force-with-lease origin feature' },
    });
    assert.equal(decision(result), 'deny');
  });

  test('denies unsupported commit subjects and asks for valid commits', () => {
    const invalid = runHook('git-workflow-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m \"misc: vague\"' },
    });
    assert.equal(decision(invalid), 'deny');

    const valid = runHook('git-workflow-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m \"fix: preserve approval boundary\"' },
    });
    assert.equal(decision(valid), 'ask');
  });

  test('asks before pushes and pull-request publication', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bizar-publish-'));
    roots.push(cwd);
    for (const command of ['git push origin feature', 'gh pr create --title \"fix\" --body \"tests pass\"']) {
      const result = runHook('git-workflow-guard.mjs', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        cwd,
        tool_input: { command },
      });
      assert.equal(decision(result), 'ask');
    }
  });
});

describe('Danger and style guards', () => {
  test('safe Bash defers to Claude permissions instead of auto-approving', () => {
    const result = runHook('pretooluse-bash.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    assert.deepEqual(result, {});
  });

  test('human-facing filler is denied while source code is ignored', () => {
    const blocked = runHook('content-style-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/README.md', content: 'We leverage a seamless workflow.' },
    });
    assert.equal(decision(blocked), 'deny');

    const source = runHook('content-style-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/example.ts', content: 'const leverage = true;' },
    });
    assert.deepEqual(source, {});
  });
});

test('simplify marker is single-use per commit attempt', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bizar-simplify-'));
  roots.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });

  runHook('simplify-guard.mjs', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    cwd: repo,
    tool_input: { skill: 'simplify' },
  });
  const first = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m \"test: gate\"' },
  });
  assert.deepEqual(first, {});

  const second = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m \"test: gate again\"' },
  });
  assert.equal(decision(second), 'deny');
});

test('advisor hook injects bounded parent context', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-advisor-'));
  roots.push(root);
  const transcript = join(root, 'transcript.jsonl');
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'Find the root cause.' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'The failing test is exact.' }] } }),
  ].join('\n'));
  const result = runHook('advisor-context.mjs', {
    hook_event_name: 'SubagentStart',
    transcript_path: transcript,
  });
  assert.match(result.hookSpecificOutput.additionalContext, /Find the root cause/);
  assert.match(result.hookSpecificOutput.additionalContext, /failing test is exact/);
});

test('project settings wire portable guarded-autonomy hooks', () => {
  const settings = JSON.parse(readFileSync(join(hooksDir, '..', 'settings.json'), 'utf8'));
  assert.equal(settings.permissions.defaultMode, 'acceptEdits');
  assert.equal(settings.enableWorkflows, true);
  assert.ok(settings.hooks.PreCompact);
  assert.ok(settings.hooks.SubagentStart);
  const commands = JSON.stringify(settings.hooks);
  assert.match(commands, /\$CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(commands, /\/home\/drb0rk\/projects\/BizarHarness/);
});
