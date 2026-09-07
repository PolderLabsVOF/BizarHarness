/**
 * cli/commands/goal/cancel.mjs — `bizar goal cancel` subcommand.
 *
 * Top-level cancel. Transitions the run to `cancelled` from any
 * non-terminal phase. Same phase guard as `fail`.
 */

import { GoalCommandError, loadRunState, readCurrentPhase } from '../goal.mjs';
import { atomicAppendJsonl } from './_atomic.mjs';

const ALLOWED_PHASES = new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']);

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for cancel');
  }
  return flags.run.trim();
}

export async function runCancel(flags, ctx) {
  const runId = requireRunId(flags);
  if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
    throw new GoalCommandError('USAGE', '--reason is required for cancel');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  if (currentPhase && !ALLOWED_PHASES.has(currentPhase)) {
    throw new GoalCommandError(
      'PHASE_REJECTED',
      `cancel rejected: current phase is "${currentPhase}", already terminal`,
    );
  }
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: 'cancelled',
    event: 'cancel',
    runId,
    reason: flags.reason,
  };
  atomicAppendJsonl(ledgerPath, entry);
  return { ok: true, runId, phase: 'cancelled' };
}
