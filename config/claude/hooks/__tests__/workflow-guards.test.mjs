import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TaskLedger } from '../../../../cli/task-ledger.mjs';

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
    for (const command of [
      'git push --force-with-lease origin feature',
      'git -C . push -f origin feature',
      'git --git-dir=.git rebase main',
    ]) {
      const result = runHook('git-workflow-guard.mjs', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
      });
      assert.equal(decision(result), 'deny', command);
    }
  });

  test('denies guarded Git actions hidden behind shell indirection', () => {
    for (const command of [
      '$(printf git) commit -m "fix: hidden"',
      'G=git; $G commit -m "fix: hidden"',
      'eval "git push origin main"',
      'sh -c "git rebase main"',
      'bash -c "git commit -m \'fix: hidden\'"',
    ]) {
      const result = runHook('git-workflow-guard.mjs', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
      });
      assert.equal(decision(result), 'deny', command);
      assert.match(result.hookSpecificOutput.permissionDecisionReason, /indirection/i);
    }
  });

  test('warns on unsupported commit subjects and asks for both (F-145)', () => {
    const invalid = runHook('git-workflow-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m \"misc: vague\"' },
    });
    assert.equal(decision(invalid), 'ask');
    assert.match(String(invalid.hookSpecificOutput?.additionalContext || ''), /Conventional commit/i);

    const valid = runHook('git-workflow-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m \"fix: preserve approval boundary\"' },
    });
    assert.equal(decision(valid), 'ask');

    for (const command of [
      '"git" commit -m "fix: quoted git"',
      '"/usr/bin/git" commit -m "fix: absolute git"',
      'git -p commit -m "fix: paginate short"',
      'git --paginate commit -m "fix: paginate long"',
      'git --no-replace-objects commit -m "fix: replacement guard"',
    ]) {
      const guarded = runHook('git-workflow-guard.mjs', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
      });
      assert.equal(decision(guarded), 'ask', command);
    }
  });

  test('asks before pushes, pull-request publication, and package publication', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bizar-publish-'));
    roots.push(cwd);
    for (const command of [
      'git push origin feature',
      'git -C . push origin feature',
      'gh pr create --title \"fix\" --body \"tests pass\"',
      'gh --repo owner/repo pr review 42 --approve',
      'gh release edit v1.0.0 --notes updated',
      'npm publish --access public',
      'bun publish',
      'npx wrangler versions deploy',
      'vercel --prod',
    ]) {
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

test('SubagentStop verifier requires evidence and honors completed task claims', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-subagent-stop-'));
  roots.push(root);
  const dbPath = join(root, 'tasks.sqlite');

  const missing = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    agent_id: 'agent-1',
    cwd: root,
    last_assistant_message: '',
  });
  assert.equal(missing.decision, 'block');

  const generic = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    agent_id: 'agent-1',
    cwd: root,
    last_assistant_message: 'Implemented src/example.ts and verified the focused tests pass.',
  });
  assert.equal(generic.decision, 'block');

  const successTranscript = join(root, 'success.jsonl');
  writeFileSync(successTranscript, [
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'edit-1', name: 'Edit', input: { file_path: 'src/example.ts', old_string: 'a', new_string: 'b' } },
    ] } }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'make check' } },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'bash-1', is_error: false, content: 'Process exited with code 0. All tests passed.' },
    ] } }),
  ].join('\n'));
  const evidenced = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    agent_id: 'agent-1',
    cwd: root,
    agent_transcript_path: successTranscript,
    last_assistant_message: 'Work is complete.',
  });
  assert.deepEqual(evidenced, {});

  const staleTranscript = join(root, 'stale.jsonl');
  writeFileSync(staleTranscript, [
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'bash-stale', name: 'Bash', input: { command: 'make check' } },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'bash-stale', is_error: false, content: 'Process exited with code 0. All tests passed.' },
    ] } }),
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'edit-stale', name: 'Edit', input: { file_path: 'src/after-check.ts', old_string: 'a', new_string: 'b' } },
    ] } }),
  ].join('\n'));
  const staleEvidence = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    cwd: root,
    agent_transcript_path: staleTranscript,
    last_assistant_message: 'Work is complete.',
  });
  assert.equal(staleEvidence.decision, 'block');

  const failureTranscript = join(root, 'failure.jsonl');
  writeFileSync(failureTranscript, [
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'edit-2', name: 'Write', input: { file_path: 'src/failure.ts', content: 'x' } },
      { type: 'tool_use', id: 'bash-2', name: 'Bash', input: { command: 'make check' } },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'bash-2', is_error: true, content: 'Process exited with code 1. Tests failed.' },
    ] } }),
  ].join('\n'));
  const failedEvidence = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    cwd: root,
    agent_transcript_path: failureTranscript,
    last_assistant_message: 'Everything passed.',
  });
  assert.equal(failedEvidence.decision, 'block');

  const noPathTranscript = join(root, 'no-path.jsonl');
  writeFileSync(noPathTranscript, [
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'bash-3', name: 'Bash', input: { command: 'make check' } },
    ] } }),
    JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'bash-3', is_error: false, content: 'Process exited with code 0. All tests passed.' },
    ] } }),
  ].join('\n'));
  const missingPathEvidence = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    cwd: root,
    agent_transcript_path: noPathTranscript,
    last_assistant_message: 'Everything is complete.',
  });
  assert.equal(missingPathEvidence.decision, 'block');

  const malformedTranscript = join(root, 'malformed.jsonl');
  writeFileSync(malformedTranscript, '{not-json\n');
  for (const transcript of [join(root, 'missing.jsonl'), malformedTranscript]) {
    const unverified = runHook('verify-deliverables.mjs', {
      hook_event_name: 'SubagentStop',
      agent_type: 'senior-engineer',
      cwd: root,
      agent_transcript_path: transcript,
      last_assistant_message: 'Changed `src/example.ts`; all checks passed.',
    });
    assert.equal(unverified.decision, 'block');
  }

  const ledger = new TaskLedger({ dbPath });
  ledger.createTask({ id: 'task-1', title: 'deliver', scopes: ['src/example.ts'] });
  ledger.claimTask({ taskId: 'task-1', owner: 'agent-1', workspace: root });
  ledger.completeTask({ taskId: 'task-1', owner: 'agent-1', evidence: 'targeted test passed' });
  ledger.close();
  const claimed = runHook('verify-deliverables.mjs', {
    hook_event_name: 'SubagentStop',
    agent_type: 'senior-engineer',
    agent_id: 'agent-1',
    task_id: 'task-1',
    cwd: root,
    last_assistant_message: 'Work is complete.',
  }, { BIZAR_TASK_DB: dbPath });
  assert.deepEqual(claimed, {});

  const malformed = spawnSync('node', [join(hooksDir, 'verify-deliverables.mjs')], {
    input: '{not-json',
    encoding: 'utf8',
  });
  assert.equal(malformed.status, 0);
  assert.deepEqual(JSON.parse(malformed.stdout), {});
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

