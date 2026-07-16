/**
 * router/q-learning-router.ts — Q-learning agent router.
 *
 * v6.4.0 — ported from ruflo `q-learning-router.ts` (8-action softmax
 * agent-route over coder / tester / reviewer / …).
 *
 * All 14 agents registered. The Q-learning policy converges faster on
 * commonly-dispatched targets; long-tail agents are still routable but
 * get the prior policy until sufficient feedback accumulates.
 *
 *   - State: a 64-dim bag-of-words hash of the task string (FNV-1a
 *     folded into 64 buckets). LRU-cached so repeated task patterns
 *     are O(1).
 *   - Action: one of `odin|frigg|vor|mimir|heimdall|thor|tyr|forseti`.
 *   - Reward: `+1` on `recordOutcome(agent, true)`, `0` on false.
 *   - Exploration: ε-greedy with ε = 0.1 (configurable).
 *
 * `selectAgent()` returns `{agent, confidence}`. `confidence` is the
 * posterior mean of the picked action's Q-value clamped to [0,1].
 *
 * Tiny surface area by design — the
 * `AgentRouteDecision` shape is what `model_route` /
 * `agent_route` MCP tools expose.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { detectCodemodIntent } from "./codemod-intent.js";

export const AGENT_ACTIONS: readonly string[] = [
  "odin",
  "frigg",
  "vor",
  "mimir",
  "heimdall",
  "thor",
  "tyr",
  "forseti",
  "hermod",
  "baldr",
  "vidarr",
  "quick",
  "agent-browser",
  "semble-search",
] as const;

export type AgentName = (typeof AGENT_ACTIONS)[number];

export interface AgentRouteDecision {
  agent: string;
  confidence: number;
}

export interface QLearningRouterOpts {
  stateDim?: number;
  epsilon?: number;
  lruSize?: number;
  seed?: number;
}

const DEFAULT_STATE_DIM = 64;
const DEFAULT_EPSILON = 0.1;
const DEFAULT_LRU = 256;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to",
  "for", "of", "with", "by", "is", "are", "be", "was", "were", "this",
  "that", "it", "as", "if", "from", "into", "so", "than",
]);

export class QLearningRouter {
  private readonly stateDim: number;
  private readonly epsilon: number;
  private readonly lruSize: number;
  // Q[agentIdx][stateBucket] → mean reward for that bucket.
  // Initialised to 0.5 (neutral). Updated by EMA on recordOutcome.
  private readonly q: Float32Array[] = [];
  private readonly counts: Uint32Array[] = [];
  private readonly lru: Map<string, AgentRouteDecision> = new Map();
  private rngState: number;

  constructor(opts?: QLearningRouterOpts) {
    this.stateDim = opts?.stateDim ?? DEFAULT_STATE_DIM;
    this.epsilon = opts?.epsilon ?? DEFAULT_EPSILON;
    this.lruSize = opts?.lruSize ?? DEFAULT_LRU;
    this.rngState = (opts?.seed ?? 0) | 0;
    for (let i = 0; i < AGENT_ACTIONS.length; i++) {
      this.q.push(new Float32Array(this.stateDim).fill(0.5));
      this.counts.push(new Uint32Array(this.stateDim));
    }
  }

  /**
   * Greedy ε-soft policy. Returns a cached decision when the same
   * (task) hash has been seen recently (LRU bounded by `lruSize`).
   * Codemod-eligible prompts short-circuit to `heimdall` (the
   * routine-implementation agent) so they still get a "best" agent
   * without paying the bandit lookup cost twice.
   */
  selectAgent(task: string): AgentRouteDecision {
    if (!task || typeof task !== "string") {
      return { agent: "odin", confidence: 0.5 };
    }

    // Tier-1 codemod-eligible prompt → deterministic safe pick.
    const cm = detectCodemodIntent(task);
    if (cm !== null) {
      return { agent: "heimdall", confidence: 1.0 };
    }

    const bucket = this.bucketize(task);
    const cacheKey = String(bucket);
    const cached = this.lru.get(cacheKey);
    if (cached) {
      // Touch the LRU entry to mark recently used.
      this.lru.delete(cacheKey);
      this.lru.set(cacheKey, cached);
      return cached;
    }

    let agentIdx: number;
    let confidence = 0.5;
    if (this.random() < this.epsilon) {
      // Explore: uniformly at random.
      agentIdx = Math.floor(this.random() * AGENT_ACTIONS.length) % AGENT_ACTIONS.length;
      confidence = 0.25;
    } else {
      // Exploit: argmax Q for this bucket. Tie-break by lower count
      // (prefer the less-tried action), then by the canonical order.
      let bestQ = -Infinity;
      let bestCount = Infinity;
      const ties: number[] = [];
      for (let i = 0; i < AGENT_ACTIONS.length; i++) {
        const qv = this.q[i][bucket];
        if (qv > bestQ) {
          bestQ = qv; bestCount = this.counts[i][bucket]; ties.length = 0; ties.push(i);
        } else if (qv === bestQ) {
          const c = this.counts[i][bucket];
          if (c < bestCount) { bestCount = c; ties.length = 0; ties.push(i); }
          else ties.push(i);
        }
      }
      agentIdx = ties[Math.floor(this.random() * ties.length)] ?? 0;
      confidence = clamp01(bestQ);
    }

    const decision: AgentRouteDecision = {
      agent: AGENT_ACTIONS[agentIdx],
      confidence,
    };

    // Promote to LRU. LRU has a hard cap; evict oldest on overflow.
    if (this.lru.size >= this.lruSize) {
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) this.lru.delete(oldest);
    }
    this.lru.set(cacheKey, decision);
    return decision;
  }

  /**
   * EMA update of Q[agentIdx][bucket]. Uses the standard
   *   Q ← Q + α (reward − Q)
   * where α = 1 / (1 + count) — decreasing step size over time.
   */
  recordOutcome(agent: string, success: boolean): void {
    const idx = AGENT_ACTIONS.indexOf(agent as AgentName);
    if (idx < 0) return;
    // Reward shape: +1 success, 0 failure, normalised to [0,1] in Q.
    const reward = success ? 1.0 : 0.0;
    for (let b = 0; b < this.stateDim; b++) {
      const c = this.counts[idx][b] + 1;
      this.counts[idx][b] = c;
      const alpha = 1 / (1 + c);
      this.q[idx][b] = this.q[idx][b] + alpha * (reward - this.q[idx][b]);
    }
  }

  /** Read-only access for tests / telemetry. */
  snapshot(): Array<{ agent: string; qMean: number; n: number }> {
    return AGENT_ACTIONS.map((agent, i) => {
      let total = 0;
      let n = 0;
      for (let b = 0; b < this.stateDim; b++) {
        total += this.q[i][b];
        n += this.counts[i][b];
      }
      return {
        agent,
        qMean: n === 0 ? 0.5 : total / this.stateDim,
        n,
      };
    });
  }

  // -----------------------------------------------------------------
  // Persistence — same JSON-file policy as the model router.
  // -----------------------------------------------------------------

  /** Stable on-disk serialisation: Q-table per agent, counts, seed. */
  fullSnapshot(): QLearningSnapshot {
    const q: number[][] = [];
    const counts: number[][] = [];
    for (let i = 0; i < AGENT_ACTIONS.length; i++) {
      q.push(Array.from(this.q[i]));
      counts.push(Array.from(this.counts[i]));
    }
    return {
      version: 1,
      stateDim: this.stateDim,
      epsilon: this.epsilon,
      q,
      counts,
      rngSeed: this.rngState,
    };
  }

  static fromSnapshot(snap: Partial<QLearningSnapshot>): QLearningRouter {
    const inst = new QLearningRouter({
      stateDim: snap.stateDim,
      epsilon: snap.epsilon,
      seed: snap.rngSeed,
    });
    if (snap.q && snap.counts) {
      const dim = inst.stateDim;
      for (let i = 0; i < Math.min(snap.q.length, AGENT_ACTIONS.length); i++) {
        const row = snap.q[i] ?? [];
        const crows = snap.counts[i] ?? [];
        for (let b = 0; b < Math.min(dim, row.length); b++) {
          inst.q[i][b] = row[b];
          inst.counts[i][b] = crows[b] ?? 0;
        }
      }
    }
    return inst;
  }

  saveTo(path: string): void {
    const fp = isAbsolute(path) ? path : resolve(path);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, JSON.stringify(this.fullSnapshot(), null, 2), "utf-8");
  }

  static loadFrom(path: string): QLearningRouter {
    try {
      if (!existsSync(path)) return new QLearningRouter();
      const snap = JSON.parse(readFileSync(path, "utf-8")) as Partial<QLearningSnapshot>;
      return QLearningRouter.fromSnapshot(snap);
    } catch {
      return new QLearningRouter();
    }
  }

  // -----------------------------------------------------------------
  // Helpers (FNV-1a bucketing + seeded RNG).
  // -----------------------------------------------------------------

  /** FNV-1a 32-bit hash, folded into [0, stateDim). Bag-of-words. */
  private bucketize(text: string): number {
    // Tokenise, drop stopwords.
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));

    // If everything was stopwords, the whole string is its own bucket.
    const words = tokens.length > 0 ? tokens : [text.toLowerCase().trim()];

    let acc = 2166136261 >>> 0; // FNV-1a init.
    for (const w of words) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < w.length; i++) {
        h ^= w.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      acc ^= h;
      acc = Math.imul(acc + 0x9e3779b9, 16777619) >>> 0;
    }
    return acc % this.stateDim;
  }

  private random(): number {
    if (this.rngState !== 0) {
      this.rngState = (this.rngState * 1664525 + 1013904223) | 0;
      const u = (this.rngState >>> 0) / 0xffffffff;
      return u || 1e-12;
    }
    return Math.random() || 1e-12;
  }
}

export interface QLearningSnapshot {
  version: number;
  stateDim: number;
  epsilon: number;
  q: number[][];
  counts: number[][];
  rngSeed: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
