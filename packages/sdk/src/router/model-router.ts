/**
 * router/model-router.ts — Adaptive model-tier router.
 *
 * v6.4.0 — ported from ruflo `model-router.ts` (Thompson-sampling bandit,
 * ADR-026 + ADR-143). Trims the surface to what Bizar needs:
 *
 *   - 3 tiers:  `flash` (cheap),  `mid` (default),  `expensive`
 *   - Per-tier Beta(α, β) priors, updated by `recordOutcome()`.
 *   - Marsaglia-Tsang Gamma sampler + Box-Muller normal → sample from Beta
 *     by drawing two Gamma(shape, 1) variates and dividing.
 *   - Tier-1 codemod short-circuit: if `detectCodemodIntent()` says the
 *     prompt is codemod-eligible, we return `{tier: 'flash'}` with
 *     confidence 1.0 and tag `codemodIntent` on the result. This is the
 *     $0 path — no model call required.
 *
 * The tier names match Bizar's actual model lineup
 * (`m2.7-flash`, `m2.7`, `m3`). The ruflo vocabulary uses
 * `haiku / sonnet / opus`; we rename to `flash / mid / expensive`
 * so future call-site code reads naturally.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { detectCodemodIntent } from "./codemod-intent.js";

export type ModelTier = "flash" | "mid" | "expensive";

export interface RouteDecision {
  tier: ModelTier;
  confidence: number;
  codemodIntent?: "var-to-const" | "remove-console" | "add-logging";
}

export interface BetaPrior {
  alpha: number;
  beta: number;
}

const TIERS: ModelTier[] = ["flash", "mid", "expensive"];

/**
 * Default priors — slight optimism for `flash` (so it gets tried for
 * cheap prompts), uniform for `mid`, slight pessimism for `expensive`
 * (it should have to earn its keep). Adjust here, not at the call site.
 */
const DEFAULT_PRIORS: Record<ModelTier, BetaPrior> = {
  flash:     { alpha: 2, beta: 1 }, // mean 2/3 ≈ 0.67
  mid:       { alpha: 1, beta: 1 }, // mean 0.5
  expensive: { alpha: 1, beta: 2 }, // mean 1/3 ≈ 0.33
};

export class ModelRouter {
  private priors: Record<ModelTier, BetaPrior>;
  private rngState: number;

  constructor(opts?: { priors?: Partial<Record<ModelTier, BetaPrior>>; seed?: number }) {
    this.priors = {
      flash:     { ...DEFAULT_PRIORS.flash,     ...(opts?.priors?.flash     ?? {}) },
      mid:       { ...DEFAULT_PRIORS.mid,       ...(opts?.priors?.mid       ?? {}) },
      expensive: { ...DEFAULT_PRIORS.expensive, ...(opts?.priors?.expensive ?? {}) },
    };
    // LCG seed for reproducible sampling in tests. Default uses
    // Math.random() when seed is not provided.
    this.rngState = (opts?.seed ?? 0) | 0;
  }

  /** Read-only access for telemetry / tests. */
  getPriors(): Record<ModelTier, BetaPrior> {
    return {
      flash: { ...this.priors.flash },
      mid: { ...this.priors.mid },
      expensive: { ...this.priors.expensive },
    };
  }

  /**
   * Pick a tier for `prompt`. Codemod-eligible prompts short-circuit
   * to `flash` (the Tier-1 $0 path). Otherwise we Thompson-sample each
   * tier and return the highest sample, with confidence = max_sample
   * (the posterior mean is `α/(α+β)`, and the max-sampled value is a
   * lower bound on the probability that this tier beats the others).
   */
  route(prompt: string): RouteDecision {
    // Tier-1 codemod short-circuit ($0).
    const cm = detectCodemodIntent(prompt);
    if (cm !== null) {
      return { tier: "flash", confidence: 1.0, codemodIntent: cm.intent };
    }

    let best: { tier: ModelTier; sample: number } | null = null;
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
   * `success === true` increments α; `success === false` increments β.
   * Cost-adjusted (ruflo ADR-026 §BANDIT_REWARDS):
   * - flash-success:    +1.0 → α++           (cheap wins are gold)
   * - mid-success:      +0.7 → α += 0.7      (still good)
   * - expensive-success:+0.4 → α += 0.4      (expensive wins are wasteful)
   * - any failure:      β ++
   *
   * The fractional updates work fine with the Beta sampler.
   */
  recordOutcome(tier: ModelTier, success: boolean): void {
    const prior = this.priors[tier];
    if (!prior) return;
    if (success) {
      const reward = tier === "flash" ? 1.0 : tier === "mid" ? 0.7 : 0.4;
      prior.alpha += reward;
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
  priors: Record<ModelTier, BetaPrior>;
  rngSeed: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
