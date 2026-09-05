#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const removedPaths = [
  'bizar-dash',
  'bookmarklet',
  'browser-extensions',
  'Dockerfile',
  'docker-compose.yml',
  'vite.config.ts',
  'cli/memory.mjs',
  'cli/memory-constants.mjs',
  'cli/service.mjs',
  'cli/service-controller.mjs',
  'cli/service-env.mjs',
  'cli/post-install-smoke.mjs',
  'cli/commands/dash.mjs',
  'cli/commands/memory.mjs',
  'cli/commands/lightrag.mjs',
  'packages/sdk/src/memory',
  'packages/sdk/src/router/memory-distillation.ts',
  'packages/sdk/dist/memory',
  'packages/sdk/dist/router/memory-distillation.js',
  'packages/sdk/dist/router/memory-distillation.d.ts',
  'plugins',
  '.bizar/MEMORY.md',
  '.bizar/activity-flow.md',
  '.bizar/lightrag',
  'config/claude/skills/lightrag',
  'config/claude/skills/memory-protocol',
  'config/claude/skills/obsidian',
  'config/skills/lightrag',
  'config/skills/memory-protocol',
  'config/skills/obsidian',
];

for (const path of removedPaths) {
  if (existsSync(join(root, path))) failures.push(`removed path exists: ${path}`);
}

const forbiddenPatterns = [
  [/\bbizar-dash\b/i, 'bizar-dash'],
  [/\bBIZAR_DASHBOARD(?:_URL|_PASSWORD)?\b/, 'dashboard environment variable'],
  [/\bBIZAR_MEMORY\b/, 'memory environment variable'],
  [/\.bizar_memory\b/, 'legacy memory directory'],
  [/\bmemory_(?:read|write|list|search)\b/, 'memory MCP tool'],
  [/\bopen_kb\b/, 'knowledge-base MCP tool'],
  [/\bmemory-distillation\b/i, 'memory distillation'],
  [/\bLightRAG\b/i, 'LightRAG integration'],
  [/\bObsidian\b/i, 'Obsidian integration'],
  [/\bBizar Memory(?: Service| System)?\b/i, 'Bizar Memory system'],
];

const scanRoots = [
  'cli',
  'packages',
  'scripts',
  'config/claude/hooks',
  'config/claude/commands',
  'config/claude/settings.json',
  'config',
  'Makefile',
  'package.json',
  'tsconfig.json',
];
const extensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.json', '.md', '']);

function scan(path) {
  if (path === 'scripts/verify-removed-surfaces.mjs' || /\.test\.[cm]?[jt]sx?$/.test(path)) return;
  const absolute = join(root, path);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      scan(join(path, entry));
    }
    return;
  }
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot);
  if (!extensions.has(extension)) return;
  const text = readFileSync(absolute, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(text)) failures.push(`${label} reference: ${relative(root, absolute)}`);
  }
}

for (const path of scanRoots) scan(path);

const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const name of Object.keys({ ...rootPackage.dependencies, ...rootPackage.devDependencies })) {
  if (/^(?:react|react-dom|vite|jsdom|tailwindcss|express|ws|lightrag|obsidian)$/i.test(name)) {
    failures.push(`removed-surface dependency: ${name}`);
  }
}

const sdkPackage = JSON.parse(readFileSync(join(root, 'packages/sdk/package.json'), 'utf8'));
if (sdkPackage.exports?.['./memory']) failures.push('SDK still exports ./memory');

const settings = JSON.parse(readFileSync(join(root, 'config/claude/settings.json'), 'utf8'));
const settingsText = JSON.stringify(settings);
for (const tool of ['memory_read', 'memory_write', 'memory_list', 'memory_search', 'open_kb']) {
  if (settingsText.includes(tool)) failures.push(`settings still reference ${tool}`);
}

if (failures.length) {
  console.error('Removed-surface verification failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('Removed dashboard and Bizar Memory surfaces are absent.');
