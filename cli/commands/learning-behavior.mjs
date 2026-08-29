/**
 * cli/commands/learning-behavior.mjs — F-194 Phase B.3 path resolution
 * + on-disk shape helpers for the structural-fingerprint behavior ledger.
 *
 * Why a sibling module instead of importing the SDK directly:
 *   - The hook (`config/claude/hooks/worker-suggest.mjs`) runs in the
 *     installed Bizar home and must resolve the SDK via the shipped
 *     dist mirror. Importing from `../../packages/sdk/dist/...` keeps
 *     the resolution path identical to the F-191 evidence module.
 *   - Pure-JS re-exports avoid a second copy of the same constants
 *     (`BEHAVIOR_DIR_MODE`, `FORBIDDEN_BEHAVIOR_KEYS`).
 *
 * Layout:
 *   ~/.config/bizar/learning/instincts.jsonl       (existing, F-176)
 *   ~/.config/bizar/learning/reject-feedback.jsonl  (existing, F-176)
 *   ~/.config/bizar/learning/behavior.jsonl         (NEW — F-194 B.3)
 *
 * The parent `learning/` directory is created at mode `0o700`.
 */

import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  BEHAVIOR_DIR_MODE,
  createFileBehaviorCapture,
  fingerprint64,
  summarizeBehavior,
  validateBehaviorRecord,
} from '../../packages/sdk/dist/learning/behavior-capture.js';
import {
  ensureSecureDir,
  resolveSecureSubdir,
  SECURE_DIR_MODE,
} from './secure-dir.mjs';

/** Default file name for the structural-fingerprint ledger. */
export const BEHAVIOR_FILE = 'behavior.jsonl';

/** Default file names for the other two learning feeds. */
export const INSTINCTS_FILE = 'instincts.jsonl';
export const REJECT_FEEDBACK_FILE = 'reject-feedback.jsonl';

/** Resolve the learning dir with the precedence: BIZAR_LEARNING_DIR > BIZAR_HOME > XDG > ~/.config/bizar. */
export function resolveLearningDir({ cwd = process.cwd(), env = process.env } = {}) {
  return resolveSecureSubdir({
    cwd, env,
    envOverride: 'BIZAR_LEARNING_DIR',
    envSubdir: 'BIZAR_HOME',
    subdir: 'learning',
  });
}

/** Ensure the learning dir exists with mode 0o700. Idempotent. */
export function ensureLearningDir({ cwd = process.cwd(), env = process.env } = {}) {
  return ensureSecureDir({
    cwd, env,
    envOverride: 'BIZAR_LEARNING_DIR',
    envSubdir: 'BIZAR_HOME',
    subdir: 'learning',
    mode: SECURE_DIR_MODE,
  });
}

/** Path to behavior.jsonl. */
export function behaviorJsonlPath({ cwd = process.cwd(), env = process.env } = {}) {
  return join(ensureLearningDir({ cwd, env }), BEHAVIOR_FILE);
}

/**
 * Aggregate the three learning feeds into a short `additionalContext`
 * block. Order: instincts first (top-N by confidence, default 5),
 * reject-feedback second (last 3), behavior summary last.
 *
 * No prompt text is included — only worker ids, counts, and the
 * most-recent reject reason per worker.
 */
export function buildLearningContext({
  cwd = process.cwd(),
  env = process.env,
  maxInstincts = 5,
  maxRejectReasons = 3,
} = {}) {
  const dir = ensureLearningDir({ cwd, env });
  const sections = [];
  const instPath = join(dir, INSTINCTS_FILE);
  const rejPath = join(dir, REJECT_FEEDBACK_FILE);
  const behPath = join(dir, BEHAVIOR_FILE);

  if (existsSync(instPath)) {
    const rows = safeReadJsonl(instPath);
    if (rows.length > 0) {
      const top = rows
        .filter((r) => typeof r.confidence === 'number')
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, maxInstincts);
      sections.push([
        '## Instincts (top by confidence)',
        ...top.map((r) => `- [${r.id}] ${r.trigger} → ${r.action} (conf=${r.confidence})`),
      ].join('\n'));
    }
  }

  if (existsSync(rejPath)) {
    const rows = safeReadJsonl(rejPath).slice(-maxRejectReasons);
    if (rows.length > 0) {
      sections.push([
        '## Recent reject-feedback',
        ...rows.map((r) => `- ${r.workerId ?? '(unknown)'} rejected: ${r.reason ?? '(no reason)'}`),
      ].join('\n'));
    }
  }

  if (existsSync(behPath)) {
    const cap = createFileBehaviorCapture({ filePath: behPath });
    const rows = cap.list();
    if (rows.length > 0) {
      const summary = summarizeBehavior(rows);
      const lines = Object.entries(summary).map(
        ([workerId, bucket]) => `- ${workerId}: accept=${bucket.accept} reject=${bucket.reject}${bucket.lastRejectReason ? ` last-reason="${bucket.lastRejectReason}"` : ''}`,
      );
      sections.push([
        '## Behavior summary (no prompt text — counts only)',
        ...lines,
      ].join('\n'));
    }
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n');
}

/**
 * Append a `worker-suggest` row to behavior.jsonl. Called by
 * `cli/worker-dispatcher.mjs:recordSuggestion()` on every UserPromptSubmit
 * dispatch so future sessions can replay which suggestions the operator
 * accepted vs rejected.
 *
 * Q4 invariant: never persists prompt text. The `promptFingerprint` is a
 * 64-bit sha256 prefix over the canonicalized record shape, not the prompt.
 *
 * @param {{
 *   matches: Array<{ workerId: string, weight: number, agent?: string|null, skill?: string|null }>,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} args
 * @returns {boolean} true if the row was written, false on error
 *   (silent — never throw from the hook path).
 */
export function appendWorkerSuggestion({ matches, cwd, env } = {}) {
  if (!Array.isArray(matches) || matches.length === 0) return false;
  try {
    const filePath = behaviorJsonlPath({ cwd: cwd || process.cwd(), env: env || process.env });
    const capture = createFileBehaviorCapture({ filePath });
    // One row per matched worker. The fingerprint is the same across all
    // rows for a given dispatch (it identifies the prompt), and `accept`
    // starts as false — the operator's accept/reject feedback flips it later.
    const workerIds = matches.map((m) => m.workerId).sort().join(',');
    const fp = fingerprint64(`worker-suggest|${workerIds}`);
    for (const m of matches) {
      const record = {
        kind: 'worker-suggest',
        fingerprint64: fp,
        workerId: m.workerId,
        weight: m.weight,
        agent: m.agent ?? null,
        skill: m.skill ?? null,
        matchedPattern: m.matchedPattern ?? null,
        accept: false,
        timestamp: new Date().toISOString(),
      };
      validateBehaviorRecord(record);
      capture.append(record);
    }
    return true;
  } catch (err) {
    process.stderr.write(
      `[bizar.learning] WARN: appendWorkerSuggestion failed: ${err?.message ?? String(err)}\n`,
    );
    return false;
  }
}

function safeReadJsonl(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return rows;
}