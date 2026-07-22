#!/usr/bin/env node
/**
 * scripts/verify-thinking-skills.mjs
 *
 * Verifies every config/skills/thinking-<name>/SKILL.md and
 * config/skills/skillopt/SKILL.md is well-formed:
 *
 *   - file exists and is non-empty
 *   - YAML frontmatter parses (lines 2-3 between `---` markers)
 *   - `name:` matches the directory name (kebab-case, no spaces)
 *   - `description:` exists and is ≤ 200 chars
 *   - body ≥ 100 chars (catches truncated imports)
 *
 * Exits non-zero with a per-file failure list if any check fails.
 * Wired into `make check-arch`.
 */
'use strict';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = 'config/skills';
const REQUIRED_DIRS = ['skillopt'];
const THINKING_PREFIX = 'thinking-';
const MAX_DESCRIPTION = 200;
const MIN_BODY = 100;

const failures = [];

function listDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function parseFrontmatter(src) {
  // Strict: first line must be `---`, second block delimited by `---`.
  if (!src.startsWith('---\n')) return null;
  const end = src.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const block = src.slice(4, end);
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fields[m[1].trim()] = m[2].trim();
  }
  return { fields, body: src.slice(end + 5) };
}

function checkFile(dirName) {
  const filePath = join(ROOT, dirName, 'SKILL.md');
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch (err) {
    failures.push(`${dirName}: cannot read SKILL.md (${err.message})`);
    return;
  }

  if (src.length === 0) {
    failures.push(`${dirName}: SKILL.md is empty`);
    return;
  }

  const fm = parseFrontmatter(src);
  if (!fm) {
    failures.push(`${dirName}: malformed YAML frontmatter (expected '---\\n...\\n---\\n')`);
    return;
  }

  const { fields, body } = fm;

  if (!fields.name) {
    failures.push(`${dirName}: missing 'name:' in frontmatter`);
  } else if (fields.name !== dirName) {
    failures.push(
      `${dirName}: name mismatch — frontmatter says '${fields.name}', dir is '${dirName}'`,
    );
  }

  if (!fields.description) {
    failures.push(`${dirName}: missing 'description:' in frontmatter`);
  } else if (fields.description.length > MAX_DESCRIPTION) {
    failures.push(
      `${dirName}: description is ${fields.description.length} chars (max ${MAX_DESCRIPTION})`,
    );
  }

  const bodyTrimmed = body.trim();
  if (bodyTrimmed.length < MIN_BODY) {
    failures.push(
      `${dirName}: body is only ${bodyTrimmed.length} chars (min ${MIN_BODY} — likely truncated)`,
    );
  }
}

function main() {
  const dirs = listDirs(ROOT);
  if (dirs.length === 0) {
    failures.push(`no skill directories under ${ROOT}/`);
  }

  // Collect targets: all thinking-* + the explicitly-listed required dirs.
  const targets = new Set();
  for (const d of dirs) {
    if (d.startsWith(THINKING_PREFIX)) targets.add(d);
  }
  for (const r of REQUIRED_DIRS) {
    if (dirs.includes(r)) targets.add(r);
    else failures.push(`missing required skill directory: ${ROOT}/${r}/`);
  }

  if (targets.size === 0) {
    failures.push(`no thinking-* skill directories under ${ROOT}/`);
  }

  for (const t of targets) checkFile(t);

  const sorted = [...targets].sort();
  console.log(`→ verified ${sorted.length} skill files under ${ROOT}/`);
  if (failures.length === 0) {
    console.log('✓ all skill files pass frontmatter + size checks');
    process.exit(0);
  }
  console.error(`\n✗ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

main();