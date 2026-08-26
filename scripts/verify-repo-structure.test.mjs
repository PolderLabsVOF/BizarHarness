import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPackagePaths,
  inspectTrackedPaths,
  inspectVersionState,
  packageFilesFromPackReport,
} from './verify-repo-structure.mjs';

const CLEAN_PACKAGE = [
  'config/claude/hooks/pretooluse-bash.mjs',
  'config/claude/settings.json',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'cli/bin.mjs',
  'config/skills/bizar/SKILL.md',
  'hooks/hooks.json',
  'install.sh',
  'package.json',
  'packages/sdk/dist/index.js',
  'scripts/plugin-hook-runner.cjs',
  'scripts/install-hooks.sh',
];

test('tracked repository structure rejects retired roots and metadata', () => {
  assert.deepEqual(
    inspectTrackedPaths([
      'cli/bin.mjs',
      '${HOME}/leaked-state.json',
      '.config/bizar/hook.jsonl',
      'config/claude/hooks/post-merge-audit.sh',
      'config/claude/skills/find-skills',
      '.dockerignore',
      '.serena/project.yml',
      'bizar-plugins/registry.json',
      'fresh901/package.json',
      'packages/sdk/.harness/agents.json',
      'scripts/overnight-loop.mjs',
      'scripts/session-trace.sh',
      'skills-lock.json',
      'templates/eval-fixtures/basic.json',
      'templates/schedules/daily.json',
    ]),
    [
      '${HOME}/leaked-state.json',
      '.config/bizar/hook.jsonl',
      'config/claude/hooks/post-merge-audit.sh',
      'config/claude/skills/find-skills',
      '.dockerignore',
      '.serena/project.yml',
      'bizar-plugins/registry.json',
      'fresh901/package.json',
      'packages/sdk/.harness/agents.json',
      'scripts/overnight-loop.mjs',
      'scripts/session-trace.sh',
      'skills-lock.json',
      'templates/eval-fixtures/basic.json',
      'templates/schedules/daily.json',
    ],
  );
});

test('tracked repository structure accepts retained source roots', () => {
  assert.deepEqual(
    inspectTrackedPaths([
      '.claude/hooks/pretooluse-bash.mjs',
      'cli/bin.mjs',
      'config/skills/bizar/SKILL.md',
      'packages/sdk/src/index.ts',
    ]),
    [],
  );
});

test('package boundary accepts the runtime allowlist', () => {
  assert.deepEqual(inspectPackagePaths(CLEAN_PACKAGE), []);
});

test('package manifest accepts npm 11 arrays and npm 12 keyed objects', () => {
  const files = [{ path: 'package.json' }, { path: 'cli/bin.mjs' }];
  assert.deepEqual(packageFilesFromPackReport([{ files }]), ['package.json', 'cli/bin.mjs']);
  assert.deepEqual(
    packageFilesFromPackReport({ '@polderlabs/bizar': { files } }),
    ['package.json', 'cli/bin.mjs'],
  );
});

test('package boundary rejects tests, local state, duplicate skills, and missing runtime files', () => {
  const problems = inspectPackagePaths([
    ...CLEAN_PACKAGE.filter((path) => path !== 'packages/sdk/dist/index.js'),
    'config/claude/hooks/__tests__/guard.test.mjs',
    'config/claude/skills/bizar/SKILL.md',
    'config/skills/skillopt/SKILL.md.bak',
    'packages/sdk/${HOME}/.bizar_home/memory/session.md',
    'templates/schedules/daily.json',
  ]);

  assert.ok(problems.some((problem) => problem.includes('test file shipped')));
  assert.ok(problems.includes('backup or temporary file shipped: config/skills/skillopt/SKILL.md.bak'));
  assert.ok(problems.some((problem) => problem.includes('local or duplicate package path')));
  assert.ok(problems.includes('unexpected package root: templates'));
  assert.ok(
    problems.includes('required runtime file missing: packages/sdk/dist/index.js'),
  );
});

test('version state requires root and SDK parity', () => {
  assert.deepEqual(inspectVersionState('10.7.2', '10.7.2', '10.7.2'), []);
  assert.deepEqual(
    inspectVersionState('10.7.2', '10.6.0', '0.7.0-alpha.1'),
    [
      'SDK package version 10.6.0 != root 10.7.2',
      'SDK_VERSION 0.7.0-alpha.1 != root 10.7.2',
    ],
  );
});
