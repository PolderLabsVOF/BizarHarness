/**
 * federation/audit.ts — AuditService: NDJSON log of every
 * federation decision.
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/domain/services/audit-service.ts`
 * stripped to the parts the skeleton needs:
 *
 *   - record(envelope, decision) appends ONE NDJSON line to
 *     `.harness/federation-audit.log`.
 *   - When the file exceeds 10 MB, it rotates to
 *     `.harness/federation-audit.log.1` (single generation).
 *   - tail() reads the last N lines for the `federation_status` MCP tool.
 *   - size() returns the on-disk file size for the status payload.
 *
 * Writes are synchronous (fs.appendFileSync) — the skeleton is
 * in-process and not throughput-bound; an async path would only
 * complicate testing.
 *
 * The `.harness/` directory is created on first write. The audit
 * log file is added to `.gitignore` by the Makefile/install step.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** Default audit log path — colocated with the rest of `.harness/`. */
export const DEFAULT_AUDIT_PATH = ".harness/federation-audit.log";

/** Rotate when the file exceeds this size. */
const ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Tail size cap — protects against reading gigabytes into memory. */
const TAIL_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/** Decisions recorded by the orchestrator — matches the schema the
 *  `federation_status` MCP tool reads back. */
export type AuditDecision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string };

export interface AuditEntry {
  readonly ts: string;
  readonly envelopeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly messageType: string;
  readonly nonce: string;
  readonly allowed: boolean;
  readonly reason: string;
  readonly layer: "trust" | "policy" | "hmac" | "budget" | "received" | "sent";
  readonly nodeId: string;
}

export interface AuditServiceOpts {
  /** Override the audit file path (defaults to .harness/federation-audit.log). */
  readonly path?: string;
  /** Local nodeId stamped into every entry. */
  readonly nodeId: string;
}

export class AuditService {
  private readonly path: string;
  private readonly nodeId: string;
  private rotated = false;

  constructor(opts: AuditServiceOpts) {
    if (!opts || typeof opts.nodeId !== "string" || opts.nodeId.length === 0) {
      throw new Error("AuditService: nodeId is required");
    }
    this.path = opts.path ?? DEFAULT_AUDIT_PATH;
    this.nodeId = opts.nodeId;
  }

  getPath(): string {
    return this.path;
  }

  /** Append an NDJSON line. Triggers rotation if the file would
   *  exceed the threshold after the write. */
  record(entry: Omit<AuditEntry, "nodeId">): void {
    const full: AuditEntry = { ...entry, nodeId: this.nodeId };
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Pre-write rotation check: if appending would exceed the
    // threshold AND we haven't already rotated this session, rotate
    // first. We keep a single generation (`.log.1`); older logs
    // are the operator's responsibility (or a separate cron).
    if (!this.rotated && existsSync(this.path)) {
      try {
        const size = statSync(this.path).size;
        if (size + 256 > ROTATION_THRESHOLD_BYTES) {
          this.rotate();
        }
      } catch {
        // stat failed (file gone between check and write) — fall through.
      }
    }

    appendFileSync(this.path, JSON.stringify(full) + "\n", "utf-8");
  }

  /** Rotate the current log to `.log.1`. Subsequent writes go to a
   *  fresh `.log` file. Idempotent within a single service lifetime. */
  rotate(): void {
    const target = `${this.path}.1`;
    if (existsSync(this.path)) {
      try { renameSync(this.path, target); }
      catch { /* ignore — best-effort */ }
    }
    this.rotated = true;
  }

  /** On-disk size in bytes. 0 if file missing. */
  size(): number {
    try {
      return existsSync(this.path) ? statSync(this.path).size : 0;
    } catch {
      return 0;
    }
  }

  /** Read the last `n` entries from the log. Bounded by TAIL_MAX_BYTES. */
  tail(n: number = 50): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    let raw: string;
    try {
      const stats = statSync(this.path);
      const start = Math.max(0, stats.size - TAIL_MAX_BYTES);
      const buffer = Buffer.alloc(stats.size - start);
      // Read the last TAIL_MAX_BYTES via a small open/read/close dance.
      const handle = openSync(this.path, "r");
      try { readSync(handle, buffer, 0, buffer.length, start); }
      finally { closeSync(handle); }
      raw = buffer.toString("utf-8");
    } catch {
      raw = readFileSync(this.path, "utf-8");
    }
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const slice = lines.slice(-n);
    const out: AuditEntry[] = [];
    for (const line of slice) {
      try { out.push(JSON.parse(line) as AuditEntry); }
      catch { /* malformed line — skip */ }
    }
    return out;
  }

  /** Wipe the audit log. Test-only helper. */
  reset(): void {
    this.rotated = false;
    try { if (existsSync(this.path)) renameSync(this.path, `${this.path}.deleted`); }
    catch { /* ignore */ }
  }
}