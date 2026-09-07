/**
 * cli/commands/goal/steer.mjs — `bizar goal steer <action>` subcommand.
 *
 * Steer applies a single bounded change to an in-flight ultragoal
 * run. The subcommand is an action dispatcher; the legal actions
 * mirror the canonical ultragoal state machine:
 *
 *   - add_subgoal : planning | executing only
 *   - checkpoint  : executing | verifying | reviewing | checkpointing
 *   - update      : any non-terminal
 *   - fail        : any non-terminal
 *   - cancel      : any non-terminal
 *   - complete    : checkpointing only (four-lane evidence required)
 *
 * Each action validates the current ledger phase before writing the
 * new event so a steering action that violates the state machine
 * is rejected with a `PHASE_REJECTED` error rather than corrupting
 * the durable record.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  GoalCommandError,
  loadRunState,
  readCurrentPhase,
} from '../goal.mjs';
import { atomicAppendJsonl } from './_atomic.mjs';

const STEER_ACTIONS = new Map([
  ['add_subgoal', runAddSubgoal],
  ['checkpoint', runCheckpointSteer],
  ['update', runUpdate],
  ['fail', runFailSteer],
  ['cancel', runCancelSteer],
  ['complete', runCompleteSteer],
]);

// Phase guard per action. The set is "allowed current phases".
const PHASE_GUARDS = {
  add_subgoal: new Set(['planning', 'executing']),
  checkpoint:  new Set(['executing', 'verifying', 'reviewing', 'checkpointing']),
  update:      new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']),
  fail:        new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']),
  cancel:      new Set(['planning', 'executing', 'verifying', 'reviewing', 'checkpointing']),
  complete:    new Set(['checkpointing']),
};

function requireRunId(flags) {
  if (typeof flags.run !== 'string' || !flags.run.trim()) {
    throw new GoalCommandError('USAGE', '--run is required for steer');
  }
  return flags.run.trim();
}

function requireRevision(flags) {
  if (flags.revision === undefined) {
    throw new GoalCommandError('USAGE', '--revision is required for steer');
  }
  const n = Number(flags.revision);
  if (!Number.isInteger(n) || n < 0) {
    throw new GoalCommandError('USAGE', '--revision must be a non-negative integer');
  }
  return n;
}

function enforcePhase(action, currentPhase) {
  const allowed = PHASE_GUARDS[action];
  if (!currentPhase) return; // no phase recorded yet, accept any
  if (!allowed.has(currentPhase)) {
    throw new GoalCommandError(
      'PHASE_REJECTED',
      `steer ${action} rejected: current phase is "${currentPhase}", ` +
      `allowed phases are { ${Array.from(allowed).join(', ')} }`,
    );
  }
}

function appendEvent({ ledgerPath, runId, event, revision, payload, phaseAfter }) {
  const entry = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: phaseAfter,
    event,
    runId,
    revision,
    ...payload,
  };
  atomicAppendJsonl(ledgerPath, entry);
  return entry;
}

function runAddSubgoal(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags['subgoal-id'] !== 'string' || !flags['subgoal-id'].trim()) {
    throw new GoalCommandError('USAGE', '--subgoal-id is required for steer add_subgoal');
  }
  if (flags.weight === undefined) {
    throw new GoalCommandError('USAGE', '--weight is required for steer add_subgoal');
  }
  const weight = Number(flags.weight);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new GoalCommandError('USAGE', '--weight must be a number in [0, 1]');
  }
  if (typeof flags.summary !== 'string' || !flags.summary.trim()) {
    throw new GoalCommandError('USAGE', '--summary is required for steer add_subgoal');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('add_subgoal', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'add_subgoal',
    revision,
    phaseAfter: currentPhase ?? 'planning',
    payload: {
      subgoalId: flags['subgoal-id'].trim(),
      weight,
      summary: flags.summary,
    },
  });
  return { ok: true, runId, revision, event: 'add_subgoal', entry, phase: entry.phase };
  return { ok: true, runId, revision, event: 'add_subgoal', entry, phase: entry.phase };
}

function runCheckpointSteer(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags.evidence !== 'string' || !flags.evidence.trim()) {
    throw new GoalCommandError('USAGE', '--evidence is required for steer checkpoint');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('checkpoint', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'checkpoint',
    revision,
    phaseAfter: currentPhase ?? 'executing',
    payload: { evidence: flags.evidence },
  });
  return { ok: true, runId, revision, event: 'checkpoint', entry, phase: entry.phase };
}

function runUpdate(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags.field !== 'string' || !flags.field.trim()) {
    throw new GoalCommandError('USAGE', '--field <dot.path> is required for steer update');
  }
  if (typeof flags.value !== 'string') {
    throw new GoalCommandError('USAGE', '--value <json> is required for steer update');
  }
  let parsed;
  try {
    parsed = JSON.parse(flags.value);
  } catch (err) {
    throw new GoalCommandError('USAGE', `--value must be valid JSON: ${err.message}`);
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('update', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'update',
    revision,
    phaseAfter: currentPhase ?? 'planning',
    payload: { field: flags.field, value: parsed },
  });
  return { ok: true, runId, revision, event: 'update', entry, phase: entry.phase };
}

function runFailSteer(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
    throw new GoalCommandError('USAGE', '--reason is required for steer fail');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('fail', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'fail',
    revision,
    phaseAfter: 'failed',
    payload: { reason: flags.reason },
  });
  return { ok: true, runId, revision, event: 'fail', entry, phase: 'failed' };
}

function runCancelSteer(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags.reason !== 'string' || !flags.reason.trim()) {
    throw new GoalCommandError('USAGE', '--reason is required for steer cancel');
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('cancel', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'cancel',
    revision,
    phaseAfter: 'cancelled',
    payload: { reason: flags.reason },
  });
  return { ok: true, runId, revision, event: 'cancel', entry, phase: 'cancelled' };
}

function runCompleteSteer(flags, ctx) {
  const runId = requireRunId(flags);
  const revision = requireRevision(flags);
  if (typeof flags['quality-gate-json'] !== 'string' || !flags['quality-gate-json'].trim()) {
    throw new GoalCommandError(
      'USAGE',
      '--quality-gate-json <path> is required for steer complete',
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
  // The four-lane fence is the bizplan-overhaul stop condition. The
  // steer complete action requires all four lanes to be present and
  // individually green.
  const REQUIRED_LANES = ['cleaner', 'verification', 'review', 'architecture_invariant'];
  for (const lane of REQUIRED_LANES) {
    if (!qg[lane]) {
      throw new GoalCommandError(
        'PHASE_REJECTED',
        `steer complete rejected: missing four-lane evidence for "${lane}"`,
      );
    }
    if (typeof qg[lane].status === 'string' && qg[lane].status !== 'green') {
      throw new GoalCommandError(
        'PHASE_REJECTED',
        `steer complete rejected: lane "${lane}" status is "${qg[lane].status}", expected "green"`,
      );
    }
  }
  const { ledgerPath } = loadRunState(runId, ctx);
  const currentPhase = readCurrentPhase(ledgerPath);
  enforcePhase('complete', currentPhase);

  const entry = appendEvent({
    ledgerPath,
    runId,
    event: 'complete',
    revision,
    phaseAfter: 'done',
    payload: { qualityGate: qg, sourcePath: qgPath },
  });
  return { ok: true, runId, revision, event: 'complete', entry, phase: 'done' };
}

export async function runSteer(flags, ctx) {
  const action = flags._[0];
  if (!action) {
    throw new GoalCommandError('USAGE', 'steer requires an action: add_subgoal | checkpoint | update | fail | cancel | complete');
  }
  const handler = STEER_ACTIONS.get(action);
  if (!handler) {
    throw new GoalCommandError(
      'USAGE',
      `unknown steer action: "${action}". Allowed: ${Array.from(STEER_ACTIONS.keys()).join(', ')}`,
    );
  }
  // flags._.shift() so subcommand handlers see only their own args
  const subFlags = { ...flags, _: flags._.slice(1) };
  return await handler(subFlags, ctx);
}
