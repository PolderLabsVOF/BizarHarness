/**
 * cli/commands/goal/checkpoint.mjs — `bizar goal checkpoint` subcommand.
 *
 * Top-level (non-steer) checkpoint. Records an evidence string
 * against the run without changing the phase. Useful when the
 * operator wants to log a mid-flight milestone that the steer
 * checkpoint action does not already cover.
 *
 * Phase guard: any non-terminal phase (planning | executing |
 * verifying | reviewing | checkpointing).
 */

import { GoalCommandError, loadRunState, readCurrentPhase } from '../goal.mjs';
import { atomicAppendJsonl } from './_atomic.mjs';

const ALLOWED_PHASES = new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']);

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for checkpoint');
  }
  return flags.run.trim();
}

function requireRevision(flags) {
  if (flags.revision === undefined) {
    throw new GoalCommandError('USAGE', '--revision is required for checkpoint');
  }
  const n = Number(flags.revision);
  if (!Number.isInteger(n) || n < 0) {
    throw new GoalCommandError('USAGE', '--revision must be a non-negative integer');
  }
  return n;
}

export async function runCheckpoint(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags.evidence !== 'string' || !flags.evidence.trim()) {
    throw new GoalCommandError('USAGE', '--evidence is required for checkpoint');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  if (currentPhase && !ALLOWED_PHASES.has(currentPhase)) {
    throw new GoalCommandError(
      'PHASE_REJECTED',
      `checkpoint rejected: current phase is "${currentPhase}", terminal state`,
    );
  }
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: currentPhase ?? 'executing',
    event: 'checkpoint',
    runId,
    revision,
    evidence: flags.evidence,
  };
  atomicAppendJsonl(ledgerPath, entry);
  return { ok: true, runId, revision, event: 'checkpoint', phase: entry.phase };
}
