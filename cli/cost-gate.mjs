// @ts-nocheck — declaration emit for the `Database` / `Statement`
// private types from better-sqlite3 is not currently exported by the
// better-sqlite3 type package, so .d.ts generation for this .mjs
// module fails with TS9006. The runtime is correct; once better-sqlite3
// ships exported types (or F-035 lands with a wrapper), the
// @ts-nocheck can come off.
// (The directive is placed BEFORE the docblock header below so
// TypeScript's parser doesn't trip on the `<uuid>` / `<env>` tokens
// inside the JSDoc body.)

/**
 * cli/cost-gate.mjs
 *
 * F-035 (MetaHarness) — atomic SQLite-backed room-budget tracker.
 *
 * Source-of-truth port from
 *   ruflo/v3/@claude-flow/cli/src/business-pods/bbs-budget-tracker.ts:151
 *   (AtomicBbsRoomBudgetTracker — ADR-164.1 §3-§5)
 *
 * The contract:
 *   - `registerRoom(roomId, capUsd)` is idempotent (upsert by id).
 *   - `reserve(roomId, callerId, amount, opts?)` atomically checks
 *     the budget AND inserts a 'reserved' transaction inside one
 *     `BEGIN IMMEDIATE` transaction (Bizar's L10 cost-gate constraint).
 *   - `commit(txId, actualUsd)` flips the row to 'committed' (or
 *     'committed_post_expiry' + `COMMIT_AFTER_EXPIRY` warning if the
 *     reservation already expired — the API spend already happened,
 *     so we accept the charge and emit a warning).
 *   - `release(txId)` flips a still-'reserved' row to 'released';
 *     any other state returns ALREADY_FINALIZED.
 *   - `status(roomId)` returns { capUsd, spentUsd, remainingUsd }
 *     computed from the committed + live-reserved ledger.
 *   - `sweepExpired(nowMs?)` is exposed for callers to drive
 *     periodically (the pod-tick mjs stub uses 5s sweep).
 *
 * State machine (per ADR-164.1 §3, §5.3):
 *   reserved -> committed
 *   reserved -> released
 *   reserved -> expired           (sweepExpired, before any commit)
 *   reserved -> committed_post_expiry  (commit lands after expires_at)
 *
 * Atomicity guarantees:
 *   - WAL (PRAGMA journal_mode = WAL) so reads don't block writes.
 *   - `busy_timeout = 500` so concurrent reserves get a brief retry
 *     window for SQLITE_BUSY instead of failing immediately.
 *   - All reserve/commit/release run inside a single `BEGIN IMMEDIATE`
 *     transaction so the lock acquisition + state mutation are atomic.
 *
 * Schema (per feature spec):
 *   rooms(id TEXT PRIMARY KEY, monthly_cap_usd REAL, spent_usd REAL,
 *         last_reset_at INTEGER)
 *   transactions(id INTEGER PRIMARY KEY, room_id TEXT, kind TEXT,
 *                amount_usd REAL, ts INTEGER, metadata TEXT)
 *
 * IDs:
 *   transaction id is string-shaped (`tx-<uuid>`) so the result type
 *   can carry it back through JSON. The `kind` column is one of
 *   'reserved' | 'committed' | 'released' | 'expired' | 'committed_post_expiry'.
 *
 * Expiry window:
 *   - default 60_000 ms (overridable per `reserve()` call)
 *   - clamped to [5_000, 300_000] ms (ADR-164.1 §3.2)
 *   - overridable globally via BIZAR_COST_RESERVATION_EXPIRY_MS env var
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// better-sqlite3's Database / Statement types are not currently exported by
// the @types/better-sqlite3 package, so we use a structural cast to keep
// both runtime behavior and declaration emit happy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Database = (await import('better-sqlite3')).default;

// ── Constants (kept in this module so the CLI doesn't depend on
//    cli/memory-constants.mjs for the cost gate) ──────────────────────

export const RESERVATION_EXPIRY_FLOOR_MS = 5_000;
export const RESERVATION_EXPIRY_CEILING_MS = 300_000;
export const RESERVATION_EXPIRY_DEFAULT_MS = 60_000;

const TX_STATES = new Set([
  'reserved',
  'committed',
  'released',
  'expired',
  'committed_post_expiry',
]);

export function clampReservationExpiry(raw) {
  if (raw === undefined || raw === null || !Number.isFinite(Number(raw))) {
    const envVal = Number(process.env.BIZAR_COST_RESERVATION_EXPIRY_MS);
    if (Number.isFinite(envVal) && envVal > 0) {
      return Math.max(
        RESERVATION_EXPIRY_FLOOR_MS,
        Math.min(RESERVATION_EXPIRY_CEILING_MS, envVal),
      );
    }
    return RESERVATION_EXPIRY_DEFAULT_MS;
  }
  const n = Number(raw);
  return Math.max(
    RESERVATION_EXPIRY_FLOOR_MS,
    Math.min(RESERVATION_EXPIRY_CEILING_MS, n),
  );
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 500;

CREATE TABLE IF NOT EXISTS rooms (
  id              TEXT NOT NULL PRIMARY KEY,
  monthly_cap_usd REAL NOT NULL CHECK (monthly_cap_usd >= 0),
  spent_usd       REAL NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  last_reset_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_id       TEXT NOT NULL UNIQUE,
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  kind        TEXT NOT NULL CHECK (kind IN ('reserved','committed','released','expired','committed_post_expiry')),
  amount_usd  REAL NOT NULL,
  caller_id   TEXT NOT NULL DEFAULT '',
  ts          INTEGER NOT NULL,
  expires_at  INTEGER,
  committed_at INTEGER,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tx_room_state_ts
  ON transactions (room_id, kind, ts);
CREATE INDEX IF NOT EXISTS idx_tx_state_expires
  ON transactions (kind, expires_at);
`;

// ── Result shapes ─────────────────────────────────────────────────────

/**
 * @typedef {Object} ReserveResult
 * @property {boolean} ok
 * @property {string} [txId]
 * @property {number} [expiresAt]
 * @property {number} [remainingAfterReserve]
 * @property {string} [error]   'BUDGET_EXCEEDED' | 'ROOM_NOT_FOUND'
 */

