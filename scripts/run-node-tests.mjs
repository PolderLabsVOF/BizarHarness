#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const files = [];

function collect(path) {
  for (const entry of readdirSync(path)) {
    const absolute = join(path, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) collect(absolute);
    else if (/\.test\.(?:mjs|js)$/.test(entry)) files.push(absolute);
  }
}

for (const directory of ['cli', 'scripts', 'config/claude/hooks']) collect(join(root, directory));
files.sort();

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
