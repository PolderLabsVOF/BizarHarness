#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
for (const [command, args] of [
  ['npm', ['run', 'build:sdk']],
  [process.execPath, ['scripts/bh-full-e2e.mjs']],
]) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
