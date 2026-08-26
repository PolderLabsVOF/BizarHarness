import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const AGENTS_DIR = join(ROOT, 'config', 'claude', 'agents');
const SETTINGS = join(ROOT, 'config', 'claude', 'settings.json');
const WORKTREE_SETUP = join(ROOT, 'scripts', 'worktree-setup.sh');

const ISOLATED_EDITORS = [
  'brand-designer.md',
  'debug-specialist.md',
  'exec-assistant.md',
  'office-coordinator.md',
  'principal-engineer.md',
  'senior-engineer.md',
  'ui-designer.md',
];

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe('worktree-first agent policy', () => {
  test('every ordinary code-writing subagent declares worktree isolation', () => {
    for (const file of ISOLATED_EDITORS) {
      const source = readFileSync(join(AGENTS_DIR, file), 'utf8');
      assert.match(source, /^isolation:\s*worktree\s*$/m, file);
    }

    const integrator = readFileSync(join(AGENTS_DIR, 'it-lead.md'), 'utf8');
    assert.doesNotMatch(
      integrator,
      /^isolation:\s*worktree\s*$/m,
      'the integration owner must remain in the target checkout',
    );
  });

  test('project settings branch worktrees from HEAD and bootstrap isolated editors', async () => {
    const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
    assert.equal(settings.worktree?.baseRef, 'head');

    const subagentHooks = settings.hooks?.SubagentStart ?? [];
    // F-169: bare `bizar hook <sub>` invocations are forbidden. The
    // shipped template routes SubagentStart through either the wrapper
    // shim (absolute path or sh -c probe) — match the subagent-start
    // subcommand label regardless of the wrapper form shipped.
    assert.ok(
      subagentHooks.some((entry) => JSON.stringify(entry).includes('subagent-start')),
      'SubagentStart must use the portable Bizar dispatcher',
    );
    assert.equal(
      subagentHooks.some((entry) => /bizar hook [a-z0-9-]+/.test(JSON.stringify(entry))),
      false,
      'bare `bizar hook` invocations are forbidden in SubagentStart',
    );
    const { selectEventChain } = await import('../cli/commands/hook.mjs');

    for (const file of ISOLATED_EDITORS) {
      const source = readFileSync(join(AGENTS_DIR, file), 'utf8');
      const name = /^name:\s*(\S+)\s*$/m.exec(source)?.[1];
      assert.ok(name, `${file} must declare a name`);
      assert.ok(
        selectEventChain('subagent-start', JSON.stringify({ agent_type: name }))
          .includes('worktree-bootstrap'),
        `${name} must dispatch worktree-bootstrap`,
      );
    }
  });

  test('worktree bootstrap links dependencies from the main checkout', () => {
    const parent = mkdtempSync(join(tmpdir(), 'bizar-worktree-policy-'));
    roots.push(parent);
    const main = join(parent, 'main');
    const isolated = join(parent, 'isolated');
    mkdirSync(main);

    git(main, 'init', '-q');
    git(main, 'config', 'user.email', 'tests@bizar.local');
    git(main, 'config', 'user.name', 'Bizar Tests');
    writeFileSync(join(main, 'README.md'), '# fixture\n');
    git(main, 'add', 'README.md');
    git(main, 'commit', '-qm', 'test: seed worktree fixture');
    mkdirSync(join(main, 'node_modules'));
    writeFileSync(join(main, 'node_modules', '.fixture'), 'shared\n');
    git(main, 'worktree', 'add', '-q', '-b', 'isolated-test', isolated);

    const result = spawnSync('bash', [WORKTREE_SETUP, isolated], {
      cwd: main,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const linked = join(isolated, 'node_modules');
    assert.equal(lstatSync(linked).isSymbolicLink(), true);
    const target = resolve(dirname(linked), readlinkSync(linked));
    assert.equal(target, join(main, 'node_modules'));
    assert.notEqual(basename(target), basename(isolated));
  });
});
