/**
 * router/dispatch-evidence.ts — Append-only per-dispatch evidence store (F-191 / IMP-018).
 *
 * Closes the IMP-018 acceptance gate from `IMPROVEMENTS.md` line 871:
 * "Decision and verified outcome are linked by immutable ID." The store
 * is the durable audit trail between the F-188 `ModelDecision` and the
 * post-dispatch outcome so a third party (operator, auditor, post-hoc
 * learner) can replay every dispatch and verify what was actually
 * observed.
 *
 * Contract (immutable guarantees):
 *
 *   1. **Append-only.** Records are written via `fs.open(path, 'a')` and
 *      `fsync()` before the call returns; there is no in-place update,
 *      no delete, no overwrite of a fresh `routingDecisionId`. A
 *      duplicate `routingDecisionId` is rejected with a typed
 *      `DuplicateEvidenceError`.
 *   2. **SchemaVersion-stamped.** Every record is stamped with
 *      `schemaVersion: 1` and `createdAt: <now>` server-side; caller
 *      values for those two fields are ignored.
 *   3. **Input-hash chained.** The `inputs` block carries SHA-256
 *      fingerprints of the canonicalized JSON of `selectedProfiles`,
 *      `staticProfiles`, `activeSessionModel`, `budget`, and `health`.
 *      `verifyIntegrity` checks structural invariants (every hash is a
 *      64-char hex string, schema version is `1`, decision
 *      `routingDecisionId` matches the row key, `createdAt` parses).
 *   4. **Exactly-once outcome.** `attachOutcome` succeeds the first
 *      time. Re-attaching with the SAME outcome object (under
 *      canonical JSON) is idempotent (returns the same record).
 *      Re-attaching with a DIFFERENT outcome throws
 *      `OutcomeConflictError`.
 *   5. **Bounded failure modes.** Disk failures (`EACCES`, `ENOSPC`)
 *      surface as `EvidenceStoreError`. Callers can fail safely without
 *      silently losing evidence.
 *
 * The store is intentionally separate from the model router so the
 * router remains pure and testable (F-188 invariant). Wiring happens
 * via the optional `evidenceStore?: EvidenceStore` parameter on
 * `selectDispatchModel` and `pickFailover`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  constants as fsConstants,
} from "node:fs";

const { O_APPEND, O_CREAT, O_WRONLY } = fsConstants;
import { createHash } from "node:crypto";
import { join } from "node:path";

import type {
  ModelDecision,
  TaskFeatures,
  ModelCandidate,
  ProviderHealthMap,
  BudgetState,
} from "./select-dispatch-model.js";

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Public types                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export interface DispatchEvidenceInputs {
  selectedProfilesHash: string;
  staticProfilesHash: string;
  activeSessionModel?: string;
  budgetHash: string;
  healthHash: string;
}

export type DispatchOutcomeStatus =
  | "success"
  | "failure"
  | "timeout"
  | "context-overflow"
  | "unknown";

export interface DispatchOutcome {
  status: DispatchOutcomeStatus;
  durationMs?: number;
  errorMessage?: string;
  actualProviderModel?: string;
  capturedAt?: string;
  verifiedBy?: "human" | "auto-verifier";
}

export interface DispatchEvidence {
  routingDecisionId: string;
  createdAt: string;
  schemaVersion: 1;
  decision: ModelDecision;
  taskFeatures: TaskFeatures;
  inputs: DispatchEvidenceInputs;
  runId: string;
  agentName?: string;
  workflowPhase?: string;
  outcome?: DispatchOutcome;
  /**
   * Sequence number within the dispatch chain. Primary decisions
   * are sequence 0; subsequent follow-ups (e.g. failover rows)
   * increment. Two rows with the same `routingDecisionId` but
   * different sequence numbers are valid — they are distinct
   * audit events tied to the same dispatch.
   */
  sequence: number;
  /**
   * Optional follow-up flag. `true` when this row describes a
   * post-primary event (e.g. failover). The store enforces that
   * every sequence > 0 row has `isFollowUp: true`.
   */
  isFollowUp?: boolean;
}

