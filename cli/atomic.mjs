/**
 * src/server/atomic.mjs
 *
 * Atomic file I/O utilities for the Bizar Memory Service. Uses the
 * proven tmp+rename pattern to ensure files are either fully written or
 * not written at all (no partial writes on crash).
 *
 * tmp files use `process.ppid + process.pid` to avoid collisions when
 * multiple processes race on the same file.
 */

import { writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';

/**
 * Atomically write a JSON file. Write to a temp file then rename over
 * the target so readers never see a partially-written document.
 *
 * @param {string} filePath
 * @param {unknown} data — will be JSON-stringified with 2-space indent
 */
export function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp.${process.ppid}+${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Atomically write a text file.
 *
 * @param {string} filePath
 * @param {string} text
 */
export function atomicWriteText(filePath, text) {
  const tmp = `${filePath}.tmp.${process.ppid}+${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Safe JSON read. Returns `fallback` on any error (missing file,
 * empty file, malformed JSON, permission error).
 *
 * @template T
 * @param {string} filePath
 * @param {T} [fallback=null]
 * @returns {T}
 */
export function safeReadJSON(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    const text = readFileSync(filePath, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Safe text read. Returns `fallback` on any error.
 *
 * @param {string} filePath
 * @param {string} [fallback='']
 * @returns {string}
 */
export function safeReadText(filePath, fallback = '') {
  try {
    if (!existsSync(filePath)) return fallback;
    return readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}
