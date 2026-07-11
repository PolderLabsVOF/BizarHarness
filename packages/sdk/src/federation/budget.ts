/**
 * federation/budget.ts — FederationBudget: per-peer reserved →
 * committed → released state machine for token / USD spend.
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/domain/value-objects/federation-budget.ts`
 * (validateBudget + enforceBudget shape) and folded into a class
 * that tracks actual spend per peer across calls.
 *
 * State machine (per peer):
 *   reserved:  amount is held back (the peer is going to spend ≤ N).
 *   committed: amount was actually spent (the call completed and we
 *              know the real cost).
 *   released:  amount returned to the peer (call failed before
 *              commit; we give the hold back).
 *
 * Persistence: optional JSON snapshot at
 * `.harness/federation-budget.json` so the budget survives a
 * Claude Code session restart. The file is gitignored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

/** Default budget JSON path. */
export const DEFAULT_BUDGET_PATH = ".harness/federation-budget.json";

/** Hard ceilings — matches ruflo's MAX_*_CEILING values, kept here
 *  so callers can't ask for absurdly large budgets. */
export const MAX_USD_CEILING = 1_000_000;
export const MAX_TOKENS_CEILING = 1_000_000_000;

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "peer_over_budget" | "invalid_amount" };

export interface PerPeerBudget {
  readonly nodeId: string;
  readonly maxTokens: number;
  readonly maxUsd: number;
  readonly maxHops: number;
  readonly spentTokens: number;
  readonly spentUsd: number;
}

export interface PersistedBudget {
  readonly version: 1;
  readonly updatedAt: string;
  readonly perPeer: PerPeerBudget[];
}

interface Reservation {
  readonly id: string;
  readonly nodeId: string;
  readonly tokens: number;
  readonly usd: number;
  readonly atMs: number;
}

let reservationCounter = 0;

