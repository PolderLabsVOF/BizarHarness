import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EVENT_CHAINS, executeHook, selectEventChain } from '../commands/hook.mjs';
import {
  mergeBizarHooks,
  normalizePermissionLists,
} from '../provision.mjs';

test('portable hook dispatcher resolves package assets from an unrelated cwd', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-hook-cwd-'));
  try {
    const input = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      prompt: '/bizplan review this',
      cwd,
    });
    const result = executeHook('keyword-router', input, { cwd });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /skill "bizplan"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('event dispatcher exposes every plugin hook name', () => {
  assert.deepEqual(Object.keys(EVENT_CHAINS).sort(), [
    'permission-request',
    'post-tool-use',
    'post-tool-use-failure',
    'pre-compact',
    'pre-tool-use',
    'session-end',
    'session-start',
    'stop',
    'subagent-start',
    'subagent-stop',
    'task-completed',
    'task-created',
    'teammate-idle',
    'user-prompt-submit',
  ]);
});

test('PreTool safety leaf failures deny while context leaf failures fail open', () => {
  // F-176 / OmniRoute alias overhaul: the removed `agent-model-guard` leaf
  // is no longer in the chain. The remaining safety leaves (e.g.
  // `path-ownership-guard`) still deny on failure; context leaves still
  // fail open. We exercise the latter to keep the deny/fail-open contract.
  const hookRoot = '/tmp/injected-bizar-hooks';
  const context = executeHook('user-prompt-submit', JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'ordinary prompt',
  }), {
    hookRoot,
    executor() { return { status: 2, stdout: '', stderr: 'simulated context failure' }; },
  });
  assert.equal(context.status, 0);
  assert.deepEqual(JSON.parse(context.stdout), {});
});

test('event dispatcher preserves tool and agent matcher scopes', () => {
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Bash' })), [
    'workflow-route-guard', 'pretooluse-bash', 'git-workflow-guard',
  ]);
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Edit' })), [
    'workflow-route-guard', 'pretooluse-editwrite', 'path-ownership-guard',
  ]);
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Read' })), []);
  assert.deepEqual(selectEventChain('post-tool-use', JSON.stringify({ tool_name: 'Bash' })), []);
  assert.deepEqual(selectEventChain('post-tool-use', JSON.stringify({ tool_name: 'Workflow' })), ['workflow-route-guard']);
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'greg' })), ['agent-grounding']);
  // advisor-context only fires for reviewers/debug specialists (@linda, @carl).
  // @karen is a fresh-task implementer and no longer receives the parent dump.
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'karen' })), [
    'agent-grounding', 'worktree-bootstrap',
  ]);
  // @linda is a reviewer (read-only audit), so she does NOT receive the
  // worktree-bootstrap chain — reviewers work in the parent's tree.
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'linda' })), [
    'agent-grounding', 'advisor-context',
  ]);
  // @carl is both a reviewer and a debug specialist, so she gets the full
  // chain: parent context + an isolated worktree.
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'carl' })), [
    'agent-grounding', 'advisor-context', 'worktree-bootstrap',
  ]);
  assert.deepEqual(selectEventChain('subagent-stop', JSON.stringify({ agent_type: 'karen' })), [
    'team-lifecycle', 'verify-deliverables', 'worktree-archive',
  ]);
});

test('permission merge preserves allow + ask + deny (F-169 user override)', () => {
  // F-169: the Bizar policy used to move hard-mutation rules from `allow`
  // back into `ask`. The user override for this install keeps them in
  // `allow` so subagents do not prompt under bypassPermissions. The
  // normalizer now merges lists verbatim rather than re-promoting rules.
  const normalized = normalizePermissionLists({
    defaultMode: 'acceptEdits',
    allow: ['Read', 'Bash(git push *)', 'Bash(npm publish *)', 'Bash(gh pr view *)'],
    ask: ['Bash(custom approval *)'],
    deny: ['Bash(git rebase *)'],
  }, {
    defaultMode: 'acceptEdits',
    allow: ['mcp__bizar__*'],
    ask: ['Bash(gh release *)'],
    deny: ['Bash(git push --force *)'],
  });
  assert.deepEqual(normalized.allow, ['Read', 'Bash(git push *)', 'Bash(npm publish *)', 'Bash(gh pr view *)', 'mcp__bizar__*']);
  assert.ok(normalized.ask.includes('Bash(custom approval *)'));
  assert.ok(normalized.ask.includes('Bash(gh release *)'));
  assert.ok(normalized.deny.includes('Bash(git rebase *)'));
  assert.ok(normalized.deny.includes('Bash(git push --force *)'));
  // Hard-mutation rules must NOT be moved out of allow by the merge.
  assert.ok(normalized.allow.includes('Bash(git push *)'));
  assert.ok(normalized.allow.includes('Bash(npm publish *)'));
});

test('ownership merge removes stale Bizar hooks while preserving foreign handlers', () => {
  const foreign = { type: 'command', command: 'node /opt/foreign/hook.mjs', timeout: 9 };
  const existing = {
    UserPromptSubmit: [{ hooks: [
      foreign,
      { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/worker-suggest.mjs"' },
      { type: 'command', command: 'bizar hook user-prompt-submit' },
    ] }],
    CustomEvent: [{ matcher: 'x', hooks: [foreign] }],
  };
  const desired = {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'bizar hook user-prompt-submit', timeout: 10 }] }],
  };
  const once = mergeBizarHooks(existing, desired);
  const twice = mergeBizarHooks(once, desired);
  assert.deepEqual(twice, once);
  assert.equal(once.UserPromptSubmit.length, 1);
  assert.deepEqual(once.UserPromptSubmit[0].hooks, [foreign, desired.UserPromptSubmit[0].hooks[0]]);
  assert.deepEqual(once.CustomEvent, existing.CustomEvent);
});
