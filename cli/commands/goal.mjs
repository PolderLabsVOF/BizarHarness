/**
 * cli/commands/goal.mjs — `bizar goal` top-level dispatcher.
 *
 * The `goal` subcommand is the ultragoal progress tracker. It
 * implements the surface described by the bizplan-overhaul charter
 * (`docs/specs/ultragoal-bizplan-overhaul.md`) and the ultragoal
 * skill: `start | steer | checkpoint | complete | status | fail |
 * cancel | resume`.
 *
 * Each subcommand is implemented in a sibling module under
 * `cli/commands/goal/<subcommand>.mjs`. This top-level file
 * dispatches by argv, owns the JSON / human output, and centralises
 * the phase-transition validation.
 *
 * Phase model (enforced by `enforcePhaseTransition`):
 *   - start:             -> planning
 *   - steer add_subgoal:  -> planning | executing only
 *   - steer checkpoint:   -> executing | verifying | reviewing | checkpointing
 *   - steer complete:     -> checkpointing only (requires 4-lane evidence)
 *   - fail / cancel:      -> any non-terminal
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runStart } from './goal/start.mjs';
import { runSteer } from './goal/steer.mjs';
import { runCheckpoint } from './goal/checkpoint.mjs';
import { runComplete } from './goal/complete.mjs';
import { runStatus } from './goal/status.mjs';
import { runFail } from './goal/fail.mjs';
import { runCancel } from './goal/cancel.mjs';
import { runResume } from './goal/resume.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(here, '..', '..');

const SUBCOMMANDS = new Map([
  ['start', runStart],
  ['steer', runSteer],
  ['checkpoint', runCheckpoint],
  ['complete', runComplete],
  ['status', runStatus],
  ['fail', runFail],
  ['cancel', runCancel],
  ['resume', runResume],
]);

function showHelp() {
  process.stdout.write(`
  bizar goal — ultragoal progress tracker

  Usage:
    bizar goal start --mode aggregate|per-story --goal "<text>" [--threshold 1.0] [--json]
    bizar goal steer add_subgoal --run <uuid> --revision <n> --subgoal-id <id> --weight <n> --summary <text> [--json]
    bizar goal steer checkpoint --run <uuid> --revision <n> --evidence <text> [--json]
    bizar goal steer update --run <uuid> --revision <n> --field <dot.path> --value <json> [--json]
    bizar goal steer fail --run <uuid> --revision <n> --reason <text> [--json]
    bizar goal steer cancel --run <uuid> --revision <n> --reason <text> [--json]
    bizar goal steer complete --run <uuid> --revision <n> --quality-gate-json <path> [--json]
    bizar goal status --run <uuid> [--json]
    bizar goal fail --run <uuid> --reason <text> [--json]
    bizar goal cancel --run <uuid> --reason <text> [--json]
    bizar goal resume [--json]

  Phase model (enforced):
    planning -> executing -> verifying -> reviewing -> checkpointing -> done
                                                           \\-> failed
                                                           \\-> cancelled

  Atomic writes per DEC-022: every state mutation writes a tmp file
  under <ledger>.tmp-<random> then rename()s to the canonical path
  so concurrent readers never observe a partial document.

  Subcommand implementations live in cli/commands/goal/<name>.mjs.
`);
}

function parseFlags(args) {
  const flags = { _: [] };
  const values = new Set([
    '--mode', '--goal', '--threshold', '--run', '--run-id',
    '--revision', '--expected-revision', '--subgoal-id', '--weight',
    '--summary', '--evidence', '--reason', '--field', '--value',
    '--quality-gate-json', '--short-id', '--project',
  ]);
  const booleans = new Set(['--json', '--help']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleans.has(arg)) {
      // Kebab-case flags become camelCase keys: --subgoal-id -> 'subgoalId'.
      flags[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else if (values.has(arg)) {
      if (i + 1 >= args.length) {
        throw new GoalCommandError('USAGE', `${arg} requires a value`);
      }
      flags[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i];
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [name, ...rest] = arg.split('=');
      if (!values.has(name)) {
        throw new GoalCommandError('USAGE', `unknown option: ${name}`);
      }
      flags[name.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest.join('=');
    } else if (arg.startsWith('-')) {
      throw new GoalCommandError('USAGE', `unknown option: ${arg}`);
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

export class GoalCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'GoalCommandError';
  }
}

function isJson(flags) { return flags.json === true; }
function emit(result, flags) {
  if (isJson(flags)) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (typeof result.message === 'string') {
    process.stdout.write(result.message + '\n');
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
  if (result && result.ok === false) {
    process.exitCode = 1;
  }
}

/**
 * Look up the run's persisted state. `runId` may be either the full
 * UUID or the short id (`ultragoal-<short>`). Returns the parsed
 * charter + ledger position.
 */
export function loadRunState(runId, options = {}) {
  const projectRoot = options.projectRoot || options.repoRoot || REPO_ROOT;
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new GoalCommandError('USAGE', 'a non-empty --run is required');
  }
  const specsDir = join(projectRoot, 'docs', 'specs', 'ultragoal');
  if (!existsSync(specsDir)) {
    throw new GoalCommandError('NOT_FOUND', `no ultragoal specs directory at ${specsDir}`);
  }
  // Try the full UUID first, then the short id.
  const ledgerPath = join(specsDir, `${runId}.jsonl`);
  if (!existsSync(ledgerPath)) {
    // Allow the runId to omit the "ultragoal-" prefix.
    const shortPath = join(specsDir, `ultragoal-${runId}.jsonl`);
    if (existsSync(shortPath)) {
      return { ledgerPath: shortPath, runId: `ultragoal-${runId}`, specsDir };
    }
    throw new GoalCommandError('NOT_FOUND', `no ledger for run ${runId}`);
  }
  return { ledgerPath, runId, specsDir };
}

/**
 * Read the last `complete_subgoal` / `start` event from the ledger
 * to determine the current phase. Returns `null` when the ledger
 * has no `phase` field yet (i.e. only `start` events).
 */
export function readCurrentPhase(ledgerPath) {
  if (!existsSync(ledgerPath)) return null;
  const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  let phase = null;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry.phase === 'string') phase = entry.phase;
    } catch {
      // Skip malformed lines; the ledger is append-only and we
      // never want a single bad row to break phase detection.
    }
  }
  return phase;
}

export async function run(_name, args, isHelpRequest) {
  if (_name !== 'goal') return false;
  const [subcommand, ...rest] = args;
  if (isHelpRequest || !subcommand || subcommand === 'help') {
    showHelp();
    return true;
  }
  const handler = SUBCOMMANDS.get(subcommand);
  if (!handler) {
    process.stderr.write(`bizar goal: unknown subcommand "${subcommand}"\n`);
    showHelp();
    process.exitCode = 2;
    return true;
  }
  let flags;
  try {
    flags = parseFlags([subcommand, ...rest]);
  } catch (err) {
    if (err instanceof GoalCommandError) {
      emit({ ok: false, error: err.message, code: err.code }, { json: true });
      return true;
    }
    throw err;
  }
  try {
    const result = await handler(flags, { repoRoot: REPO_ROOT });
    emit(result, flags);
  } catch (err) {
    if (err instanceof GoalCommandError) {
      emit({ ok: false, error: err.message, code: err.code }, { json: true });
    } else {
      throw err;
    }
  }
  return true;
}
