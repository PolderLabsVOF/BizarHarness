/**
 * cli/commands/goal/complete.mjs — `bizar goal complete` subcommand.
 *
 * Top-level (non-steer) complete. Transitions the run to `done`
 * after the four-lane evidence is replayed through
 * `--quality-gate-json <path>`. Same four-lane guard as
 * `steer complete`; the two are equivalent at the ledger level.
 *
 * Phase guard: checkpointing only.
 */

import { existsSync, readFileSync } from 'node:fs';

import { GoalCommandError, loadRunState, readCurrentPhase } from '../goal.mjs';
import { atomicAppendJsonl } from './_atomic.mjs';

const REQUIRED_LANES = ['cleaner', 'verification', 'review', 'architecture_invariant'];

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for complete');
  }
  return flags.run.trim();
}

function requireRevision(flags) {
  if (flags.revision === undefined) {
    throw new GoalCommandError('USAGE', '--revision is required for complete');
  }
  const n = Number(flags.revision);
  if (!Number.isInteger(n) || n < 0) {
    throw new GoalCommandError('USAGE', '--revision must be a non-negative integer');
  }
  return n;
}

export async function runComplete(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags['quality-gate-json'] !== 'string' || !flags['quality-gate-json'].trim()) {
    throw new GoalCommandError(
      'USAGE',
      '--quality-gate-json <path> is required for complete',
    );
  }
  const qgPath = flags['quality-gate-json'].trim();
  if (!existsSync(qgPath)) {
    throw new GoalCommandError('NOT_FOUND', `quality-gate-json not found: ${qgPath}`);
  }
  let qg;
  try {
    qg = JSON.parse(readFileSync(qgPath, 'utf8'));
  } catch (err) {
    throw new GoalCommandError('USAGE', `quality-gate-json must be valid JSON: ${err.message}`);
  }
  for (const lane of REQUIRED_LANES) {
    if (!qg[lane]) {
      throw new GoalCommandError(
        'PHASE_REJECTED',
        `complete rejected: missing four-lane evidence for "${lane}"`,
      );
    }
    if (typeof qg[lane].status === 'string' && qg[lane].status !== 'green') {
      throw new GoalCommandError(
        'PHASE_REJECTED',
        `complete rejected: lane "${lane}" status is "${qg[lane].status}", expected "green"`,
      );
    }
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  if (currentPhase !== 'checkpointing') {
    throw new GoalCommandError(
      'PHASE_REJECTED',
      `complete rejected: current phase is "${currentPhase ?? 'unset'}", expected "checkpointing"`,
    );
  }
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: 'done',
    event: 'complete',
    runId,
    revision,
    qualityGate: qg,
    sourcePath: qgPath,
  };
  atomicAppendJsonl(ledgerPath, entry);
  return { ok: true, runId, revision, event: 'complete', phase: 'done' };
}
