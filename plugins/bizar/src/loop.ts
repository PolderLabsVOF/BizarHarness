/**
 * Loop — the threshold decision tree.
 *
 * Spec requirements satisfied here:
 *   - §5.1 — algorithm. Count how many of the last `loopWindowSize` tool
 *     calls share the given fingerprint. Re-scan the window each call.
 *   - §5.4 — threshold table. The action returned by `decide()` corresponds
 *     to the highest threshold that the count meets or exceeds.
 *   - §5.5 — window vs counter semantics. The count is a re-scan of the
 *     window, not a running counter. The intermediate non-matching calls
 *     in the window do NOT "reset" anything; they just sit in the window
 *     and shift older matching entries out as the window rolls forward.
 *   - §7.2 — the `reason` field returned by `decide()` for warn/escalate/
 *     block actions is a static message from `handoff.ts` with only the
 *     tool name interpolated. No tool args, no LLM output, no agent-
 *     controlled content is ever included.
 *
 * The `now` parameter is part of the public signature for API consistency
 * with the spec (§5.1 timing context) but is not consumed by the decision
 * logic — callers use it to timestamp the current tool call when adding it
 * to the state.
 */

import type { SessionState } from "./state.js";
import type { NormalizedOptions } from "./options.js";
import {
  warnMessage,
  escalateMessage,
  blockMessage,
} from "./handoff.js";

/**
 * The decision returned by `decide()`. The `allow` variant carries no
 * payload; the three action variants carry the canonical handoff message
 * (via `reason`), the fingerprint that triggered the decision, and the
 * repetition count in the window.
 */
export type Decision =
  | { action: "allow" }
  | {
      action: "warn" | "escalate" | "block";
      reason: string;
      fingerprint: string;
      count: number;
    };

/**
 * Implicit "log a warning" threshold from spec §5.4 row 1. This is always
 * two below `loopThresholdWarn` so the gap between log-only and inject-warn
 * stays constant when the user reconfigures. We `max(1, …)` so a user who
 * sets `loopThresholdWarn = 1` does not push the log-only threshold below 1.
 */
function logOnlyThreshold(options: NormalizedOptions): number {
  return Math.max(1, options.loopThresholdWarn - 2);
}

/**
 * Look at the last `loopWindowSize` tool calls and return those that share
 * the given fingerprint. The window is a slice of the most recent entries;
 * older entries are ignored (spec §5.1 step 3).
 */
function windowMatches(
  state: SessionState,
  fingerprint: string,
  windowSize: number,
): { calls: SessionState["toolCalls"]; count: number } {
  if (state.toolCalls.length === 0 || windowSize <= 0) {
    return { calls: [], count: 0 };
  }
  const start = Math.max(0, state.toolCalls.length - windowSize);
  const window = state.toolCalls.slice(start);
  const matches = window.filter((c) => c.fingerprint === fingerprint);
  return { calls: matches, count: matches.length };
}

/**
 * Recover the tool name from any call in `matches` that shares the
 * fingerprint. The fingerprint is computed from `(tool, normalized args)`,
 * so every call with this fingerprint has the same tool name. If the
 * matches list is empty (should not happen when this is called — the
 * caller only invokes us when `count >= 1`), fall back to `"unknown"`.
 */
function toolNameOf(matches: SessionState["toolCalls"]): string {
  const first = matches[0];
  return first ? first.tool : "unknown";
}

/**
 * Build a Decision payload for a non-allow action. Pulls the canonical
 * handoff message for the given action and the tool name recovered from
 * the matching window entries.
 */
function payload(
  action: "warn" | "escalate" | "block",
  fingerprint: string,
  count: number,
  matches: SessionState["toolCalls"],
): Decision {
  const tool = toolNameOf(matches);
  const reason =
    action === "block"
      ? blockMessage(tool)
      : action === "escalate"
        ? escalateMessage(tool)
        : warnMessage(tool);
  return { action, reason, fingerprint, count };
}

/**
 * Decide what action to take for the current tool call.
 *
 * The function is pure: it does not mutate `state` and does not perform any
 * I/O. The caller (the `tool.execute.before` hook in `index.ts`) is
 * responsible for adding the current call to the state before invoking
 * `decide()`, and for acting on the returned decision (log / inject / throw).
 *
 * @param state       The current session state. Must already include the
 *                    current tool call in `state.toolCalls` (the caller
 *                    appends it before calling `decide()`).
 * @param fingerprint The fingerprint of the current tool call.
 * @param now         Current epoch milliseconds. Part of the public signature
 *                    for API consistency; not consumed by the decision logic.
 * @param options     Normalized plugin options.
 */
export function decide(
  state: SessionState,
  fingerprint: string,
  now: number,
  options: NormalizedOptions,
): Decision {
  // Step 1: scan the window.
  const { calls: matches, count } = windowMatches(
    state,
    fingerprint,
    options.loopWindowSize,
  );

  // Step 2: apply thresholds from highest to lowest.
  if (count >= options.loopThresholdBlock) {
    return payload("block", fingerprint, count, matches);
  }
  if (count >= options.loopThresholdEscalate) {
    return payload("escalate", fingerprint, count, matches);
  }
  if (count >= options.loopThresholdWarn) {
    return payload("warn", fingerprint, count, matches);
  }

  // Step 3: log-only band (spec §5.4 row 1). Sits between `allow` and the
  // inject-warn threshold. The caller distinguishes this case from
  // inject-warn by inspecting `count` against `options.loopThresholdWarn`.
  const logOnly = logOnlyThreshold(options);
  if (count >= logOnly) {
    return payload("warn", fingerprint, count, matches);
  }

  // `now` is accepted for API consistency; reference it so strict no-unused
  // linters do not flag the parameter.
  void now;

  return { action: "allow" };
}

/**
 * Convenience helper for the caller: given a `warn` decision, was this the
 * log-only band (no injection) or the inject-warn band? The caller uses
 * this to decide whether to write a `client.app.log` line or to set a
 * pending system-transform injection.
 */
export function isLogOnlyWarn(
  decision: Decision,
  options: NormalizedOptions,
): boolean {
  if (decision.action !== "warn") return false;
  return decision.count < options.loopThresholdWarn;
}
