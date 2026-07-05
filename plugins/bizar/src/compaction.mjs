/**
 * compaction.mjs
 *
 * Context-window compaction gate.
 *
 * Monitors a chat session's context-usage ratio and reports whether the
 * session has reached the compaction threshold (default 50% of the model's
 * max-context window). When the ratio crosses the threshold, callers can
 * trigger summarization of the older message history while preserving a
 * configurable recent tail so the model retains short-term continuity.
 *
 * Spec contract:
 *   - The threshold is the *ratio* `usage.total / maxContext`, NOT an
 *     absolute token count. This makes the gate model-agnostic — it works
 *     whether the model has a 32k, 128k, or 1M context window.
 *   - `shouldCompact` is a pure function: same inputs → same output, no I/O.
 *   - `maybeCompactSession` is async to match the real summarizer signature
 *     but performs no I/O itself when below threshold — it short-circuits.
 *   - Threshold is mutable via `setCompactionThreshold` and is validated
 *     against the range [0.1, 1.0]. A throw is the right signal here —
 *     misconfiguration should fail loudly at startup, not silently use a
 *     bad value at runtime.
 *   - Threshold uses `let` (not `const`) so the setter can mutate it.
 *     The reference spec used `const` and would throw a TypeError on
 *     assignment; this implementation keeps the API but fixes the bug.
 */

const PRESERVE_RECENT_MESSAGES_DEFAULT = 10;
const MIN_THRESHOLD = 0.1;
const MAX_THRESHOLD = 1.0;

// Module-level threshold. Exposed via get/set for tunability.
// Exported as a number via getCompactionThreshold(); the underlying binding
// is private (not exported) so callers cannot bypass validation by writing
// to it directly.
let compactionThreshold = 0.5;

/**
 * Returns `true` when `usage.total / maxContext` meets or exceeds the
 * compaction threshold. `false` when below, or when either input is
 * missing/invalid (defensive default).
 *
 * @param {{ total?: number } | null | undefined} usage
 *   Object with a `total` token count, or null/undefined.
 * @param {number | null | undefined} maxContext
 *   Maximum context window size in tokens.
 * @returns {boolean}
 */
export function shouldCompact(usage, maxContext) {
  if (!usage || typeof usage.total !== "number") return false;
  if (typeof maxContext !== "number" || maxContext <= 0) return false;
  const ratio = usage.total / maxContext;
  return ratio >= compactionThreshold;
}

/**
 * Decision-shaped result returned by `maybeCompactSession`.
 *
 * - When below threshold: `{ compacted: false, reason: "below_threshold", ratio }`.
 * - When at/over threshold: `{ compacted: true, sessionId, threshold,
 *   preservedRecent, atMessages, ratio }`.
 *
 * @typedef {Object} CompactionResult
 * @property {boolean} compacted
 * @property {"below_threshold"} [reason]              when compacted=false
 * @property {string} [sessionId]
 * @property {number} [threshold]                     the threshold at decision time
 * @property {number} [preservedRecent]               how many recent messages to keep verbatim
 * @property {number} [atMessages]                    message count at decision time
 * @property {number} [ratio]                         usage.total / maxContext
 */

/**
 * Decide whether to compact and, if so, record the decision. The summarizer
 * is NOT invoked here — that is the caller's responsibility. This function
 * is the decision gate, not the executor. (The summarizer receives an
 * `Array<string>` of older messages and returns a single summary string.)
 *
 * @param {Object}   opts
 * @param {string}   opts.sessionId
 * @param {number}   opts.messageCount                total messages in the session
 * @param {{ total?: number } | null | undefined} opts.currentUsage
 * @param {number | null | undefined} opts.maxContext
 * @param {(texts: string[]) => Promise<string>} opts.summarizer
 *   Async summarizer used by the caller when `compacted === true`. Not invoked
 *   here. Accepting it as a parameter documents the contract for downstream
 *   callers without forcing this function to do I/O.
 * @param {number}   [opts.preserveRecent=10]         how many recent messages to keep verbatim
 * @returns {Promise<CompactionResult>}
 */
export async function maybeCompactSession({
  sessionId,
  messageCount,
  currentUsage,
  maxContext,
  // summarizer is accepted for API symmetry with downstream callers; we do
  // not invoke it here because compaction execution lives in the plugin
  // hook layer, not in this pure decision gate.
  summarizer, // eslint-disable-line no-unused-vars
  preserveRecent = PRESERVE_RECENT_MESSAGES_DEFAULT,
}) {
  if (typeof sessionId !== "string" || sessionId === "") {
    // Misuse — caller forgot a sessionId. Refuse rather than silently
    // returning below_threshold, which would mask a real bug upstream.
    throw new Error("maybeCompactSession: sessionId is required");
  }

  if (!shouldCompact(currentUsage, maxContext)) {
    const ratio = computeRatio(currentUsage, maxContext);
    return { compacted: false, reason: "below_threshold", ratio };
  }

  const ratio = computeRatio(currentUsage, maxContext);
  return {
    compacted: true,
    sessionId,
    threshold: compactionThreshold,
    preservedRecent: preserveRecent,
    atMessages: messageCount,
    ratio,
  };
}

/**
 * Return the current compaction threshold (0.0–1.0).
 *
 * @returns {number}
 */
export function getCompactionThreshold() {
  return compactionThreshold;
}

/**
 * Set the compaction threshold. Validates the new value is in the range
 * `[0.1, 1.0]` and is a finite number. Throws on invalid input.
 *
 * The minimum of 0.1 prevents pathological "compact at 10%" configurations
 * that would shred the conversation on the first reply. The maximum of 1.0
 * means "compact only when the context is full" — anything above 1.0 would
 * mean "never compact", which `shouldCompact` already handles correctly, so
 * we reject it for clarity.
 *
 * @param {number} value
 * @returns {void}
 */
export function setCompactionThreshold(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid compaction threshold: ${value} (must be a finite number)`);
  }
  if (value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
    throw new Error(
      `Invalid compaction threshold: ${value} (must be in [${MIN_THRESHOLD}, ${MAX_THRESHOLD}])`,
    );
  }
  compactionThreshold = value;
}

/**
 * Reset the threshold and preserve-count to their defaults. Exposed for
 * tests and for plugin re-init (so a hot-reload doesn't carry stale state).
 *
 * @returns {void}
 */
export function resetCompactionDefaults() {
  compactionThreshold = 0.5;
}

/**
 * Return the number of recent messages that the default policy preserves
 * verbatim when compacting.
 *
 * @returns {number}
 */
export function getDefaultPreserveRecent() {
  return PRESERVE_RECENT_MESSAGES_DEFAULT;
}

// --- Internal helpers -----------------------------------------------------

/**
 * Compute `usage.total / maxContext`, or `null` when either input is
 * missing/invalid. Returns a number in `[0, +Infinity)` for valid inputs.
 *
 * @param {{ total?: number } | null | undefined} usage
 * @param {number | null | undefined} maxContext
 * @returns {number | null}
 */
function computeRatio(usage, maxContext) {
  if (!usage || typeof usage.total !== "number") return null;
  if (typeof maxContext !== "number" || maxContext <= 0) return null;
  return usage.total / maxContext;
}