/**
 * @typedef {Object} CommitResult
 * @property {boolean} ok
 * @property {boolean} [committed]
 * @property {string} [warned]   'COMMIT_AFTER_EXPIRY'
 * @property {number} [finalRemaining]
 * @property {string} [error]    'NOT_FOUND' | 'ALREADY_FINALIZED'
 */

/**
 * @typedef {Object} ReleaseResult
 * @property {boolean} ok
 * @property {boolean} [released]
 * @property {string} [error]    'NOT_FOUND' | 'ALREADY_FINALIZED'
 */

/**
 * @typedef {Object} RoomStatus
 * @property {string} roomId
 * @property {number} capUsd
 * @property {number} spentUsd
 * @property {number} reservedUsd
 * @property {number} remainingUsd
 * @property {number} txCount
 * @property {number} [lastResetAt]
 */

// ── CostGate ──────────────────────────────────────────────────────────

export class CostGate {
  /**
   * @param {string|object} opts Either a path string or an
   *   `{dbPath, clock, logger}` options bag.
   */
  constructor(opts = {}) {
    if (typeof opts === 'string') {
      this.dbPath = opts;
      this.clock = () => Date.now();
      this.logger = null;
    } else {
      this.dbPath = opts.dbPath;
      this.clock = opts.clock || (() => Date.now());
      this.logger = opts.logger || null;
    }
    if (!this.dbPath) {
      throw new Error('CostGate requires dbPath');
    }
    mkdirSync(dirname(this.dbPath), { recursive: true });
    /** @type {import('better-sqlite3').Database} */
    this.db = new Database(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    // Lock down the mode after first PRAGMA above.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 500');

    // Prepared statements — re-bind per call so better-sqlite3 doesn't
    // trip on changing SQL text.
    /** @type {{ [k: string]: import('better-sqlite3').Statement<any[], any> }} */
    this._stmts = {
      registerRoom: this.db.prepare(
        `INSERT INTO rooms (id, monthly_cap_usd, spent_usd, last_reset_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET monthly_cap_usd = excluded.monthly_cap_usd`,
      ),
      getRoom: this.db.prepare(
        `SELECT id, monthly_cap_usd, spent_usd, last_reset_at FROM rooms WHERE id = ?`,
      ),
      listRooms: this.db.prepare(
        `SELECT id, monthly_cap_usd, spent_usd, last_reset_at FROM rooms ORDER BY id`,
      ),
      insertTx: this.db.prepare(
        `INSERT INTO transactions
          (tx_id, room_id, kind, amount_usd, caller_id, ts, expires_at, committed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      getTx: this.db.prepare(
        `SELECT tx_id, room_id, kind, amount_usd, caller_id, ts, expires_at, committed_at
           FROM transactions WHERE tx_id = ?`,
      ),
      totalsThisCycle: this.db.prepare(
        `SELECT
            COALESCE(SUM(CASE WHEN kind IN ('committed','committed_post_expiry')
                              THEN amount_usd ELSE 0 END), 0) AS committed_total,
            COALESCE(SUM(CASE WHEN kind = 'reserved'
                              AND (expires_at IS NULL OR expires_at > ?)
                              THEN amount_usd ELSE 0 END), 0) AS reserved_total
          FROM transactions
          WHERE room_id = ?`,
      ),
      setSpentUsd: this.db.prepare(
        `UPDATE rooms SET spent_usd = ? WHERE id = ?`,
      ),
      flipTxState: this.db.prepare(
        `UPDATE transactions SET kind = ?, committed_at = ? WHERE tx_id = ?`,
      ),
      sweepExpired: this.db.prepare(
        `UPDATE transactions SET kind = 'expired'
          WHERE kind = 'reserved' AND expires_at IS NOT NULL AND expires_at < ?`,
      ),
      listTxForRoom: this.db.prepare(
        `SELECT tx_id, room_id, kind, amount_usd, caller_id, ts, expires_at, committed_at
           FROM transactions WHERE room_id = ? ORDER BY ts`,
      ),
      txCountForRoom: this.db.prepare(
        `SELECT COUNT(*) AS n FROM transactions WHERE room_id = ?`,
      ),
    };
  }

  close() {
    try { this.db.close(); } catch (_e) { /* ignore double-close */ }
  }

  // ── Register ──────────────────────────────────────────────────────

  registerRoom(roomId, capUsd) {
    if (!roomId || typeof roomId !== 'string') {
      throw new Error('roomId must be a non-empty string');
    }
    const cap = Number(capUsd);
    if (!Number.isFinite(cap) || cap < 0) {
      throw new Error('capUsd must be a non-negative finite number');
    }
    this._stmts.registerRoom.run(roomId, cap, this.clock());
    return { ok: true, roomId, capUsd: cap };
  }

  // ── Reserve ───────────────────────────────────────────────────────
  /**
   * Atomically reserve budget inside a BEGIN IMMEDIATE transaction.
   * @returns {ReserveResult}
   */
  reserve(roomId, callerId, estimatedUsd, opts = {}) {
    if (!Number.isFinite(Number(estimatedUsd)) || Number(estimatedUsd) < 0) {
      throw new Error('estimatedUsd must be a non-negative finite number');
    }
    const amount = Number(estimatedUsd);
    const expiryMs = clampReservationExpiry(opts.expiryMs);
    const metadata = opts.metadata ? JSON.stringify(opts.metadata) : '{}';

    const nowMs = this.clock();
    const txId = `tx-${randomUUID()}`;
    const expiresAt = nowMs + expiryMs;

    // better-sqlite3 auto-commits each .run(). For atomicity we use the
    // `transaction()` builder, which produces a single function that
    // wraps all the .run() / .get() calls inside BEGIN/COMMIT (and
    // ROLLBACK on throw).  ADR-164.1 §3.2 explicitly mandates
    // BEGIN IMMEDIATE — better-sqlite3 always opens with
    // BEGIN DEFERRED by default; we force it via `BEGIN IMMEDIATE` for
    // the atomic reserve flow by writing the transaction() builder
    // as a single BEGIN IMMEDIATE block.
    const reserveTxn = this.db.transaction(() => {
      const room = this._stmts.getRoom.get(roomId);
      if (!room) {
        return { ok: false, error: 'ROOM_NOT_FOUND' };
      }
      const capUsd = Number(room.monthly_cap_usd);
      const totals = this._stmts.totalsThisCycle.get(nowMs, roomId);
      const committed = Number(totals?.committed_total ?? 0);
      const reserved = Number(totals?.reserved_total ?? 0);
      const projected = committed + reserved + amount;
      if (projected > capUsd + 1e-9) {
        return {
          ok: false,
          error: 'BUDGET_EXCEEDED',
          committed,
          reserved,
          capUsd,
        };
      }
      this._stmts.insertTx.run(
        txId,
        roomId,
        'reserved',
        amount,
        callerId || '',
        nowMs,
        expiresAt,
        null,
        metadata,
      );
      return {
        ok: true,
        txId,
        expiresAt,
        remainingAfterReserve: capUsd - projected,
      };
    });
    // Force BEGIN IMMEDIATE so we hold the write lock the entire
    // time the cap check + insert runs (ADR-164.1 §3.2 + Bizar's
    // "concurrent reserves must not double-spend" constraint).
    reserveTxn.immediate;
    const result = reserveTxn.immediate();
    if (result.ok) {
      if (this.logger) this.logger.info?.('cost.reserve', result);
    }
    return result;
  }

  // ── Commit ────────────────────────────────────────────────────────
  /**
   * Commit the reservation with the actual cost. Late commits are
   * accepted (warn: 'COMMIT_AFTER_EXPIRY').
   * @returns {CommitResult}
   */
  commit(txId, actualUsd) {
    if (!Number.isFinite(Number(actualUsd)) || Number(actualUsd) < 0) {
      throw new Error('actualUsd must be a non-negative finite number');
    }
    const amount = Number(actualUsd);
    const nowMs = this.clock();

    const updateAmountAndState = this.db.prepare(
      `UPDATE transactions SET kind = ?, amount_usd = ?, committed_at = ? WHERE tx_id = ?`,
    );

    const commitTxn = this.db.transaction(() => {
      const row = this._stmts.getTx.get(txId);
      if (!row) return { ok: false, error: 'NOT_FOUND' };
      if (row.kind === 'committed' || row.kind === 'committed_post_expiry' || row.kind === 'released') {
        return { ok: false, error: 'ALREADY_FINALIZED' };
      }

      // Late commit? Even if the row's state is still 'reserved' (or
      // 'expired' if a sweeper beat us to it), the expires_at may
      // have already passed. ADR-164.1 §5.3 — accept the charge and
      // warn.
      const late = row.expires_at != null && row.expires_at <= nowMs;
      const newKind = late ? 'committed_post_expiry' : 'committed';

      // IMPORTANT: replace the estimated amount with the actual cost
      // on commit. The reservation's amount_usd reflects the upper
      // bound; the actual cost may be smaller (cheaper model) or,
      // in late-commit cases, may approximate the work that already
      // ran. After this UPDATE, the SUM(... committed/committed_post_expiry)
      // returns the real spend.
      updateAmountAndState.run(newKind, amount, nowMs, txId);

      // Update room.spent_usd to reflect the (now corrected) actual
      // totals — kept in sync for status()'s `spentUsd`.
      const totals = this._stmts.totalsThisCycle.get(nowMs + 1, row.room_id);
      const committedTotal = Number(totals?.committed_total ?? 0);
      this._stmts.setSpentUsd.run(committedTotal, row.room_id);

      const room = this._stmts.getRoom.get(row.room_id);
      const cap = Number(room?.monthly_cap_usd ?? 0);
      const finalRemaining = cap - (committedTotal + Number(totals?.reserved_total ?? 0));

      if (late) {
        return {
          ok: true,
          warned: 'COMMIT_AFTER_EXPIRY',
          finalRemaining,
        };
      }
      return { ok: true, committed: true, finalRemaining };
    });
    return commitTxn.immediate();
  }

  // ── Release ───────────────────────────────────────────────────────
  /**
   * @returns {ReleaseResult}
   */
  release(txId) {
    const releaseTxn = this.db.transaction(() => {
      const row = this._stmts.getTx.get(txId);
      if (!row) return { ok: false, error: 'NOT_FOUND' };
      if (row.kind !== 'reserved') {
        return { ok: false, error: 'ALREADY_FINALIZED' };
      }
      this._stmts.flipTxState.run('released', this.clock(), txId);
      return { ok: true, released: true };
    });
    return releaseTxn.immediate();
  }

  // ── Status ────────────────────────────────────────────────────────
  /**
   * @returns {RoomStatus | null}
   */
  status(roomId) {
    const room = this._stmts.getRoom.get(roomId);
    if (!room) return null;
    const capUsd = Number(room.monthly_cap_usd);
    const now = this.clock();
    const totals = this._stmts.totalsThisCycle.get(now, roomId);
    const committed = Number(totals?.committed_total ?? 0);
    const reserved = Number(totals?.reserved_total ?? 0);
    const count = this._stmts.txCountForRoom.get(roomId);
    return {
      roomId,
      capUsd,
      spentUsd: committed,
      reservedUsd: reserved,
      remainingUsd: capUsd - (committed + reserved),
      txCount: Number(count?.n ?? 0),
      lastResetAt: Number(room.last_reset_at),
    };
  }

  listRooms() {
    const rows = this._stmts.listRooms.all();
    return rows.map((r) => {
      const totals = this._stmts.totalsThisCycle.get(this.clock(), r.id);
      const committed = Number(totals?.committed_total ?? 0);
      const reserved = Number(totals?.reserved_total ?? 0);
      const capUsd = Number(r.monthly_cap_usd);
      return {
        roomId: r.id,
        capUsd,
        spentUsd: committed,
        reservedUsd: reserved,
        remainingUsd: capUsd - (committed + reserved),
        lastResetAt: Number(r.last_reset_at),
      };
    });
  }

  // ── Sweep ─────────────────────────────────────────────────────────
  /**
   * Sweep expired reservations to 'expired' state. Returns the number
   * of rows updated. Driven by setInterval at the integration site.
   */
  sweepExpired(nowMs) {
    const ts = nowMs == null ? this.clock() : Number(nowMs);
    const result = this._stmts.sweepExpired.run(ts);
    return Number(result.changes ?? 0);
  }

  // ── Test-only / introspection ────────────────────────────────────
  /** Return raw transactions for a room. Used by tests + CLI status. */
  listTransactions(roomId) {
    return this._stmts.listTxForRoom.all(roomId);
  }
}

// ── File-path helper (default location under .bizar/) ────────────────

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default DB path: $HOME/.bizar/cost-gate.db (or override via BIZAR_COST_GATE_DB). */
export function defaultDbPath() {
  if (process.env.BIZAR_COST_GATE_DB && process.env.BIZAR_COST_GATE_DB.trim()) {
    return process.env.BIZAR_COST_GATE_DB.trim();
  }
  return join(homedir(), '.bizar', 'cost-gate.db');
}