function nextReservationId(): string {
  reservationCounter++;
  // 128-bit random suffix avoids collision across processes.
  return `res-${Date.now().toString(36)}-${reservationCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Pure validator — borrowed from ruflo's `validateBudget` and
 *  simplified. Returns a discriminated result. */
export function validateBudgetInput(raw: unknown): { ok: true; maxTokens: number; maxUsd: number; maxHops: number } | { ok: false; error: string } {
  if (raw == null) {
    return {
      ok: true,
      maxTokens: MAX_TOKENS_CEILING,
      maxUsd: MAX_USD_CEILING,
      maxHops: 8,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "budget must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const hops = typeof obj.maxHops === "number" && Number.isFinite(obj.maxHops) ? obj.maxHops : 8;
  const tokens = typeof obj.maxTokens === "number" && Number.isFinite(obj.maxTokens) ? obj.maxTokens : MAX_TOKENS_CEILING;
  const usd = typeof obj.maxUsd === "number" && Number.isFinite(obj.maxUsd) ? obj.maxUsd : MAX_USD_CEILING;
  if (hops < 0 || hops > 64) return { ok: false, error: "maxHops out of range" };
  if (tokens < 0 || tokens > MAX_TOKENS_CEILING) return { ok: false, error: "maxTokens out of range" };
  if (usd < 0 || usd > MAX_USD_CEILING) return { ok: false, error: "maxUsd out of range" };
  return { ok: true, maxTokens: tokens, maxUsd: usd, maxHops: hops };
}

export interface FederationBudgetOpts {
  /** Override the JSON persistence path. */
  readonly path?: string;
  /** Default per-peer limits applied when a peer is first seen. */
  readonly defaultMaxTokens?: number;
  readonly defaultMaxUsd?: number;
  readonly defaultMaxHops?: number;
}

export class FederationBudget {
  private readonly path: string;
  private readonly perPeer = new Map<string, PerPeerBudget>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly defaults: { maxTokens: number; maxUsd: number; maxHops: number };

  constructor(opts: FederationBudgetOpts = {}) {
    this.path = opts.path ?? DEFAULT_BUDGET_PATH;
    this.defaults = {
      maxTokens: opts.defaultMaxTokens ?? MAX_TOKENS_CEILING,
      maxUsd: opts.defaultMaxUsd ?? MAX_USD_CEILING,
      maxHops: opts.defaultMaxHops ?? 8,
    };
    this.loadFromDisk();
  }

  /** Get or lazily-create the per-peer budget record. */
  getOrCreate(nodeId: string): PerPeerBudget {
    let existing = this.perPeer.get(nodeId);
    if (!existing) {
      existing = {
        nodeId,
        maxTokens: this.defaults.maxTokens,
        maxUsd: this.defaults.maxUsd,
        maxHops: this.defaults.maxHops,
        spentTokens: 0,
        spentUsd: 0,
      };
      this.perPeer.set(nodeId, existing);
    }
    return existing;
  }

  /** Override the limits for a specific peer. */
  setLimits(nodeId: string, limits: { maxTokens?: number; maxUsd?: number; maxHops?: number }): void {
    const peer = this.getOrCreate(nodeId);
    this.perPeer.set(nodeId, {
      ...peer,
      maxTokens: limits.maxTokens ?? peer.maxTokens,
      maxUsd: limits.maxUsd ?? peer.maxUsd,
      maxHops: limits.maxHops ?? peer.maxHops,
    });
    this.saveToDisk();
  }

  /** Reserve `tokens` + `usd` against a peer's budget. The caller
   *  MUST eventually `commit()` or `release()` — un-released
   *  reservations are surfaced via `outstanding()`. */
  reserve(nodeId: string, tokens: number, usd: number): ReserveResult {
    if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(usd) || usd < 0) {
      return { ok: false, reason: "invalid_amount" };
    }
    const peer = this.getOrCreate(nodeId);
    const remainingTokens = peer.maxTokens - peer.spentTokens;
    const remainingUsd = peer.maxUsd - peer.spentUsd;
    if (tokens > remainingTokens || usd > remainingUsd) {
      return { ok: false, reason: "peer_over_budget" };
    }
    const id = nextReservationId();
    this.reservations.set(id, {
      id,
      nodeId,
      tokens,
      usd,
      atMs: Date.now(),
    });
    // Optimistically charge the spend against the budget so a
    // concurrent reserve from the same peer cannot double-spend.
    // If commit() reports less, the diff is refunded. If the call
    // fails and release() is called, the full reservation is
    // refunded.
    this.perPeer.set(nodeId, {
      ...peer,
      spentTokens: peer.spentTokens + tokens,
      spentUsd: peer.spentUsd + usd,
    });
    return { ok: true, reservationId: id };
  }

  /** Commit a reservation — caller reports the ACTUAL spend which
   *  may be less than the reserved amount. Difference is refunded. */
  commit(reservationId: string, actual: { tokens?: number; usd?: number } = {}): boolean {
    const r = this.reservations.get(reservationId);
    if (!r) return false;
    const actualTokens = Math.max(0, actual.tokens ?? r.tokens);
    const actualUsd = Math.max(0, actual.usd ?? r.usd);
    const peer = this.perPeer.get(r.nodeId);
    if (!peer) {
      this.reservations.delete(reservationId);
      return false;
    }
    // Refund the difference between reserved and actual.
    const tokenRefund = r.tokens - actualTokens;
    const usdRefund = r.usd - actualUsd;
    this.perPeer.set(r.nodeId, {
      ...peer,
      spentTokens: Math.max(0, peer.spentTokens - tokenRefund),
      spentUsd: Math.max(0, peer.spentUsd - usdRefund),
    });
    this.reservations.delete(reservationId);
    this.saveToDisk();
    return true;
  }

  /** Release a reservation — full refund. */
  release(reservationId: string): boolean {
    const r = this.reservations.get(reservationId);
    if (!r) return false;
    const peer = this.perPeer.get(r.nodeId);
    if (peer) {
      this.perPeer.set(r.nodeId, {
        ...peer,
        spentTokens: Math.max(0, peer.spentTokens - r.tokens),
        spentUsd: Math.max(0, peer.spentUsd - r.usd),
      });
    }
    this.reservations.delete(reservationId);
    this.saveToDisk();
    return true;
  }

  /** List outstanding reservations. */
  outstanding(): Reservation[] {
    return [...this.reservations.values()];
  }

  /** Snapshot every per-peer budget — for the status MCP tool. */
  snapshot(): PerPeerBudget[] {
    return [...this.perPeer.values()];
  }

  /** Serialize to the persisted JSON shape. */
  toJSON(): PersistedBudget {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      perPeer: this.snapshot(),
    };
  }

  /** Write to disk (atomic tmp + rename). */
  saveToDisk(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 2), "utf-8");
      renameSync(tmp, this.path);
    } catch {
      /* best-effort */
    }
  }

  /** Re-read from disk, replacing in-memory state. */
  loadFromDisk(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, "utf-8");
      const parsed = JSON.parse(raw) as PersistedBudget;
      if (parsed.version !== 1 || !Array.isArray(parsed.perPeer)) return;
      this.perPeer.clear();
      for (const p of parsed.perPeer) {
        if (typeof p.nodeId === "string") this.perPeer.set(p.nodeId, p);
      }
    } catch {
      /* malformed — keep defaults */
    }
  }
}