test('simplify marker freshness window allows successive commits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bizar-simplify-'));
  roots.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });

  runHook('simplify-guard.mjs', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    cwd: repo,
    tool_input: { skill: 'simplify' },
  });
  const mark = JSON.parse(readFileSync(join(repo, '.git', 'bizar-simplify.ok'), 'utf8'));
  const tree = spawnSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  assert.equal(typeof mark.timestamp, 'number');
  assert.equal(mark.fingerprint, tree);

  const first = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m "test: gate"' },
  });
  assert.deepEqual(first, {});

  const second = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m "test: gate again"' },
  });
  assert.deepEqual(second, {});

  for (const command of [
    'git -C . commit -m "test: global cwd"',
    'git --git-dir=.git commit -m "test: global git dir"',
  ]) {
    const globalCommit = runHook('simplify-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      cwd: repo,
      tool_input: { command },
    });
    assert.deepEqual(globalCommit, {}, command);
  }
});

test('simplify marker blocks a commit after the staged tree changes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bizar-simplify-'));
  roots.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'change.txt'), 'reviewed\n');
  spawnSync('git', ['add', 'change.txt'], { cwd: repo });

  runHook('simplify-guard.mjs', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    cwd: repo,
    tool_input: { skill: 'simplify' },
  });
  writeFileSync(join(repo, 'change.txt'), 'changed after review\n');
  spawnSync('git', ['add', 'change.txt'], { cwd: repo });

  const changed = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m "test: changed tree"' },
  });
  assert.equal(decision(changed), 'deny');

  runHook('simplify-guard.mjs', {
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    cwd: repo,
    tool_input: { skill: 'simplify' },
  });
  const reviewedAgain = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m "test: reviewed changed tree"' },
  });
  assert.deepEqual(reviewedAgain, {});
});

