/**
 * cli/commands/goal/start.mjs — `bizar goal start` subcommand.
 *
 * Starts a new ultragoal run. Writes the charter markdown to
 * `docs/specs/ultragoal-<id>.md` and the first ledger event to
 * `docs/specs/ultragoal/<id>.jsonl` atomically per DEC-022.
 *
 * Required flags:
 *   --mode aggregate|per-story
 *   --goal "<text>"
 *   [--threshold 1.0]          defaults to 1.0
 *   [--run <uuid>]              if omitted, derives a short id
 */

import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { GoalCommandError } from '../goal.mjs';
import { atomicWriteText, atomicAppendJsonl } from './_atomic.mjs';

const ALLOWED_MODES = new Set(['aggregate', 'per-story']);
const DEFAULT_THRESHOLD = 1.0;
const SHORT_ID_LENGTH = 8;

function deriveShortId() {
  return randomUUID().replace(/-/g, '').slice(0, SHORT_ID_LENGTH);
}

function chooseRunId(flags) {
  if (typeof flags.run === 'string' && flags.run.trim()) {
    return flags.run.trim();
  }
  return `ultragoal-${deriveShortId()}`;
}

function validateMode(mode) {
  if (typeof mode !== 'string' || !mode.trim()) {
    throw new GoalCommandError('USAGE', '--mode is required (aggregate | per-story)');
  }
  if (!ALLOWED_MODES.has(mode)) {
    throw new GoalCommandError(
      'USAGE',
      `--mode must be one of: ${Array.from(ALLOWED_MODES).join(', ')}`,
    );
  }
  return mode;
}

function validateGoal(goal) {
  if (typeof goal !== 'string' || !goal.trim()) {
    throw new GoalCommandError('USAGE', '--goal is required and must be a non-empty string');
  }
  return goal;
}

function parseThreshold(value) {
  if (value === undefined) return DEFAULT_THRESHOLD;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new GoalCommandError('USAGE', '--threshold must be a positive number');
  }
  return n;
}

function renderCharter({ runId, mode, goal, threshold, startedAt }) {
  return [
    `# Ultragoal charter — ${runId}`,
    '',
    `- **Run id**: \`${runId}\``,
    `- **Run uuid**: \`${runId}\``,
    `- **Started**: ${startedAt}`,
    `- **Mode**: \`${mode}\``,
    `- **Completion threshold**: ${threshold}`,
    '',
    '## Goal',
    '',
    goal,
    '',
    '## Provenance',
    '',
    `Charter written by \`bizar goal start --mode ${mode}\` per DEC-022.`,
    `Ledger lives at \`docs/specs/ultragoal/${runId}.jsonl\`.`,
    '',
  ].join('\n');
}

export async function runStart(flags, { repoRoot }) {
  const mode = validateMode(flags.mode);
  const goal = validateGoal(flags.goal);
  const threshold = parseThreshold(flags.threshold);
  const runId = chooseRunId(flags);
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const specsDir = join(repoRoot, 'docs', 'specs', 'ultragoal');
  const ledgerPath = join(specsDir, `${runId}.jsonl`);
  const charterPath = join(repoRoot, 'docs', 'specs', `ultragoal-${runId}.md`);

  if (existsSync(ledgerPath) || existsSync(charterPath)) {
    throw new GoalCommandError(
      'ALREADY_EXISTS',
      `run ${runId} already exists (ledger: ${ledgerPath})`,
    );
  }

  mkdirSync(specsDir, { recursive: true });

  // Atomic write ledger first (small file, fast), then charter.
  // The ledger is JSONL: one event per line, newline-terminated. The
  // start event seeds the ledger with a single line; subsequent
  // steer/checkpoint/complete events append via atomicAppendJsonl.
  const ledgerEntry = {
    ts: startedAt,
    phase: 'planning',
    event: 'start',
    runId,
    mode,
    completionThreshold: threshold,
    charter: `docs/specs/ultragoal-${runId}.md`,
    operatorNote: 'created by bizar goal start',
  };
  atomicAppendJsonl(ledgerPath, ledgerEntry);

  const charter = renderCharter({ runId, mode, goal, threshold, startedAt });
  atomicWriteText(charterPath, charter);

  return {
    ok: true,
    runId,
    mode,
    phase: 'planning',
    threshold,
    ledgerPath: `docs/specs/ultragoal/${runId}.jsonl`,
    charterPath: `docs/specs/ultragoal-${runId}.md`,
    message: `bizar goal: started run ${runId} (mode=${mode}, threshold=${threshold})`,
  };
}
