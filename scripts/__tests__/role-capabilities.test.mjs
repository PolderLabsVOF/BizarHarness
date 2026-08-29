/**
 * scripts/__tests__/role-capabilities.test.mjs
 *
 * Drift guard + behavior tests for the audit #81 capability-segregated
 * authority extension to `config/claude/hooks/permission-request.mjs`.
 *
 *   1. The Tier-4 destructive floor is preserved verbatim from F-176.
 *      `git push --force`, `git rebase`, `rm -rf /`, `mkfs`, `shutdown`,
 *      etc. are still denied for EVERY role.
 *   2. `worker` (the default) has no additional restrictions beyond
 *      Tier 4 — Edit/Write/Bash all flow through.
 *   3. `verifier` cannot use Edit/Write/MultiEdit/NotebookEdit or run
 *      write-shape Bash commands (rm/mv/cp, sed -i, tee, git commit,
 *      git push, gh pr create, npm publish, etc.).
 *   4. `research` cannot use Edit/Write or run git mutations or
 *      write-shape Bash commands.
 *   5. `planner` may write only under `.bizar/` and may not run git
 *      mutations.
 *   6. `integrator` may write ONLY for paths listed in
 *      `BIZAR_INTEGRATION_PATHS`. An empty path list refuses all
 *      writes.
 *   7. `operator` bypasses all role restrictions (escape hatch).
 *   8. The hook reads `BIZAR_AGENT_ROLE` and `BIZAR_INTEGRATION_PATHS`
 *      from `process.env` (the env contract).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'config', 'claude', 'hooks', 'permission-request.mjs',
);

function runHook({ toolName, toolInput, env = {} }) {
  const payload = JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput,
  });
  const result = spawnSync('node', [HOOK_PATH], {
    input: payload,
    env: { ...process.env, ...env, BIZAR_AGENT_ROLE: env.BIZAR_AGENT_ROLE ?? 'worker' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.status !== 0 && result.stdout.trim() !== '{}') {
    // Non-zero exit with non-empty stdout is a hook bug. Surface stderr.
    if (result.stderr) {
      throw new Error(`hook exit ${result.status}: ${result.stderr}`);
    }
  }
  const out = result.stdout.trim();
  if (out === '') return { decision: null };
  return JSON.parse(out);
}

describe('permission-request.mjs — role capabilities (audit #81)', () => {
  let originalRole;
  let originalIntegrationPaths;

  before(() => {
    originalRole = process.env.BIZAR_AGENT_ROLE;
    originalIntegrationPaths = process.env.BIZAR_INTEGRATION_PATHS;
  });

  after(() => {
    if (originalRole === undefined) delete process.env.BIZAR_AGENT_ROLE;
    else process.env.BIZAR_AGENT_ROLE = originalRole;
    if (originalIntegrationPaths === undefined) delete process.env.BIZAR_INTEGRATION_PATHS;
    else process.env.BIZAR_INTEGRATION_PATHS = originalIntegrationPaths;
  });

  beforeEach(() => {
    delete process.env.BIZAR_AGENT_ROLE;
    delete process.env.BIZAR_INTEGRATION_PATHS;
  });

  it('Tier-4 floor survives: worker cannot force-push, rebase, or rm-rf /', () => {
    const denyForce = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git push --force origin master' },
    });
    assert.equal(denyForce.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(denyForce.hookSpecificOutput.decision.message, /force-push/);

    const denyRebase = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git rebase -i HEAD~3' },
    });
    assert.equal(denyRebase.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(denyRebase.hookSpecificOutput.decision.message, /rebase/);

    const denyRm = runHook({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf / --no-preserve-root' },
    });
    assert.equal(denyRm.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(denyRm.hookSpecificOutput.decision.message, /recursive deletion/);

    const denyMkfs = runHook({
      toolName: 'Bash',
      toolInput: { command: 'mkfs.ext4 /dev/sda1' },
    });
    assert.equal(denyMkfs.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(denyMkfs.hookSpecificOutput.decision.message, /system-destructive/);
  });

  it('worker (default) is unaffected by role layer — Edit/Write pass', () => {
    delete process.env.BIZAR_AGENT_ROLE;
    const edit = runHook({
      toolName: 'Edit',
      toolInput: { file_path: 'src/foo.ts' },
    });
    assert.equal(edit.decision ?? null, null,
      'worker Edit must not be denied by the role layer');
    const bash = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git commit -m "feat: x"' },
    });
    assert.equal(bash.decision ?? null, null);
  });

  it('verifier cannot Edit / Write / MultiEdit / NotebookEdit', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const out = runHook({
        toolName: tool,
        toolInput: { file_path: 'README.md' },
        env: { BIZAR_AGENT_ROLE: 'verifier' },
      });
      assert.equal(out.hookSpecificOutput.decision.behavior, 'deny',
        `${tool} must be denied for verifier`);
      assert.match(out.hookSpecificOutput.decision.message, /verifier role may not use/);
    }
  });

  it('verifier cannot run write-shape Bash commands', () => {
    for (const cmd of [
      'git commit -m "x"',
      'git push origin master',
      'rm -rf node_modules',
      'sed -i "s/a/b/" file.txt',
      'curl -X POST https://api.example.com',
      'npm publish --access public',
      'vercel deploy --prod',
      'gh pr create --base master',
    ]) {
      const out = runHook({
        toolName: 'Bash',
        toolInput: { command: cmd },
        env: { BIZAR_AGENT_ROLE: 'verifier' },
      });
      assert.equal(out.hookSpecificOutput.decision.behavior, 'deny',
        `verifier must be denied: ${cmd}`);
      assert.match(out.hookSpecificOutput.decision.message, /verifier role/);
    }
  });

  it('verifier may run read-only Bash commands', () => {
    for (const cmd of [
      'cat README.md',
      'git log --oneline -n 10',
      'git status',
      'ls -la',
      'grep -r "foo" src/',
      'npm test',
    ]) {
      const out = runHook({
        toolName: 'Bash',
        toolInput: { command: cmd },
        env: { BIZAR_AGENT_ROLE: 'verifier' },
      });
      assert.equal(out.decision ?? null, null,
        `verifier must NOT be denied read-only: ${cmd}`);
    }
  });

  it('research role cannot Edit / Write / MultiEdit / NotebookEdit', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const out = runHook({
        toolName: tool,
        toolInput: { file_path: 'README.md' },
        env: { BIZAR_AGENT_ROLE: 'research' },
      });
      assert.equal(out.hookSpecificOutput.decision.behavior, 'deny',
        `${tool} must be denied for research`);
    }
  });

  it('research role cannot run git mutations', () => {
    for (const cmd of [
      'git commit -m "x"',
      'git push origin master',
      'git rebase -i HEAD',
      'git reset --hard HEAD',
      'git checkout -- file.txt',
    ]) {
      const out = runHook({
        toolName: 'Bash',
        toolInput: { command: cmd },
        env: { BIZAR_AGENT_ROLE: 'research' },
      });
      assert.equal(out.hookSpecificOutput.decision.behavior, 'deny',
        `research must be denied: ${cmd}`);
    }
  });

  it('planner may write under .bizar/ but not elsewhere', () => {
    const allowed = runHook({
      toolName: 'Write',
      toolInput: { file_path: '.bizar/sprints/F-200.md' },
      env: { BIZAR_AGENT_ROLE: 'planner' },
    });
    assert.equal(allowed.decision ?? null, null);
    const blocked = runHook({
      toolName: 'Write',
      toolInput: { file_path: 'src/foo.ts' },
      env: { BIZAR_AGENT_ROLE: 'planner' },
    });
    assert.equal(blocked.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(blocked.hookSpecificOutput.decision.message, /planner role may only write under \.bizar\//);
  });

  it('integrator may write ONLY for paths in BIZAR_INTEGRATION_PATHS', () => {
    const allowed = runHook({
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/integration/queue/1.ts' },
      env: {
        BIZAR_AGENT_ROLE: 'integrator',
        BIZAR_INTEGRATION_PATHS: '/tmp/integration/queue\n/tmp/integration/manifests',
      },
    });
    assert.equal(allowed.decision ?? null, null);

    const blocked = runHook({
      toolName: 'Edit',
      toolInput: { file_path: '/etc/passwd' },
      env: {
        BIZAR_AGENT_ROLE: 'integrator',
        BIZAR_INTEGRATION_PATHS: '/tmp/integration/queue',
      },
    });
    assert.equal(blocked.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(blocked.hookSpecificOutput.decision.message, /integrator role may only write paths/);

    // Empty path list refuses everything.
    const emptyBlocked = runHook({
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/integration/queue/1.ts' },
      env: { BIZAR_AGENT_ROLE: 'integrator', BIZAR_INTEGRATION_PATHS: '' },
    });
    assert.equal(emptyBlocked.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(emptyBlocked.hookSpecificOutput.decision.message, /empty BIZAR_INTEGRATION_PATHS/);
  });

  it('integrator may run git push (Tier-4 floor does not apply to non-force pushes)', () => {
    const out = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git push origin feature-branch' },
      env: {
        BIZAR_AGENT_ROLE: 'integrator',
        BIZAR_INTEGRATION_PATHS: '/tmp/integration/queue',
      },
    });
    assert.equal(out.decision ?? null, null,
      'integrator must be allowed to push non-force git pushes');
    // Tier-4 still applies for --force.
    const force = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git push --force origin feature-branch' },
      env: {
        BIZAR_AGENT_ROLE: 'integrator',
        BIZAR_INTEGRATION_PATHS: '/tmp/integration/queue',
      },
    });
    assert.equal(force.hookSpecificOutput.decision.behavior, 'deny');
  });

  it('operator bypasses role layer (still blocked by Tier-4)', () => {
    const edit = runHook({
      toolName: 'Edit',
      toolInput: { file_path: 'src/foo.ts' },
      env: { BIZAR_AGENT_ROLE: 'operator' },
    });
    assert.equal(edit.decision ?? null, null, 'operator Edit must pass');
    // Tier-4 still trips.
    const force = runHook({
      toolName: 'Bash',
      toolInput: { command: 'git push --force origin master' },
      env: { BIZAR_AGENT_ROLE: 'operator' },
    });
    assert.equal(force.hookSpecificOutput.decision.behavior, 'deny');
  });

  it('hook source still preserves the F-176 Tier-4 regex tokens', () => {
    // This is the audit's "the existing autonomy contract test must
    // still pass" guarantee — see scripts/__tests__/autonomy-contract.test.mjs.
    const src = readFileSync(HOOK_PATH, 'utf8');
    for (const token of [
      'git\\s+push',
      '--force',
      'git\\s+rebase',
      'rm\\s+-',
      'mkfs|shutdown|halt|poweroff|reboot',
    ]) {
      assert.ok(src.includes(token), `Tier-4 regex token must remain: ${token}`);
    }
    assert.match(src, /behavior:\s*['"]deny['"]/);
  });
});