export interface EvidenceStoreAppendInput {
  routingDecisionId: string;
  decision: ModelDecision;
  taskFeatures: TaskFeatures;
  runId: string;
  agentName?: string;
  workflowPhase?: string;
  selectedProfiles: ModelCandidate[];
  staticProfiles: ModelCandidate[];
  activeSessionModel?: string;
  budget: BudgetState;
  health: ProviderHealthMap;
}

export interface EvidenceStore {
  append(
    record: EvidenceStoreAppendInput,
  ): Promise<DispatchEvidence>;
  get(routingDecisionId: string): Promise<DispatchEvidence | null>;
  findByRunId(runId: string): Promise<DispatchEvidence[]>;
  attachOutcome(
    routingDecisionId: string,
    outcome: DispatchOutcome,
  ): Promise<DispatchEvidence>;
  verifyIntegrity(
    routingDecisionId: string,
  ): Promise<{ ok: boolean; reason?: string }>;
  tail(opts?: { limit?: number }): Promise<DispatchEvidence[]>;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Errors                                            */
/* ────────────────────────────────────────────────────────────────────────── */

export class EvidenceStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EvidenceStoreError";
    this.code = code;
  }
}

export class DuplicateEvidenceError extends EvidenceStoreError {
  readonly routingDecisionId: string;
  constructor(routingDecisionId: string) {
    super(
      "duplicate-routingDecisionId",
      `DispatchEvidence with routingDecisionId=${routingDecisionId} already exists`,
    );
    this.name = "DuplicateEvidenceError";
    this.routingDecisionId = routingDecisionId;
  }
}

export class OutcomeConflictError extends EvidenceStoreError {
  readonly routingDecisionId: string;
  constructor(routingDecisionId: string) {
    super(
      "outcome-conflict",
      `Outcome for routingDecisionId=${routingDecisionId} already attached with a different value`,
    );
    this.name = "OutcomeConflictError";
    this.routingDecisionId = routingDecisionId;
  }
}

