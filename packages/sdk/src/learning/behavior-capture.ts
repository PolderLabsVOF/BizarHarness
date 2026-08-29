/**
 * learning/behavior-capture.ts — User-input behavior capture (F-194, Phase B.3).
 *
 * Records structural-fingerprint-only observations about user prompts so
 * `worker-suggest.mjs` can adapt its routing without leaking PII.
 *
 * Per Q4 resolution: **no prompt text field of any kind is persisted.**
 * Each row carries only:
 *
 *   {
 *     fingerprint64: string;  // sha256(canonicalizedPrompt).slice(0, 16)
 *     workerId: string;       // e.g. "mike", "linda", "todd", ...
 *     accept: boolean;        // user accepted the dispatch without editing
 *     rejectReason?: string;  // free-text reason the user rejected (no prompt)
 *     timestamp: string;       // ISO 8601 server-stamped
 *   }
 *
 * The `prompt` / `promptRedacted` / `rawPrompt` field names are reserved
 * FORBIDDEN KEYS at the type level (see {@link FORBIDDEN_BEHAVIOR_KEYS})
 * so a typo or a regression cannot accidentally start writing prompt
 * text to disk. `behavior-capture-drift.test.mjs` enforces the same
 * invariant at the file-system level.
 *
 * Why no prompt text at all:
 *   - Operators with multi-tenant Bizar installs must not have other
 *     users' prompts sitting on disk.
 *   - The structural fingerprint is sufficient for the learner's
 *     accept/reject correlation: two prompts that share a fingerprint
 *     are observably equivalent and the learner treats them as one
 *     signal.
 *   - Removes the entire redaction layer (correction #11) — if the
 *     sensitive bytes never reach disk, there is nothing to redact.
 *
 * Invariants:
 *   - `fingerprint64` is exactly 16 hex chars (64 bits).
 *   - `workerId` is a non-empty string.
 *   - `timestamp` is server-stamped via `new Date().toISOString()`.
 *   - `createFileBehaviorCapture` creates the parent dir with mode
 *     `0o700` so the on-disk ledger stays operator-readable only.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";

/** Mode applied to the parent dir of any file-backed capture. */
export const BEHAVIOR_DIR_MODE = 0o700;

/**
 * Reserved FORBIDDEN field names. Any record that contains one of
 * these keys is rejected by `validateBehaviorRecord` so a regression
 * cannot accidentally start writing prompt text.
 */
export const FORBIDDEN_BEHAVIOR_KEYS: ReadonlyArray<string> = [
  "prompt",
  "promptRedacted",
  "rawPrompt",
  "promptText",
  "userInput",
  "raw_input",
] as const;

/** Structural-fingerprint-only observation of one user-input event. */
export interface BehaviorRecord {
  /** sha256(canonicalizedPrompt).slice(0, 16) — 64-bit hex. */
  readonly fingerprint64: string;
  /** Worker the user accepted or rejected (e.g. "mike", "linda"). */
  readonly workerId: string;
  /** true = user accepted the dispatch without editing; false = rejected. */
  readonly accept: boolean;
  /** Optional free-text reason the user rejected the dispatch. */
  readonly rejectReason?: string;
  /** Server-stamped ISO 8601 timestamp. */
  readonly timestamp: string;
}

/**
 * Compute the 64-bit hex fingerprint of a prompt. The prompt text is
 * canonicalized (collapsed whitespace) before hashing so two prompts
 * that differ only by trivial whitespace map to the same fingerprint.
 */
