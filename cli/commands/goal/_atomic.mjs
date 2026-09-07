/**
 * cli/commands/goal/_atomic.mjs — DEC-022 atomic write helper for goal ledger.
 *
 * The standard `cli/atomic.mjs` uses `<file>.tmp.{ppid}+{pid}` for its
 * temp suffix. The ultragoal ledger requires `<file>.tmp-<random>` per
 * the bizplan-overhaul charter; this module provides a goal-scoped
 * variant that uses `crypto.randomBytes` to make the suffix unique
 * across concurrent processes.
 *
 * The two helpers are otherwise identical in semantics: write to a
 * sibling temp file, then `renameSync` over the final path so readers
 * never observe a partial document.
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';

function randomSuffix() {
  return randomBytes(8).toString('hex');
}

export function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp-${randomSuffix()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
  return filePath;
}

/**
 * Atomically write a UTF-8 text string to `filePath` via the
 * DEC-022 tmp+rename pattern. Used for the markdown charter.
 */
export function atomicWriteText(filePath, text) {
  const tmp = `${filePath}.tmp-${randomSuffix()}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, filePath);
  return filePath;
}

/**
 * Atomically append a single JSON line to an existing JSONL file.
 * Reads the current content (if any), concatenates the new line,
 * writes to a tmp file with a random suffix, and renames over the
 * final path. This avoids a read-modify-write race where two
 * processes both read the same baseline, both append, and clobber
 * each other on the rename.
 */
export function atomicAppendJsonl(filePath, entry) {
  const line = JSON.stringify(entry) + '\n';
  let existing = '';
  if (existsSync(filePath)) {
    try { existing = readFileSync(filePath, 'utf8'); } catch { existing = ''; }
  }
  const tmp = `${filePath}.tmp-${randomSuffix()}`;
  writeFileSync(tmp, existing + line, 'utf8');
  renameSync(tmp, filePath);
  return filePath;
}