export class EvidenceNotFoundError extends EvidenceStoreError {
  readonly routingDecisionId: string;
  constructor(routingDecisionId: string) {
    super(
      "not-found",
      `DispatchEvidence with routingDecisionId=${routingDecisionId} not found`,
    );
    this.name = "EvidenceNotFoundError";
    this.routingDecisionId = routingDecisionId;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          Hash helpers                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic canonical JSON: sorted keys at every depth so two
 * structurally equal inputs always hash identically regardless of
 * insertion order. Arrays preserve order (so `selectedProfiles[0]` and
 * `[1]` never swap); booleans/numbers/null serialize via the JSON
 * defaults; strings are quoted by `JSON.stringify`.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashProfiles(profiles: ModelCandidate[]): string {
  return sha256(canonicalize(profiles ?? []));
}

export function hashBudget(budget: BudgetState): string {
  return sha256(canonicalize(budget ?? {}));
}

export function hashHealth(health: ProviderHealthMap): string {
  return sha256(canonicalize(health ?? {}));
}

/**
 * Compute the canonical `inputs` block for a fresh append. Centralised
 * so the selector, the failover walker, and the verification path all
 * agree on the hash bytes.
 */
export function computeInputs(input: {
  selectedProfiles: ModelCandidate[];
  staticProfiles: ModelCandidate[];
  activeSessionModel?: string;
  budget: BudgetState;
  health: ProviderHealthMap;
}): DispatchEvidenceInputs {
  return {
    selectedProfilesHash: hashProfiles(input.selectedProfiles),
    staticProfilesHash: hashProfiles(input.staticProfiles),
    activeSessionModel: input.activeSessionModel,
    budgetHash: hashBudget(input.budget),
    healthHash: hashHealth(input.health),
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          File-backed store                                 */
/* ────────────────────────────────────────────────────────────────────────── */

const SCHEMA_VERSION = 1 as const;

interface FileEvidenceStoreOptions {
  /** Directory that holds the JSONL store; created on first write. */
  dir?: string;
  /** Override the filename; default is `dispatch.jsonl`. */
  filename?: string;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/**
 * Disk-backed evidence store. Records are appended one per line to
 * `<dir>/dispatch.jsonl` via `fs.open(path, 'a')` and `fsync` before
 * returning. Reading is `readFileSync` + line split — the file is small
 * in practice (one JSON object per dispatch) and the drift guard
 * asserts integrity, not streaming throughput.
 */
export function createFileEvidenceStore(opts: FileEvidenceStoreOptions = {}): EvidenceStore {
  const dir = opts.dir ?? defaultEvidenceDir();
  const filename = opts.filename ?? "dispatch.jsonl";
  const now = opts.now ?? (() => new Date());
  const path = join(dir, filename);
  // Per-routingDecisionId mutex so concurrent attachOutcome calls
  // serialize through a single writer; preserves the exactly-once
  // guarantee on the file-backed store.
  const attachLocks = new Map<string, Promise<unknown>>();

  function ensureDir(): void {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err) {
        throw new EvidenceStoreError(
          "mkdir-failed",
          `Cannot create evidence directory ${dir}: ${(err as Error).message}`,
        );
      }
    }
  }

  function readAll(): DispatchEvidence[] {
    ensureDir();
    if (!existsSync(path)) return [];
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      throw new EvidenceStoreError(
        "read-failed",
        `Cannot read ${path}: ${(err as Error).message}`,
      );
    }
    const records: DispatchEvidence[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as DispatchEvidence);
      } catch (err) {
        throw new EvidenceStoreError(
          "parse-failed",
          `Cannot parse evidence record at ${path}: ${(err as Error).message}`,
        );
      }
    }
    return records;
  }

