/**
 * cli/commands/goal/status.mjs — `bizar goal status` subcommand.
 *
 * Read-only: returns the run's current phase, latest revision, the
 * event count, and a pointer to the charter path. No writes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GoalCommandError, loadRunState } from '../goal.mjs';

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for status');
  }
  return flags.run.trim();
}

export async function runStatus(flags, ctx) {
  const runId = requireRunId(flags);
  const { ledgerPath, specsDir } = loadRunState(runId, ctx);
  const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  const start = events.find((e) => e.event === 'start');
  const last = events[events.length - 1] ?? null;
  const currentPhase = last?.phase ?? start?.phase ?? 'planning';
  const latestRevision = events.reduce((acc, e) => {
    const n = Number(e.revision);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);

  const charterPath = start?.charter ?? join(specsDir, `..`, `ultragoal-${runId}.md`);
  const charterExists = existsSync(charterPath);
  return {
    ok: true,
    runId,
    phase: currentPhase,
    revision: latestRevision,
    eventCount: events.length,
    ledgerPath,
    charterPath,
    charterExists,
    events: events.slice(-5).map((e) => ({ ts: e.ts, phase: e.phase, event: e.event, revision: e.revision })),
  };
}
