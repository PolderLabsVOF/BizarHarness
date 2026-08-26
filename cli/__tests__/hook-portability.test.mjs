import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EVENT_CHAINS, executeHook, selectEventChain } from '../commands/hook.mjs';
import {
  isBizarManagedModelRouter,
  mergeBizarHooks,
  normalizePermissionLists,
} from '../provision.mjs';

test('portable hook dispatcher resolves package assets from an unrelated cwd', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bizar-hook-cwd-'));
  try {
    const input = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      prompt: '/ralplan review this',
      cwd,
    });
    const result = executeHook('keyword-router', input, { cwd });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /skill "ralplan"/);
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
  const hookRoot = '/tmp/injected-bizar-hooks';
  const failed = executeHook('pre-tool-use', JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
  }), {
    hookRoot,
    executor({ name, path }) {
      assert.equal(name, 'agent-model-guard');
      assert.match(path, /^\/tmp\/injected-bizar-hooks\//);
      return { status: 1, stdout: '', stderr: 'simulated crash' };
    },
  });
  assert.equal(failed.status, 0);
  const denied = JSON.parse(failed.stdout);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /failed/i);

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
    'pretooluse-bash', 'git-workflow-guard',
  ]);
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Edit' })), [
    'pretooluse-editwrite', 'path-ownership-guard',
  ]);
  assert.deepEqual(selectEventChain('pre-tool-use', JSON.stringify({ tool_name: 'Read' })), []);
  assert.deepEqual(selectEventChain('post-tool-use', JSON.stringify({ tool_name: 'Bash' })), ['auto-instinct']);
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'greg' })), ['agent-grounding']);
  assert.deepEqual(selectEventChain('subagent-start', JSON.stringify({ agent_type: 'karen' })), [
    'agent-grounding', 'advisor-context', 'worktree-bootstrap',
  ]);
  assert.deepEqual(selectEventChain('subagent-stop', JSON.stringify({ agent_type: 'karen' })), [
    'verify-deliverables',
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

test('model router ownership recognizes Bizar v1/v2 but not user routers', () => {
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://bizar.dev/schema/model-router.v1.json' }), true);
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://bizar.dev/schema/model-router.v2.json' }), true);
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://example.test/model-router.json' }), false);
  assert.equal(isBizarManagedModelRouter({ version: 1 }), false);
});

test('ownership merge removes stale Bizar hooks while preserving foreign handlers', () => {
  const foreign = { type: 'command', command: 'node /opt/foreign/hook.mjs', timeout: 9 };
  const existing = {
    UserPromptSubmit: [{ hooks: [
      foreign,
      { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/thinking-route.mjs"' },
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
