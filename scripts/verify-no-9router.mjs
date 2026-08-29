#!/usr/bin/env node

/**
 * scripts/verify-no-9router.mjs
 *
 * Phase A.5 drift guard. Bizar is provider-agnostic and ships no default
 * gateway. After retiring the 9Router skill packs and stripping
 * default-gateway injection from the runtime, this script is the
 * tripwire that fails CI if a 9Router reference sneaks back into the
 * shipped surface.
 *
 * The scan is intentionally narrow:
 *   - Looks for `9router`, `ninerouter`, `NINEROUTER`, `sk_9router`,
 *     `localhost:20128`, and `localhost:20129` in tracked repo files.
 *   - Excludes `node_modules/`, `dist/`, `.bizar/`, and any `*.test.*`
 *     file. Test fixtures occasionally include legacy URLs as input
 *     data — those are intentional and not part of the shipped surface.
 *   - Excludes this very script and the verify-removed-surfaces.mjs
 *     "Removed dashboard" sentinel (it does not mention 9Router, but
 *     the tripwire must not flag its own file).
 *
 * If any hit is found, the script exits 1 with a sorted, de-duped list
 * of `path:line` references so the operator can fix them before merge.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

const forbiddenPatterns = [
  [/\b9router\b/i, '9router'],
  [/\bninerouter\b/i, 'ninerouter'],
  [/\bNINEROUTER\b/, 'NINEROUTER_URL/NINEROUTER_KEY env'],
  [/\bsk_9router\b/, 'sk_9router placeholder token'],
  [/localhost:20128/, 'localhost:20128 default gateway'],
  [/localhost:20129/, 'localhost:20129 default gateway'],
];

const scanRoots = [
  'cli',
  'packages',
  'scripts',
  'config/claude/hooks',
  'config/claude/commands',
  'config/claude/agents',
  'config/skills',
  'config/claude/skills',
  'config/claude/settings.json',
  'config/claude/model-router.json',
  'Makefile',
  'package.json',
  'tsconfig.json',
  'AGENTS.md',
  'CLAUDE.md',
];

const extensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.cjs', '.json', '.md', '.sh', '']);

function scan(path) {
  if (path === 'scripts/verify-no-9router.mjs') return;
  if (/\.test\.[cm]?[jt]sx?$/.test(path)) return;
  if (/\.bizar-/.test(path)) return;
  const absolute = join(root, path);
  if (!existsSync(absolute)) return;
  const stat = statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.bizar') continue;
      scan(join(path, entry));
    }
    return;
  }
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot);
  if (!extensions.has(extension)) return;
  const text = readFileSync(absolute, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(line)) {
        // Allowlist: references that are part of the drift-guard scaffolding
        // itself. The Makefile target name is `verify-no-9router`; that's the
        // *tripwire* target, not a real 9Router reference.
        if (/verify-no-9router/.test(line)) continue;
        failures.push(`${label}: ${relative(root, absolute)}:${i + 1}`);
      }
    }
  }
}

for (const path of scanRoots) scan(path);

if (failures.length) {
  console.error('9Router drift guard FAILED — references slipped back into the shipped surface:');
  for (const failure of [...new Set(failures)].sort()) console.error(`  - ${failure}`);
  console.error('\nBizar is provider-agnostic. If a new file needs to reference 9Router as');
  console.error('legacy documentation, scope it to a `.bizar/` subdir or add an explicit');
  console.error('allow-list entry to scripts/verify-no-9router.mjs.');
  process.exit(1);
}

console.log('No 9Router references found in shipped surface (provider-agnostic invariant).');
