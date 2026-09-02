#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
for (const [command, args] of [
  ['npm', ['run', 'build:sdk']],
  ['npm', ['run', 'test:sdk']],
  ['npm', ['run', 'test:node']],
]) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
