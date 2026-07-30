#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'packages', 'sdk', 'src');
const failures = [];
const patterns = [
  [/\bfetch\s*\(/, 'fetch call'],
  [/\bfrom\s+['"](?:node:)?https?['"]/, 'HTTP module import'],
  [/\bfrom\s+['"](?:axios|undici|node-fetch)['"]/, 'HTTP client import'],
];

function walk(path) {
  for (const entry of readdirSync(path)) {
    const absolute = join(path, entry);
    if (statSync(absolute).isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!absolute.endsWith('.ts')) continue;
    const source = readFileSync(absolute, 'utf8');
    for (const [pattern, label] of patterns) {
      if (pattern.test(source)) {
        failures.push(`${label}: ${relative(root, absolute)}`);
      }
    }
  }
}

walk(sourceRoot);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('SDK contains no HTTP client calls or imports.');
