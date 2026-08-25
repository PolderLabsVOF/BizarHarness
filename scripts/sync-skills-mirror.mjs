#!/usr/bin/env node
/**
 * scripts/sync-skills-mirror.mjs
 *
 * Keep `.claude/skills/<name>/SKILL.md` in sync with the canonical
 * `config/skills/<name>/SKILL.md`. Idempotent.
 *
 * Exit codes:
 *   0 — every canonical skill is mirrored (or copied fresh on first run)
 *   1 — drift detected and could not be auto-fixed (e.g. permission)
 *
 * Outputs a per-file report on stdout. Designed to be wired into
 * `make check` so missing mirrors fail the build.
 */
'use strict';

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'config/skills';
const DST = 'config/claude/skills';

function listSkillDirs(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const canonical = listSkillDirs(SRC);
  if (canonical.length === 0) {
    console.error(`✗ ${SRC}/ is empty or missing — no canonical skills to mirror`);
    process.exit(1);
  }

  let copied = 0;
  let alreadySynced = 0;
  const errors = [];

  for (const name of canonical) {
    const srcPath = join(SRC, name, 'SKILL.md');
    const dstDir = join(DST, name);
    const dstPath = join(DST, name, 'SKILL.md');

    const srcBody = readOrNull(srcPath);
    if (srcBody === null) {
      errors.push(`${name}: missing ${srcPath}`);
      continue;
    }

    try {
      mkdirSync(dstDir, { recursive: true });
    } catch (err) {
      errors.push(`${name}: cannot mkdir ${dstDir}: ${err.message}`);
      continue;
    }

    const dstBody = readOrNull(dstPath);
    if (dstBody === srcBody) {
      alreadySynced++;
      continue;
    }
    if (checkOnly) {
      errors.push(`${name}: mirror differs from ${srcPath}`);
      continue;
    }

    try {
      writeFileSync(dstPath, srcBody);
      copied++;
      console.log(`✓ mirrored ${name}/SKILL.md`);
    } catch (err) {
      errors.push(`${name}: cannot write ${dstPath}: ${err.message}`);
    }
  }

  // Detect extra dirs in the mirror that no longer have a canonical
  // counterpart — surfaced as warnings (not errors) so the script stays
  // additive.
  const mirror = listSkillDirs(DST);
  const canonicalSet = new Set(canonical);
  const orphans = mirror.filter((m) => !canonicalSet.has(m));

  console.log(
    `\n→ ${canonical.length} canonical skills; ${copied} copied, ${alreadySynced} already in sync, ${errors.length} errors, ${orphans.length} orphan(s) in ${DST}/`,
  );

  if (orphans.length > 0) {
    for (const o of orphans) {
      console.log(`  (orphan) ${o}/ — no canonical counterpart in ${SRC}/`);
    }
  }

  if (checkOnly && orphans.length > 0) {
    errors.push(`${orphans.length} orphan skill director${orphans.length === 1 ? 'y' : 'ies'} in ${DST}`);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
