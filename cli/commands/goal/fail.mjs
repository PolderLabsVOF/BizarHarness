/**
 * cli/commands/goal/fail.mjs — `bizar goal fail` subcommand.
 *
 * Top-level fail. Transitions the run to `failed` regardless of
 * current phase. Allowed from any non-terminal phase
 * (planning | executing | verifying | reviewing | checkpointing).
 */

import { GoalCommandError, loadRunState, readCurrentPhase } from '../goal.mjs';
import { atomicAppendJsonl } from './_atomic.mjs';

const ALLOWED_PHASES = new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']);

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for fail');
  }
  return flags.run.trim();
}

export async function runFail(flags, ctx) {
  const runId = requireRunId(flags);
  if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
    throw new GoalCommandError('USAGE', '--reason is required for fail');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  if (currentPhase && !ALLOWED_PHASES.has(currentPhase)) {
    throw new GoalCommandError(
      'PHASE_REJECTED',
      `fail rejected: current phase is "${currentPhase}", already terminal`,
    );
  }
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: 'failed',
    event: 'fail',
    runId,
    reason: flags.reason,
  };
  atomicAppendJsonl(ledgerPath, entry);
  return { ok: true, runId, phase: 'failed' };
}
