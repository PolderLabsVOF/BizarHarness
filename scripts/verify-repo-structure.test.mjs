import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectPackagePaths,
  inspectTrackedPaths,
  inspectVersionState,
} from './verify-repo-structure.mjs';

const CLEAN_PACKAGE = [
  '.claude/hooks/pretooluse-bash.mjs',
  '.claude/settings.json',
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'cli/bin.mjs',
  'config/skills/bizar/SKILL.md',
  'install.sh',
  'package.json',
  'packages/sdk/dist/index.js',
  'scripts/install-hooks.sh',
];

test('tracked repository structure rejects retired roots and metadata', () => {
  assert.deepEqual(
    inspectTrackedPaths([
      'cli/bin.mjs',
      '${HOME}/leaked-state.json',
      '.config/bizar/hook.jsonl',
      '.claude/hooks/post-merge-audit.sh',
      '.claude/skills/find-skills',
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
      '.claude/hooks/post-merge-audit.sh',
      '.claude/skills/find-skills',
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

test('package boundary rejects tests, local state, duplicate skills, and missing runtime files', () => {
  const problems = inspectPackagePaths([
    ...CLEAN_PACKAGE.filter((path) => path !== 'packages/sdk/dist/index.js'),
    '.claude/hooks/__tests__/guard.test.mjs',
    '.claude/skills/bizar/SKILL.md',
    'packages/sdk/${HOME}/.bizar_home/memory/session.md',
    'templates/schedules/daily.json',
  ]);

  assert.ok(problems.some((problem) => problem.includes('test file shipped')));
  assert.ok(problems.some((problem) => problem.includes('local or duplicate package path')));
  assert.ok(problems.includes('unexpected package root: templates'));
  assert.ok(
    problems.includes('required runtime file missing: packages/sdk/dist/index.js'),
  );
});

test('version state requires root, SDK package, and SDK constant parity', () => {
  assert.deepEqual(inspectVersionState('10.7.2', '10.7.2', '10.7.2'), []);
  assert.deepEqual(
    inspectVersionState('10.7.2', '10.6.0', '0.7.0-alpha.1'),
    [
      'SDK package version 10.6.0 != root 10.7.2',
      'SDK_VERSION 0.7.0-alpha.1 != root 10.7.2',
    ],
  );
});