test('simplify marker outside freshness window blocks commit', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bizar-simplify-'));
  roots.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });

  const mark = join(repo, '.git', 'bizar-simplify.ok');
  const fingerprint = spawnSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  writeFileSync(mark, JSON.stringify({ timestamp: Date.now() - 5 * 60 * 60 * 1000, fingerprint }));

  const result = runHook('simplify-guard.mjs', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    cwd: repo,
    tool_input: { command: 'git commit -m "test: stale"' },
  });
  assert.equal(decision(result), 'deny');
});

test('simplify marker absent blocks commits including Git global-option forms', () => {
  const repo = mkdtempSync(join(tmpdir(), 'bizar-simplify-'));
  roots.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });

  for (const command of [
    'git commit -m "test: no marker"',
    '"git" commit -m "test: no marker"',
    '"/usr/bin/git" commit -m "test: no marker"',
    'git -p commit -m "test: no marker"',
    'git --paginate commit -m "test: no marker"',
    'git --no-replace-objects commit -m "test: no marker"',
    'git -C . commit -m "test: no marker"',
    'git --git-dir=.git commit -m "test: no marker"',
  ]) {
    const result = runHook('simplify-guard.mjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      cwd: repo,
      tool_input: { command },
    });
    assert.equal(decision(result), 'deny', command);
  }
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
  assert.equal(settings.permissions.defaultMode, 'bypassPermissions');
  assert.equal(settings.enableWorkflows, true);
  assert.equal(settings.disableAutoCompact, true);
  assert.ok(settings.hooks.PreCompact);
  assert.ok(settings.hooks.SubagentStart);
  assert.ok(settings.hooks.SubagentStop);
  // Local git commit is always allowed silently (see AGENTS.md "Autonomy and parallelism").
  const commitFamily = /Bash\((?:git commit \*|git -C \* commit \*|git --git-dir=\* commit \*)\)/;
  assert.equal(settings.permissions.allow.some((rule) => commitFamily.test(rule)), true);
  const hardMutation = /Bash\((?:git push|gh (?:pr|release)|(?:npm|bun|pnpm) publish|(?:vercel|wrangler|flyctl) deploy)/;
  assert.equal(settings.permissions.allow.some((rule) => hardMutation.test(rule)), false);
  assert.equal(settings.permissions.ask.some((rule) => hardMutation.test(rule)), true);
  const commands = JSON.stringify(settings.hooks);
  // F-169: bare `bizar hook <sub>` invocations are forbidden because
  // Claude Code strips PATH under /bin/sh. The shipped template must
  // route every hook through the wrapper shim or its inline sh -c
  // probe — never a bare `bizar hook` invocation.
  assert.equal(/bizar hook [a-z0-9-]+/.test(commands), false, 'bare `bizar hook <sub>` is forbidden');
  assert.match(commands, /sh -c|bizar-hook-wrapper\.sh/);
  assert.doesNotMatch(commands, /\$CLAUDE_PROJECT_DIR/);
  assert.doesNotMatch(commands, /\/home\/drb0rk\/projects\/BizarHarness/);
});