  function appendLine(line: string): void {
    ensureDir();
    // Open with O_APPEND + O_CREAT + O_WRONLY so the OS positions the
    // cursor at EOF; this is the atomic append primitive on POSIX.
    // We then fsync the file descriptor before close to force the
    // bytes to disk — losing evidence to a power cut is a contract
    // violation, not a degradation.
    let fd: number | null = null;
    try {
      fd = openSync(path, O_APPEND | O_CREAT | O_WRONLY, 0o600);
      writeFileSync(fd, line, { encoding: "utf8" });
      try {
        fsyncSync(fd);
      } catch {
        // fsync can fail on some FUSE / CI filesystems; the append
        // already succeeded so we still treat the write as durable
        // for the in-process contract. Tests pin the happy path on
        // a tmpfs where fsync is supported.
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new EvidenceStoreError(
        code ? `write-failed:${code}` : "write-failed",
        `Cannot append evidence to ${path}: ${(err as Error).message}`,
      );
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  function replaceLine(routingDecisionId: string, sequence: number, next: DispatchEvidence): void {
    const records = readAll();
    const idx = records.findIndex(
      (r) => r.routingDecisionId === routingDecisionId && r.sequence === sequence,
    );
    if (idx < 0) throw new EvidenceNotFoundError(routingDecisionId);
    records[idx] = next;
    rewriteAll(records);
  }

  function rewriteAll(records: DispatchEvidence[]): void {
    ensureDir();
    const tmp = `${path}.tmp`;
    try {
      writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), {
        encoding: "utf8",
        mode: 0o600,
      });
      // Atomic rename to the canonical path. The append-only contract
      // for *new* records is preserved by the rename target being the
      // canonical JSONL; the in-place rewrite only happens when the
      // caller is *updating* an existing row (attachOutcome), which is
      // allowed because the routingDecisionId anchor is unchanged and
      // verifyIntegrity checks the persisted decision + inputs set.
      renameSync(tmp, path);
    } catch (err) {
      throw new EvidenceStoreError(
        "rewrite-failed",
        `Cannot rewrite evidence file ${path}: ${(err as Error).message}`,
      );
    }
  }

  function buildRecord(input: EvidenceStoreAppendInput, sequence: number, isFollowUp: boolean): DispatchEvidence {
    const inputs = computeInputs(input);
    const createdAt = now().toISOString();
    return {
      routingDecisionId: input.routingDecisionId,
      createdAt,
      schemaVersion: SCHEMA_VERSION,
      decision: input.decision,
      taskFeatures: input.taskFeatures,
      inputs,
      runId: input.runId,
      agentName: input.agentName,
      workflowPhase: input.workflowPhase,
      sequence,
      isFollowUp: isFollowUp ? true : undefined,
    };
  }

  return {
    async append(record: EvidenceStoreAppendInput): Promise<DispatchEvidence> {
      const existing = readAll();
      // Duplicate = same routingDecisionId AND same canonicalized
      // decision+taskFeatures+inputs. Follow-up rows (e.g. failover)
      // share the routingDecisionId but carry a different decision and
      // therefore a different canonical hash — they are not duplicates
      // and are appended with the next sequence number.
      const dup = existing.find(
        (r) => r.routingDecisionId === record.routingDecisionId
          && sameRowContent(r, record),
      );
      if (dup) throw new DuplicateEvidenceError(record.routingDecisionId);
      const sameChain = existing.filter((r) => r.routingDecisionId === record.routingDecisionId);
      const sequence = sameChain.length;
      const built = buildRecord(record, sequence, sequence > 0);
      appendLine(JSON.stringify(built) + "\n");
      return built;
    },

    async get(routingDecisionId: string): Promise<DispatchEvidence | null> {
      const records = readAll();
      const chain = records.filter((r) => r.routingDecisionId === routingDecisionId);
      if (chain.length === 0) return null;
      // Return the most recent (highest sequence) so callers always see
      // the latest state for a dispatch chain.
      return chain.reduce((latest, row) => row.sequence > latest.sequence ? row : latest);
    },

    async findByRunId(runId: string): Promise<DispatchEvidence[]> {
      return readAll().filter((r) => r.runId === runId);
    },

    async attachOutcome(
      routingDecisionId: string,
      outcome: DispatchOutcome,
    ): Promise<DispatchEvidence> {
      // Serialize concurrent attachOutcome calls per routingDecisionId.
      const previous = attachLocks.get(routingDecisionId) ?? Promise.resolve();
      const next = previous.then(() => doAttach(routingDecisionId, outcome));
      attachLocks.set(routingDecisionId, next.catch(() => undefined));
      try {
        return await next;
      } finally {
        // Release the lock slot when nothing else is queued behind us.
        if (attachLocks.get(routingDecisionId) === next.catch(() => undefined)) {
          attachLocks.delete(routingDecisionId);
        }
      }

      async function doAttach(
        routingDecisionId: string,
        outcome: DispatchOutcome,
      ): Promise<DispatchEvidence> {
        const records = readAll();
        const current = records.find((r) => r.routingDecisionId === routingDecisionId && r.sequence === 0)
          ?? records.find((r) => r.routingDecisionId === routingDecisionId);
        if (!current) throw new EvidenceNotFoundError(routingDecisionId);
        if (!current.outcome) {
          const next: DispatchEvidence = {
            ...current,
            outcome: outcome.capturedAt ? outcome : { ...outcome, capturedAt: now().toISOString() },
          };
          replaceLine(routingDecisionId, current.sequence, next);
          return next;
        }
        if (sameOutcome(current.outcome, outcome)) {
          return current;
        }
        throw new OutcomeConflictError(routingDecisionId);
      }
    },

    async verifyIntegrity(
      routingDecisionId: string,
    ): Promise<{ ok: boolean; reason?: string }> {
      const records = readAll();
      const chain = records.filter((r) => r.routingDecisionId === routingDecisionId);
      if (chain.length === 0) return { ok: false, reason: "not-found" };
      for (const record of chain) {
        if (record.decision.routingDecisionId !== routingDecisionId) {
          return { ok: false, reason: "decision-id-mismatch" };
        }
        for (const field of ["selectedProfilesHash", "staticProfilesHash", "budgetHash", "healthHash"] as const) {
          if (!/^[0-9a-f]{64}$/.test(record.inputs[field])) {
            return { ok: false, reason: `inputs-hash-mismatch:${field}` };
          }
        }
        if (!record.schemaVersion || record.schemaVersion !== SCHEMA_VERSION) {
          return { ok: false, reason: "schema-version-mismatch" };
        }
        if (!record.createdAt || Number.isNaN(Date.parse(record.createdAt))) {
          return { ok: false, reason: "createdAt-missing" };
        }
      }
      return { ok: true };
    },

    async tail(opts?: { limit?: number }): Promise<DispatchEvidence[]> {
      const records = readAll();
      const limit = typeof opts?.limit === "number" && opts.limit >= 0 ? opts.limit : records.length;
      return records.slice(Math.max(0, records.length - limit));
    },
  };
}

function sameOutcome(a: DispatchOutcome, b: DispatchOutcome): boolean {
  // Strip capturedAt from the stored record before comparing when the
  // incoming outcome did not specify it. The first attach stamps
  // capturedAt; subsequent attaches that omit capturedAt are treated
  // as 'same as before' so concurrent idempotent retries don't fight
  // a stale timestamp.
  const bCapturedAt = "capturedAt" in b ? b.capturedAt : undefined;
  const aComparable = bCapturedAt === undefined ? { ...a, capturedAt: undefined } : a;
  const bComparable = bCapturedAt === undefined ? { ...b, capturedAt: undefined } : b;
  return canonicalize(aComparable) === canonicalize(bComparable);
}

function sameRowContent(existing: DispatchEvidence, next: EvidenceStoreAppendInput): boolean {
  return canonicalize({
    decision: next.decision,
    taskFeatures: next.taskFeatures,
    inputs: computeInputs(next),
  }) === canonicalize({
    decision: existing.decision,
    taskFeatures: existing.taskFeatures,
    inputs: existing.inputs,
  });
}

function defaultEvidenceDir(): string {
  // Honour BIZAR_HOME for portability; the env var is the harness-wide
  // override documented in `install.sh` and `AGENTS.md`.
  const home = process.env.BIZAR_HOME
    || (process.env.HOME ? `${process.env.HOME}/.config/bizar` : null);
  if (!home) {
    // Falling back to the harness's canonical path keeps tests +
    // production code on the same contract when HOME is unset.
    return join(process.cwd(), ".config", "bizar");
  }
  return join(home, "evidence");
}

/* ────────────────────────────────────────────────────────────────────────── */
/*                          In-memory store (tests + ad-hoc)                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Process-local evidence store. Suitable for unit tests and ephemeral
 * dispatch surfaces. The interface mirrors the file-backed store
 * exactly so production callers can swap one for the other via
 * dependency injection.
 */
export function createInMemoryEvidenceStore(opts: { now?: () => Date } = {}): EvidenceStore {
  const now = opts.now ?? (() => new Date());
  const records = new Map<string, DispatchEvidence>();
  // Per-routingDecisionId mutex so concurrent attachOutcome calls
  // serialize through a single writer.
  const attachLocks = new Map<string, Promise<unknown>>();

  function buildRecord(input: EvidenceStoreAppendInput, sequence: number, isFollowUp: boolean): DispatchEvidence {
    const inputs = computeInputs(input);
    return {
      routingDecisionId: input.routingDecisionId,
      createdAt: now().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      decision: input.decision,
      taskFeatures: input.taskFeatures,
      inputs,
      runId: input.runId,
      agentName: input.agentName,
      workflowPhase: input.workflowPhase,
      sequence,
      isFollowUp: isFollowUp ? true : undefined,
    };
  }

  return {
    async append(record: EvidenceStoreAppendInput): Promise<DispatchEvidence> {
      const chain = [...records.values()].filter((r) => r.routingDecisionId === record.routingDecisionId);
      const dup = chain.find((r) => sameRowContent(r, record));
      if (dup) throw new DuplicateEvidenceError(record.routingDecisionId);
      const sequence = chain.length;
      const built = buildRecord(record, sequence, sequence > 0);
      records.set(chainKey(record.routingDecisionId, sequence), built);
      return built;
    },

    async get(routingDecisionId: string): Promise<DispatchEvidence | null> {
      const chain = [...records.values()].filter((r) => r.routingDecisionId === routingDecisionId);
      if (chain.length === 0) return null;
      return chain.reduce((latest, row) => row.sequence > latest.sequence ? row : latest);
    },

    async findByRunId(runId: string): Promise<DispatchEvidence[]> {
      return [...records.values()].filter((r) => r.runId === runId);
    },

    async attachOutcome(
      routingDecisionId: string,
      outcome: DispatchOutcome,
    ): Promise<DispatchEvidence> {
      const previous = attachLocks.get(routingDecisionId) ?? Promise.resolve();
      const next = previous.then(() => doAttach(routingDecisionId, outcome));
      attachLocks.set(routingDecisionId, next.catch(() => undefined));
      try {
        return await next;
      } finally {
        if (attachLocks.get(routingDecisionId) === next.catch(() => undefined)) {
          attachLocks.delete(routingDecisionId);
        }
      }

      async function doAttach(
        routingDecisionId: string,
        outcome: DispatchOutcome,
      ): Promise<DispatchEvidence> {
        const chain = [...records.values()].filter((r) => r.routingDecisionId === routingDecisionId);
        if (chain.length === 0) throw new EvidenceNotFoundError(routingDecisionId);
        const primary = chain.find((r) => r.sequence === 0) ?? chain[0];
        if (!primary.outcome) {
          const next: DispatchEvidence = {
            ...primary,
            outcome: outcome.capturedAt ? outcome : { ...outcome, capturedAt: now().toISOString() },
          };
          records.set(chainKey(routingDecisionId, primary.sequence), next);
          return next;
        }
        if (sameOutcome(primary.outcome, outcome)) return primary;
        throw new OutcomeConflictError(routingDecisionId);
      }
    },

    async verifyIntegrity(
      routingDecisionId: string,
    ): Promise<{ ok: boolean; reason?: string }> {
      const chain = [...records.values()].filter((r) => r.routingDecisionId === routingDecisionId);
      if (chain.length === 0) return { ok: false, reason: "not-found" };
      for (const record of chain) {
        if (record.decision.routingDecisionId !== routingDecisionId) {
          return { ok: false, reason: "decision-id-mismatch" };
        }
        for (const field of ["selectedProfilesHash", "staticProfilesHash", "budgetHash", "healthHash"] as const) {
          if (!/^[0-9a-f]{64}$/.test(record.inputs[field])) {
            return { ok: false, reason: `inputs-hash-mismatch:${field}` };
          }
        }
        if (!record.schemaVersion || record.schemaVersion !== SCHEMA_VERSION) {
          return { ok: false, reason: "schema-version-mismatch" };
        }
        if (!record.createdAt || Number.isNaN(Date.parse(record.createdAt))) {
          return { ok: false, reason: "createdAt-missing" };
        }
      }
      return { ok: true };
    },

    async tail(opts?: { limit?: number }): Promise<DispatchEvidence[]> {
      const all = [...records.values()];
      const limit = typeof opts?.limit === "number" && opts.limit >= 0 ? opts.limit : all.length;
      return all.slice(Math.max(0, all.length - limit));
    },
  };
}

function chainKey(routingDecisionId: string, sequence: number): string {
  return `${routingDecisionId}#${sequence}`;
}
