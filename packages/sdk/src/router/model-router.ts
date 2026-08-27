/**
 * router/model-router.ts — Adaptive model-tier router.
 *
 * v6.4.0 — ported from ruflo `model-router.ts` (Thompson-sampling bandit,
 * ADR-026 + ADR-143). Trims the surface to what Bizar needs:
 *
 *   - 6 tiers:  `premium` | `high` | `mid-design` | `default` | `mid` | `budget`
 *     (canonical `BizarTier` taxonomy, exported by
 *     `./agent-model-registry.js` — IMP-015 closed the 3-tier
 *     `flash / mid / expensive` mismatch).
 *   - Per-tier Beta(α, β) priors, updated by `recordOutcome()`.
 *   - Marsaglia-Tsang Gamma sampler + Box-Muller normal → sample from Beta
 *     by drawing two Gamma(shape, 1) variates and dividing.
 *   - Tier-1 codemod short-circuit: if `detectCodemodIntent()` says the
 *     prompt is codemod-eligible, we return `{tier: 'budget'}` with
 *     confidence 1.0 and tag `codemodIntent` on the result. This is the
 *     $0 path — no model call required.
 *
 * The tier names use Bizar's canonical vocabulary (premium / high /
 * mid-design / default / mid / budget). The earlier 3-tier vocabulary
 * (`flash / mid / expensive`) is deprecated; callers must import
 * `BizarTier` from `./agent-model-registry.js` and stop referencing
 * the old names. The 6-tier mapping for `recordOutcome()` rewards
 * generalises the ruflo ADR-026 §BANDIT_REWARDS table.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { detectCodemodIntent } from "./codemod-intent.js";
import type { BizarTier } from "./agent-model-registry.js";

export type { BizarTier } from "./agent-model-registry.js";

export interface RouteDecision {
  tier: BizarTier;
  confidence: number;
  codemodIntent?: "var-to-const" | "remove-console" | "add-logging";
}

export interface BetaPrior {
  alpha: number;
  beta: number;
}

const TIERS: BizarTier[] = ["premium", "high", "mid-design", "default", "mid", "budget"];

/**
 * Default priors — descending optimism by cost (cheap tiers get a
 * head start so they get tried for cheap prompts; expensive tiers have
 * to earn their keep). Adjust here, not at the call site.
 */
const DEFAULT_PRIORS: Record<BizarTier, BetaPrior> = {
  premium:     { alpha: 1, beta: 2 }, // mean 1/3 ≈ 0.33 (expensive, pessimistic)
  high:        { alpha: 1, beta: 2 }, // mean 1/3 ≈ 0.33
  "mid-design": { alpha: 1, beta: 1 }, // mean 0.5
  default:     { alpha: 1, beta: 1 }, // mean 0.5
  mid:         { alpha: 1, beta: 1 }, // mean 0.5
  budget:      { alpha: 2, beta: 1 }, // mean 2/3 ≈ 0.67 (cheap, optimistic)
};

/**
 * Per-tier reward weights — reward scales inversely with cost. A
 * budget-tier success is treated as the most valuable signal (cheap
 * wins are gold); a premium-tier success is the least valuable
 * (expensive wins are wasteful). Fractional updates work fine with
 * the Beta sampler.
 */
const REWARDS: Record<BizarTier, number> = {
  budget:      1.0,
  mid:         0.85,
  default:     0.85,
  "mid-design": 0.7,
  high:        0.55,
  premium:     0.4,
};

export class ModelRouter {
  private priors: Record<BizarTier, BetaPrior>;
  private rngState: number;

  constructor(opts?: { priors?: Partial<Record<BizarTier, BetaPrior>>; seed?: number }) {
    const overrides = opts?.priors ?? {};
    this.priors = {
      premium:     { ...DEFAULT_PRIORS.premium,     ...(overrides.premium     ?? {}) },
      high:        { ...DEFAULT_PRIORS.high,        ...(overrides.high        ?? {}) },
      "mid-design": { ...DEFAULT_PRIORS["mid-design"], ...(overrides["mid-design"] ?? {}) },
      default:     { ...DEFAULT_PRIORS.default,     ...(overrides.default     ?? {}) },
      mid:         { ...DEFAULT_PRIORS.mid,         ...(overrides.mid         ?? {}) },
      budget:      { ...DEFAULT_PRIORS.budget,      ...(overrides.budget      ?? {}) },
    };
    // LCG seed for reproducible sampling in tests. Default uses
    // Math.random() when seed is not provided.
    this.rngState = (opts?.seed ?? 0) | 0;
  }

  /** Read-only access for telemetry / tests. */
  getPriors(): Record<BizarTier, BetaPrior> {
    return {
      premium: { ...this.priors.premium },
      high: { ...this.priors.high },
      "mid-design": { ...this.priors["mid-design"] },
      default: { ...this.priors.default },
      mid: { ...this.priors.mid },
      budget: { ...this.priors.budget },
    };
  }

