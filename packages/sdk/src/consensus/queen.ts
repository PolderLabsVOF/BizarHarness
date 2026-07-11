/**
 * consensus/queen.ts — Proposer election (QueenCoordinator).
 *
 * F-039 — thin port of ruflo's capability-scored QueenCoordinator
 * (v3/@claude-flow/swarm/src/coordination/queen-coordinator.ts) for
 * the consensus layer's proposer selection. Bizar needs a deterministic,
 * fault-aware round-robin; we don't port the full ReasoningBank pattern
 * matching because Bizar's review steps don't have agent capability
 * vectors — they have peer rosters + a fault log.
 *
 * Algorithm: round-robin weighted by recent fault count. A peer with
 * N faults is skipped N times before becoming proposer again. With
 * `proposerSeed`, the initial head is computed deterministically so
 * tests can pin it.
 */

export interface QueenCoordinatorOpts {
  /** Full peer roster, in the order round-robin walks them. Required. */
  peers: string[];
  /** Maximum Byzantine faults the cluster can tolerate (used as the
   *  skip-multiplier floor). Defaults to 1. */
  maxFaults?: number;
  /** Optional seed — when set, the initial head is `peers[seedHash % peers.length]`. */
  seed?: string;
}

/**
 * Tracks per-peer fault counts and walks the peer list in
 * round-robin order, skipping any peer whose `faultCount` is greater
 * than the candidate's expected count at that position.
 *
 * Concretely: if peer X has faultCount 2, the next 2 round-robin
 * positions that would land on X skip it instead and the proposer
 * becomes the peer at the next non-skipped position. After 2
 * `advance()` calls (or `selectProposer` calls that consumed a skip),
 * X is eligible again.
 *
 * The fault penalty decays as the round-robin walks — this keeps
 * the cluster moving even when one peer has accumulated many faults.
 */
export class QueenCoordinator {
  private readonly peers: readonly string[];
  /** Maximum Byzantine faults the cluster is sized for (used as the
   *  skip-multiplier floor — `recordFault` adds a skip of size
   *  `maxFaults` so the worst peer is skipped `maxFaults` rounds). */
  private readonly maxFaults: number;
  /** Per-peer cumulative fault count. */
  private readonly faults: Map<string, number> = new Map();
  /** Per-peer remaining-skip count (decremented on every advance). */
  private readonly skips: Map<string, number> = new Map();
  /** Current head of the round-robin walk. */
  private cursor = 0;

  constructor(opts: QueenCoordinatorOpts) {
    if (!opts || !Array.isArray(opts.peers) || opts.peers.length === 0) {
      throw new Error("QueenCoordinator: `peers` is required and must be non-empty");
    }
    const seen = new Set<string>();
    for (const p of opts.peers) {
      if (typeof p !== "string" || p.length === 0) {
        throw new Error("QueenCoordinator: every peer id must be a non-empty string");
      }
      if (seen.has(p)) {
        throw new Error(`QueenCoordinator: duplicate peer id "${p}"`);
      }
      seen.add(p);
      this.faults.set(p, 0);
      this.skips.set(p, 0);
    }
    this.peers = [...opts.peers];
    this.maxFaults = Math.max(0, opts.maxFaults ?? 1);
    if (opts.seed) {
      this.cursor = this.seedCursor(opts.seed);
    }
  }

  /** Current proposer (head of the round-robin walk). */
  currentProposer(): string {
    return this.peers[this.cursor % this.peers.length] as string;
  }

  /** Record a fault against a peer (the proposer just voted `no`, or
   *  missed its pre-prepare window). Increments both the cumulative
   *  fault log and the per-peer skip counter — the peer is then
   *  skipped for `maxFaults` round-robin steps before becoming
   *  proposer-eligible again. With `maxFaults = 1` (the F-039
   *  default), one fault skips the peer for one round. */
  recordFault(peerId: string): void {
    if (!this.faults.has(peerId)) {
      throw new Error(`recordFault: unknown peer "${peerId}"`);
    }
    this.faults.set(peerId, (this.faults.get(peerId) ?? 0) + 1);
    this.skips.set(peerId, (this.skips.get(peerId) ?? 0) + this.maxFaults);
  }

  /**
   * Walk one step forward. Skips any peer whose remaining-skip count
   * is > 0 (decrementing the counter as it skips). Returns the new
   * proposer.
   */
  advance(): string {
    const n = this.peers.length;
    let steps = 0;
    while (steps < n) {
      this.cursor = (this.cursor + 1) % n;
      const candidate = this.peers[this.cursor] as string;
      const skip = this.skips.get(candidate) ?? 0;
      if (skip > 0) {
        this.skips.set(candidate, skip - 1);
        steps++;
        continue;
      }
      return candidate;
    }
    // Everyone had skip > 0 — we walked the full circle and decremented
    // everyone. Just return where we landed.
    return this.peers[this.cursor] as string;
  }

  /**
   * Equivalent to `selectProposer(peers, recentFaults)` from the F-039
   * spec — but stateful, because we own the fault log. Returns the
   * current proposer without advancing.
   */
  selectProposer(): string {
    // If the current proposer has a non-zero skip, walk forward to find
    // the next eligible peer.
    const n = this.peers.length;
    let probe = this.cursor;
    for (let i = 0; i < n; i++) {
      const candidate = this.peers[probe] as string;
      const skip = this.skips.get(candidate) ?? 0;
      if (skip === 0) return candidate;
      probe = (probe + 1) % n;
    }
    // All peers have skip > 0 — same fallback as advance().
    return this.peers[this.cursor] as string;
  }

  /** Cumulative fault counts (read-only snapshot). */
  faultCounts(): Record<string, number> {
    return Object.fromEntries(this.faults);
  }

  /** Number of peers currently under a skip penalty. */
  pendingSkipCount(): number {
    let n = 0;
    for (const v of this.skips.values()) if (v > 0) n++;
    return n;
  }

  /** Test/dev helper: drop the cursor and fault counts. */
  reset(): void {
    this.cursor = 0;
    for (const k of this.faults.keys()) this.faults.set(k, 0);
    for (const k of this.skips.keys()) this.skips.set(k, 0);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Stable hash of an optional seed string → integer cursor in
   * `[0, peers.length)`. Lets a test caller pin the initial proposer
   * for replay safety (F-039 determinism rule).
   */
  private seedCursor(seed: string): number {
    let h = 5381;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
    }
    return h % this.peers.length;
  }
}