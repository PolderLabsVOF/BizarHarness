#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_TRACKED_PREFIXES = [
  '${HOME}/',
  '.config/',
  '.serena/',
  'bizar-plugins/',
  'fresh901/',
  'packages/sdk/.harness/',
  'templates/eval-fixtures/',
  'templates/schedules/',
];

const FORBIDDEN_TRACKED_FILES = new Set([
  'config/claude/hooks/post-merge-audit.sh',
  'config/claude/skills/find-skills',
  '.dockerignore',
  'scripts/overnight-loop.mjs',
  'scripts/session-trace.sh',
  'skills-lock.json',
]);

const REQUIRED_PACKAGE_FILES = [
  'config/claude/hooks/pretooluse-bash.mjs',
  'config/claude/settings.json',
  'AGENTS.md',
  'cli/bin.mjs',
  'config/skills/bizar/SKILL.md',
  'hooks/hooks.json',
  'packages/sdk/dist/index.js',
  'scripts/plugin-hook-runner.cjs',
  'scripts/install-hooks.sh',
];

const ALLOWED_PACKAGE_ROOTS = new Set([
  'AGENTS.md',
  'LICENSE',
  'README.md',
  'cli',
  'config',
  'hooks',
  'install.sh',
  'package.json',
  'packages',
  'scripts',
]);

export function inspectTrackedPaths(paths) {
  return paths.filter(
    (path) =>
      FORBIDDEN_TRACKED_FILES.has(path) ||
      FORBIDDEN_TRACKED_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
}

export function inspectPackagePaths(paths) {
  const problems = [];
  const pathSet = new Set(paths);

  for (const path of paths) {
    const root = path.split('/')[0];
    if (!ALLOWED_PACKAGE_ROOTS.has(root)) {
      problems.push(`unexpected package root: ${root}`);
    }
    if (
      path.includes('/__tests__/') ||
      /(^|\/)[^/]+\.test\.(?:js|mjs|ts|tsx)$/.test(path)
    ) {
      problems.push(`test file shipped: ${path}`);
    }
    if (/(?:\.bak|\.tmp|\.temp|\.orig|~)$/.test(path)) {
      problems.push(`backup or temporary file shipped: ${path}`);
    }
    if (
      path.includes('${HOME}') ||
      path.includes('/.bizar/') ||
      path.includes('/.bizar_home/') ||
      path.startsWith('.claude/skills/') || path.startsWith('config/claude/skills/')
    ) {
      problems.push(`local or duplicate package path: ${path}`);
    }
  }

  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!pathSet.has(required)) {
      problems.push(`required runtime file missing: ${required}`);
    }
  }

  return [...new Set(problems)].sort();
}

export function inspectVersionState(rootVersion, sdkVersion, sdkConstant) {
  const problems = [];
  if (!rootVersion) problems.push('root package version is missing');
  if (sdkVersion !== rootVersion) {
    problems.push(`SDK package version ${sdkVersion || 'missing'} != root ${rootVersion || 'missing'}`);
  }
  if (sdkConstant !== rootVersion) {
    problems.push(`SDK_VERSION ${sdkConstant || 'missing'} != root ${rootVersion || 'missing'}`);
  }
  return problems;
}

export function packageFilesFromPackReport(report) {
  const entries = Array.isArray(report) ? report : Object.values(report ?? {});
  const files = entries[0]?.files;
  if (!Array.isArray(files)) {
    throw new Error('npm pack did not return a file manifest');
  }
  return files.map((file) => file.path);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'unknown error';
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

function readTrackedPaths() {
  return run('git', ['ls-files', '-z']).split('\0').filter(Boolean);
}

function readPackagePaths() {
  const output = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']);
  return packageFilesFromPackReport(JSON.parse(output));
}

function readVersionProblems() {
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
  const sdkPackage = JSON.parse(readFileSync('packages/sdk/package.json', 'utf8'));
  const versionSource = readFileSync('packages/sdk/src/version.ts', 'utf8');
  const sdkConstant = versionSource.match(/SDK_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
  return inspectVersionState(rootPackage.version, sdkPackage.version, sdkConstant);
}

export function main() {
  const trackedProblems = inspectTrackedPaths(readTrackedPaths()).map(
    (path) => `obsolete tracked path: ${path}`,
  );
  const packageProblems = inspectPackagePaths(readPackagePaths());
  const problems = [...trackedProblems, ...packageProblems, ...readVersionProblems()];

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`FAIL  ${problem}`);
    }
    process.exit(1);
  }

  console.log('Repository structure and package boundary are clean.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