export function fingerprint64(prompt: string): string {
  if (typeof prompt !== "string") {
    throw new TypeError("fingerprint64: prompt must be a string");
  }
  const canonical = prompt.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Validate a BehaviorRecord. Throws on any forbidden key or bad shape. */
export function validateBehaviorRecord(record: unknown): asserts record is BehaviorRecord {
  if (!record || typeof record !== "object") {
    throw new TypeError("validateBehaviorRecord: record must be an object");
  }
  const r = record as Record<string, unknown>;
  for (const key of FORBIDDEN_BEHAVIOR_KEYS) {
    if (key in r) {
      throw new TypeError(
        `validateBehaviorRecord: forbidden key "${key}" — Q4 resolution forbids persisting prompt text`,
      );
    }
  }
  if (typeof r.fingerprint64 !== "string" || !/^[0-9a-f]{16}$/.test(r.fingerprint64)) {
    throw new TypeError("validateBehaviorRecord: fingerprint64 must be 16 lowercase hex chars");
  }
  if (typeof r.workerId !== "string" || r.workerId.length === 0) {
    throw new TypeError("validateBehaviorRecord: workerId must be a non-empty string");
  }
  if (typeof r.accept !== "boolean") {
    throw new TypeError("validateBehaviorRecord: accept must be a boolean");
  }
  if (r.rejectReason !== undefined && typeof r.rejectReason !== "string") {
    throw new TypeError("validateBehaviorRecord: rejectReason must be a string when present");
  }
  if (typeof r.timestamp !== "string" || r.timestamp.length === 0) {
    throw new TypeError("validateBehaviorRecord: timestamp must be a non-empty ISO 8601 string");
  }
}

/** Build a new BehaviorRecord. Server-stamps the timestamp. */
export function createBehaviorRecord({
  fingerprint,
  workerId,
  accept,
  rejectReason,
}: {
  fingerprint: string;
  workerId: string;
  accept: boolean;
  rejectReason?: string;
}): BehaviorRecord {
  const record = {
    fingerprint64: fingerprint,
    workerId,
    accept,
    ...(rejectReason ? { rejectReason } : {}),
    timestamp: new Date().toISOString(),
  };
  validateBehaviorRecord(record);
  return record;
}

/** In-memory behavior capture — array-backed, useful for tests + workers. */
export interface BehaviorCapture {
  readonly append: (record: BehaviorRecord) => void;
  readonly list: () => ReadonlyArray<BehaviorRecord>;
  readonly size: () => number;
}

export function createInMemoryBehaviorCapture(): BehaviorCapture {
  const rows: BehaviorRecord[] = [];
  return {
    append(record) {
      validateBehaviorRecord(record);
      rows.push(record);
    },
    list() {
      return rows.slice();
    },
    size() {
      return rows.length;
    },
  };
}

/** File-backed behavior capture — append-only JSONL at mode 0o700. */
export interface FileBehaviorCapture extends BehaviorCapture {
  readonly path: string;
}

export function createFileBehaviorCapture({ filePath }: { filePath: string }): FileBehaviorCapture {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new TypeError("createFileBehaviorCapture: filePath must be a non-empty string");
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: BEHAVIOR_DIR_MODE });
  } else {
    try {
      const cur = statSync(dir).mode & 0o777;
      if (cur !== BEHAVIOR_DIR_MODE) chmodSync(dir, BEHAVIOR_DIR_MODE);
    } catch { /* non-fatal on Windows */ }
  }
  const rows: BehaviorRecord[] = [];
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          validateBehaviorRecord(obj);
          rows.push(obj);
        } catch {
          // Skip malformed / forbidden-key rows; do not crash the writer.
        }
      }
    } catch { /* ignore read errors on first write */ }
  }
  return {
    path: filePath,
    append(record) {
      validateBehaviorRecord(record);
      appendFileSync(filePath, JSON.stringify(record) + "\n", { mode: BEHAVIOR_DIR_MODE });
      rows.push(record);
    },
    list() {
      return rows.slice();
    },
    size() {
      return rows.length;
    },
  };
}

/**
 * Aggregate a list of BehaviorRecords into a compact summary suitable
 * for `additionalContext`. Returns `{ workerId: { accept: number,
 * reject: number, lastReason? } }`. No prompt text appears in the
 * summary; only counts + a single most-recent reject reason per worker.
 */
export interface WorkerBehaviorSummary {
  [workerId: string]: {
    accept: number;
    reject: number;
    lastRejectReason?: string;
  };
}

export function summarizeBehavior(records: ReadonlyArray<BehaviorRecord>): WorkerBehaviorSummary {
  const out: WorkerBehaviorSummary = {};
  for (const r of records) {
    let bucket = out[r.workerId];
    if (!bucket) {
      bucket = { accept: 0, reject: 0 };
      out[r.workerId] = bucket;
    }
    if (r.accept) {
      bucket.accept += 1;
    } else {
      bucket.reject += 1;
      if (r.rejectReason) bucket.lastRejectReason = r.rejectReason;
    }
  }
  return out;
}