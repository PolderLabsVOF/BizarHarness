/**
 * mistake-recovery.ts
 *
 * v6.0.1 — Built-in `onConsecutiveMistakeLimitReached` callback for the
 * Cline runtime.
 *
 * Why this exists:
 *
 *   The Cline runtime aborts a session after `execution.maxConsecutiveMistakes`
 *   identical-failure turns. The bundled CLI defaults this to 3 (via the
 *   `--retries` flag); the SDK default is 6. When the model emits malformed
 *   tool calls — e.g. `editor({ new_text: undefined })`, `ask_question({ options: null })`,
 *   `run_commands({ ... })` rejected by Zod — the counter increments on every
 *   iteration and the session is dead after a couple of bad turns.
 *
 *   Rather than raising the threshold (which masks the model misbehaviour),
 *   we install a `onConsecutiveMistakeLimitReached` callback that:
 *
 *     • For recoverable mistakes (invalid_tool_call, tool_execution_failed),
 *       injects a recovery notice into the conversation and resets the
 *       counter. Cline's `MistakeTracker.record()` returns
 *       `{ action: "continue", guidance: "..." }` and appends the guidance
 *       as a user message, then continues the run.
 *
 *     • For infra errors (api_error), stops immediately. Retrying a
 *       network/provider failure is wasted work.
 *
 *   This keeps the threshold tight (model discipline matters) while
 *   preventing a single bad turn from killing a long-running task.
 */

import type {
  ConsecutiveMistakeLimitContext,
  ConsecutiveMistakeLimitDecision,
} from "@cline/shared";

const RECOVERABLE_REASONS = new Set<ConsecutiveMistakeLimitContext["reason"]>([
  "invalid_tool_call",
  "tool_execution_failed",
]);

export interface MistakeRecoveryOptions {
  /**
   * Called after the recovery notice is appended but before the run
   * continues. Receives the full context for observability.
   */
  onRecovery?: (ctx: ConsecutiveMistakeLimitContext, guidance: string) => void;
  /**
   * Override the recovery guidance text. Defaults to `BUILTIN_RECOVERY_GUIDANCE`.
   */
  guidance?: string;
}

/**
 * The default guidance appended to the conversation when consecutive
 * recoverable mistakes trip the limit. Kept terse on purpose — longer
 * text dilutes model attention.
 */
export const BUILTIN_RECOVERY_GUIDANCE = [
  "You reached the consecutive-mistake limit. Before retrying:",
  "",
  "1. Re-read the failing tool's input schema. Every required field MUST be",
  "   populated with a non-null value of the right type.",
  "2. For `editor`: `new_text` must be a non-empty string. If you intended",
  "   to delete content, set `new_text` to \"\" (empty string) and use",
  "   `applyPatch` or `delete_file` instead.",
  "3. For `ask_question`: `options` must be an array of ≥2 non-empty",
  "   strings. Do not pass null, undefined, or arrays of length < 2.",
  "4. For `run_commands`: `commands` must be a non-empty array of strings.",
  "5. If you have made two mistakes on the SAME tool, switch tools or stop",
  "   and explain in plain text what went wrong instead of retrying.",
  "",
  "Acknowledge this notice and continue.",
].join("\n");

/**
 * Default stop reason when an unrecoverable mistake hits the limit.
 */
export const BUILTIN_STOP_REASON = "consecutive api_errors — stopping without retry";

/**
 * Build an `onConsecutiveMistakeLimitReached` callback.
 *
 * Pass the result directly to `cline.start({ config: { onConsecutiveMistakeLimitReached } })`.
 */
export function buildMistakeRecovery(
  opts: MistakeRecoveryOptions = {},
): (ctx: ConsecutiveMistakeLimitContext) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision {
  const guidance = opts.guidance ?? BUILTIN_RECOVERY_GUIDANCE;
  const onRecovery = opts.onRecovery;
  return (ctx) => {
    if (RECOVERABLE_REASONS.has(ctx.reason)) {
      onRecovery?.(ctx, guidance);
      return { action: "continue", guidance };
    }
    return { action: "stop", reason: BUILTIN_STOP_REASON };
  };
}
