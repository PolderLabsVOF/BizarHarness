/**
 * cli/commands/goal/resume.mjs — `bizar goal resume` subcommand.
 *
 * Re-bootstraps a hand-persisted run (e.g. the bizplan-overhaul
 * charter, which was written by hand because the goal CLI did not
 * ship in 10.26.0) so downstream consumers see the same canonical
 * `start` event that a freshly-initialised run would have. This
 * allows the four-lane fence evidence to be replayed into
 * `steer complete` verbatim.
 *
 * Behaviour:
 *   1. Scan docs/specs/ultragoal-*.md for charter files whose
 *      matching ledger is missing the first `start` event.
 *   2. Re-emit the canonical start event into the ledger via
 *      atomicAppendJsonl.
 *   3. Return the list of runs that were resumed.
 *
 * Idempotent: re-running resume on a run that already has a start
 * event is a no-op.
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { atomicAppendJsonl } from './_atomic.mjs';
import { GoalCommandError } from '../goal.mjs';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

function parseFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  const block = match[1];
  const out = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('`') && value.endsWith('`')) {
      value = value.slice(1, -1);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function deriveRunIdFromCharter(fileName) {
  const m = /^ultragoal-(.+)\.md$/.exec(fileName);
  return m ? `ultragoal-${m[1]}` : null;
}

function ledgerHasStart(ledgerPath) {
  if (!existsSync(ledgerPath)) return false;
  const text = readFileSync(ledgerPath, 'utf8');
  return text.split('\n').some((line) => {
    if (!line.trim()) return false;
    try {
      const entry = JSON.parse(line);
      return entry.event === 'start';
    } catch {
      return false;
    }
  });
}

export async function runResume(flags, ctx) {
  const specsRoot = join(ctx.repoRoot, 'docs', 'specs');
  if (!existsSync(specsRoot)) {
    throw new GoalCommandError(
      'NOT_FOUND',
      `no docs/specs directory at ${specsRoot}; nothing to resume`,
    );
  }
  const ultragoalDir = join(specsRoot, 'ultragoal');
  mkdirSync(ultragoalDir, { recursive: true });

  const charters = readdirSync(specsRoot)
    .filter((n) => /^ultragoal-.+\.md$/.test(n))
    .map((n) => ({ file: n, absPath: join(specsRoot, n) }));

  const resumed = [];
  for (const c of charters) {
    const runId = deriveRunIdFromCharter(c.file);
    if (!runId) continue;
    const ledgerPath = join(ultragoalDir, `${runId}.jsonl`);
    if (ledgerHasStart(ledgerPath)) continue;

    const text = readFileSync(c.absPath, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;

    const entry = {
      ts: fm['Started'] ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      phase: 'planning',
      event: 'start',
      runId,
      mode: fm['Mode']?.replace(/^`|`$/g, '') ?? 'aggregate',
      completionThreshold: Number(fm['Completion threshold'] ?? 1.0),
      charter: `docs/specs/${c.file}`,
      operatorNote: 'replayed by bizar goal resume (hand-persisted charter)',
    };
    atomicAppendJsonl(ledgerPath, entry);
    resumed.push({ runId, ledgerPath, charter: `docs/specs/${c.file}` });
  }

  return {
    ok: true,
    resumed,
    count: resumed.length,
    message: resumed.length === 0
      ? 'bizar goal: no hand-persisted charters needed resume'
      : `bizar goal: resumed ${resumed.length} run(s)`,
  };
}