  /**
   * Pick a tier for `prompt`. Codemod-eligible prompts short-circuit
   * to `budget` (the Tier-1 $0 path). Otherwise we Thompson-sample each
   * tier and return the highest sample, with confidence = max_sample
   * (the posterior mean is `α/(α+β)`, and the max-sampled value is a
   * lower bound on the probability that this tier beats the others).
   */
  route(prompt: string): RouteDecision {
    // Tier-1 codemod short-circuit ($0).
    const cm = detectCodemodIntent(prompt);
    if (cm !== null) {
      return { tier: "budget", confidence: 1.0, codemodIntent: cm.intent };
    }

    let best: { tier: BizarTier; sample: number } | null = null;
    for (const tier of TIERS) {
      const prior = this.priors[tier];
      const sample = this.sampleBeta(prior.alpha, prior.beta);
      if (best === null || sample > best.sample) {
        best = { tier, sample };
      }
    }
    const confidence = clamp01(best ? best.sample : 0.5);
    return { tier: best ? best.tier : "mid", confidence };
  }

  /**
   * Update the per-tier prior after observing the outcome of a call.
   * `success === true` increments α by the per-tier reward weight;
   * `success === false` increments β by 1. Cost-adjusted (ruflo
   * ADR-026 §BANDIT_REWARDS generalised to the 6-tier vocabulary):
   * - budget-success:      +1.00 → α += 1.00  (cheap wins are gold)
   * - mid-success:         +0.85 → α += 0.85
   * - default-success:     +0.85 → α += 0.85
   * - mid-design-success:  +0.70 → α += 0.70
   * - high-success:        +0.55 → α += 0.55
   * - premium-success:     +0.40 → α += 0.40  (expensive wins are wasteful)
   * - any failure:         β ++
   */
  recordOutcome(tier: BizarTier, success: boolean): void {
    const prior = this.priors[tier];
    if (!prior) return;
    if (success) {
      prior.alpha += REWARDS[tier];
    } else {
      prior.beta += 1;
    }
  }

  // -----------------------------------------------------------------
  // Sampling primitives (lifted from ruflo model-router.ts).
  // Marsaglia-Tsang Gamma + Box-Muller normal. Module-local so we
  // don't pull a stats library for one sampler.
  // -----------------------------------------------------------------

  /** Seeded or Math.random()-backed uniform in [0,1). */
  private random(): number {
    if (this.rngState !== 0) {
      // LCG (Numerical Recipes). Period ~2^32.
      this.rngState = (this.rngState * 1664525 + 1013904223) | 0;
      const u = (this.rngState >>> 0) / 0xffffffff;
      return u || 1e-12;
    }
    return Math.random() || 1e-12;
  }

  /** Box-Muller standard normal sample. */
  private sampleStandardNormal(): number {
    const u1 = this.random();
    const u2 = this.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Marsaglia-Tsang Gamma sample for shape α≥1 (with boost for α<1). */
  private sampleGamma(alpha: number): number {
    if (alpha < 1) {
      const u = this.random();
      return this.sampleGamma(alpha + 1) * Math.pow(u, 1 / alpha);
    }
    const d = alpha - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let x = this.sampleStandardNormal();
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = this.random();
      const xx = x * x;
      if (u < 1 - 0.0331 * xx * xx) return d * v;
      if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Sample from Beta(α, β) via two Gamma draws. */
  private sampleBeta(alpha: number, beta: number): number {
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    const denom = x + y;
    if (denom <= 0) return alpha / (alpha + beta);
    return x / denom;
  }

  // -----------------------------------------------------------------
  // Persistence (ADR-174 invariant: router state survives restarts).
  // We avoid native deps — `.harness/router-state.json` is the
  // canonical store; loading is best-effort and falls back to
  // defaults if the file is missing or corrupt.
  // -----------------------------------------------------------------

  /** JSON snapshot of the current per-tier priors + RNG seed. */
  snapshot(): RouterStateSnapshot {
    return {
      version: 1,
      priors: this.getPriors(),
      rngSeed: this.rngState,
    };
  }

  /** Restore from a snapshot; defaults applied where fields are missing. */
  static fromSnapshot(snap: Partial<RouterStateSnapshot>): ModelRouter {
    return new ModelRouter({
      priors: snap.priors,
      seed: snap.rngSeed,
    });
  }

  /** Persist state to `path`. Creates parent dirs as needed. */
  saveTo(path: string): void {
    const fp = isAbsolute(path) ? path : resolve(path);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, JSON.stringify(this.snapshot(), null, 2), "utf-8");
  }

  /** Load state from `path`. Returns a default router if file is
   *  missing or unparseable. Does NOT throw. */
  static loadFrom(path: string): ModelRouter {
    try {
      if (!existsSync(path)) return new ModelRouter();
      const raw = readFileSync(path, "utf-8");
      const snap = JSON.parse(raw) as Partial<RouterStateSnapshot>;
      return ModelRouter.fromSnapshot(snap);
    } catch {
      return new ModelRouter();
    }
  }
}

export interface RouterStateSnapshot {
  version: number;
  priors: Record<BizarTier, BetaPrior>;
  rngSeed: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
