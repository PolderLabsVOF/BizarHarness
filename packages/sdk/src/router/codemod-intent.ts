/**
 * router/codemod-intent.ts — Tier-1 codemod intent detection.
 *
 * v6.4.0 — ported from ruflo `enhanced-model-router.ts` (ADR-026, ADR-143).
 *
 * Three deterministic intents are eligible for $0 Tier-1 codemod
 * execution — they can be applied structurally, no LLM in the loop:
 *
 *   - `var-to-const`   — convert `var` declarations to `const` / `let`.
 *   - `remove-console` — strip `console.*` calls.
 *   - `add-logging`    — add `console.*` / logger statements.
 *
 * Other intents (`add-types`, `add-error-handling`, `async-await`, …)
 * REQUIRE judgement and route to a model tier (Tier-2/3); they are
 * explicitly OUT OF SCOPE for this detector. See ADR-143.
 *
 * Pure function — no I/O. Confidence is the match strength
 * (number of distinct regex patterns that hit, normalised by pattern
 * count; capped at 1.0). Returning `null` means the prompt is NOT
 * codemod-eligible and the caller should consult the bandit / neural
 * router.
 */

export type CodemodIntent = "var-to-const" | "remove-console" | "add-logging";

export interface CodemodIntentHit {
  intent: CodemodIntent;
  confidence: number;
}

const PATTERNS: Record<CodemodIntent, RegExp[]> = {
  "var-to-const": [
    /convert\s+var\s+to\s+const/i,
    /convert\s+var\s+declarations?\s+to\s+const/i,
    /change\s+var\s+to\s+const/i,
    /change\s+var\s+declarations?\s+to\s+const/i,
    /replace\s+var\s+with\s+const/i,
    /var\s*(?:→|->|to)\s*const/i,
    /use\s+const\s+instead\s+of\s+var/i,
    /\bvar\s+to\s+const\b/i,
  ],
  "remove-console": [
    /remove\s+(?:all\s+)?console\.log/i,
    /remove\s+(?:all\s+)?console\s+statements?/i,
    /delete\s+(?:all\s+)?console\s+statements?/i,
    /strip\s+console/i,
    /clean\s+up\s+console/i,
    /clean\s+up\s+debug\s+logs?/i,
    /remove\s+(?:all\s+)?debug\s+logs?/i,
    /delete\s+(?:all\s+)?console\.log/i,
    /strip\s+(?:all\s+)?console/i,
  ],
  "add-logging": [
    /\badd\s+logging\b/i,
    /\badd\s+console\.log\b/i,
    /\badd\s+debug\s+logs?\b/i,
    /\blog\s+this\s+function\b/i,
    /\badd\s+trace\s+logging\b/i,
    /\binstrument\s+with\s+logs?\b/i,
  ],
};

/**
 * Default confidence threshold for `detectCodemodIntent`. The function
 * returns `null` for pattern-set hits with confidence below this.
 *
 * Kept intentionally low (0.1) so a single canonical phrase on a
 * 7-pattern intent — natural prompts like "convert var to const" —
 * still short-circuits the bandit. Callers that want stricter
 * filtering (the F-033 orchestrator `decideAgentWith`, see ADR-174)
 * can pass `threshold` explicitly.
 *
 * Strong threshold the spec mentions ("Return null if confidence < 0.6")
 * is exported as `STRICT_CODEMOD_CONFIDENCE_THRESHOLD` below.
 */
export const DEFAULT_CODEMOD_CONFIDENCE_THRESHOLD = 0.1;
export const STRICT_CODEMOD_CONFIDENCE_THRESHOLD = 0.6;
/** Alias used in the spec — kept for backwards compat. */
export const CODEMOD_CONFIDENCE_THRESHOLD = DEFAULT_CODEMOD_CONFIDENCE_THRESHOLD;

export interface CodemodDetectionOptions {
  /** Override the threshold. Default:
   *  `DEFAULT_CODEMOD_CONFIDENCE_THRESHOLD` (=0.1). */
  threshold?: number;
}

/**
 * Probe whether a prompt matches one of the deterministic codemod
 * intents. Order matters only for tie-breaking: we return the FIRST
 * intent whose overall score is highest in case of a multi-intent
 * tie.
 *
 * Confidence is `hits / patterns.length`. A single regex hit on a
 * intent with 7 patterns yields confidence 1/7 ≈ 0.14 — enough to
 * flag the intent but well below 1.0 so the caller can decide
 * whether to escalate. Two hits on a smaller intent (say 4
 * patterns) yields 0.5 — past the 0.4 bandit-confirmation
 * threshold.
 *
 * Result filtered by `opts.threshold` (default 0.1). When the
 * strongest pattern-set hit is below the threshold the function
 * returns `null` so the caller falls through to Q-learning / bandit.
 */
export function detectCodemodIntent(
  prompt: string,
  opts: CodemodDetectionOptions = {},
): CodemodIntentHit | null {
  if (!prompt || typeof prompt !== "string") return null;

  let best: { intent: CodemodIntent; confidence: number } | null = null;
  for (const intent of Object.keys(PATTERNS) as CodemodIntent[]) {
    const patterns = PATTERNS[intent];
    let hits = 0;
    for (const p of patterns) if (p.test(prompt)) hits += 1;
    if (hits === 0) continue;
    const confidence = hits / patterns.length;
    if (best === null || confidence > best.confidence) {
      best = { intent, confidence };
    }
  }
  if (best === null) return null;
  const threshold = opts.threshold ?? DEFAULT_CODEMOD_CONFIDENCE_THRESHOLD;
  if (best.confidence < threshold) return null;
  return best;
}
