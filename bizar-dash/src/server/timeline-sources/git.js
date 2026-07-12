/**
 * src/server/timeline-sources/git.js
 *
 * F-042 — Lightweight git-log reader. Returns recent commits for one
 * repo path. Used by the timeline aggregator's "commit" source.
 *
 * Returns `[]` on any failure (not a git repo, git not on PATH, the
 * path doesn't exist). The timeline store treats empty results as a
 * normal state — there are no commits to surface.
 *
 * Commit shape: { sha, author, ts, subject, body }
 */

import { execFileSync } from 'node:child_process';

/**
 * @param {string} projectPath  Absolute path to a git repo (or a subdir).
 * @param {{ since?: string, until?: string, limit?: number }} [opts]
 * @returns {Array<{ sha: string, author: string, ts: string, subject: string, body: string }>}
 */
export function gitLog(projectPath, opts = {}) {
  if (!projectPath || typeof projectPath !== 'string') return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 2000);
  const fmt = ['%H', '%an', '%aI', '%s', '%b'].join('%x09'); // tab-separated
  const args = ['log', '--follow', '-n', String(limit), `--format=${fmt}`, '--', projectPath];
  let out;
  try {
    out = execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  if (!out) return [];
  return parseLog(out, opts);
}

function parseLog(text, opts = {}) {
  const records = [];
  let cur = null;
  let bodyLines = [];
  let inBody = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!inBody) {
      const parts = line.split('\t');
      if (parts.length >= 4) {
        if (cur) {
          cur.body = bodyLines.join('\n').trim();
          records.push(cur);
        }
        const [sha, author, ts, subject] = parts;
        cur = { sha, author, ts, subject, body: '' };
        bodyLines = [];
        inBody = true;
      }
      // Lines that don't look like a record and we haven't started a
      // record yet — skip silently.
      continue;
    }
    // Inside a record body. A new record begins with another tab-split line.
    if (line.includes('\t')) {
      // Flush the previous record.
      if (cur) {
        cur.body = bodyLines.join('\n').trim();
        records.push(cur);
      }
      const parts = line.split('\t');
      if (parts.length >= 4) {
        const [sha, author, ts, subject] = parts;
        cur = { sha, author, ts, subject, body: '' };
        bodyLines = [];
      } else {
        cur = null;
      }
      continue;
    }
    if (cur) bodyLines.push(line);
  }
  if (cur) {
    cur.body = bodyLines.join('\n').trim();
    records.push(cur);
  }
  // Apply optional since/until filters (ISO-string compare).
  let out = records;
  if (opts.since) out = out.filter((r) => (r.ts || '') >= opts.since);
  if (opts.until) out = out.filter((r) => (r.ts || '') <= opts.until);
  return out;
}

/**
 * Try to find the root of a git repo by walking up from `startPath`.
 * Returns the absolute path of the repo root, or null when none.
 *
 * Implementation: shell out to `git rev-parse --show-toplevel` with the
 * start path as both cwd and the lone argument. Returns null on any
 * failure (not a repo, git missing, etc).
 */
export function gitRoot(startPath) {
  if (!startPath) return null;
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}
