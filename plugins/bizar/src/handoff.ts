/**
 * Handoff — static message templates for the loop-guard handoff mechanism.
 *
 * Spec requirements satisfied here:
 *   - §5.4 — the three canonical messages emitted at thresholds 5, 8, and 12.
 *   - §7.2 — prompt-injection invariant. The ONLY value interpolated into any
 *     of these strings is the tool name (`<tool>`), which comes from the
 *     opencode tool registry and is a short, well-known identifier (e.g.
 *     `read`, `bash`, `edit`). It is never user content, never LLM output,
 *     never an agent-controlled string. No other interpolation is permitted
 *     in this file. A PR that adds any other interpolation is rejected.
 *   - §11.1, §11.2 — the literal substrings emitted here are the contract
 *     that Odin's loop-guard recogniser and every subagent's canonical
 *     `## Loop Guard Handling` section match against. Pinning the exact text
 *     is the whole point of this module.
 *
 * The threshold numbers ("5", "8", "12") are PART OF THE STATIC TEMPLATE.
 * They are NOT interpolated from the configured threshold or the actual
 * repetition count. This is deliberate: the agent prompts in §11.2 have
 * these literal numbers in their recognition patterns, and any change here
 * would silently break the loop-guard handoff in every subagent. If a user
 * configures non-default thresholds, the messages still emit the canonical
 * text — the action simply fires at different counts than the message
 * implies. This is a known limitation; see README "Limitations" §13.
 */

const WARN_TEMPLATE =
  "[loop guard: 5 identical calls to %TOOL%]. Consider using the task tool to report back to your parent with what you've learned and what you need.";

const ESCALATE_TEMPLATE =
  "[loop guard: 8 identical calls to %TOOL%]. Consider using the task tool to report back to your parent with what you've learned and what you need.";

const BLOCK_TEMPLATE =
  "Loop protection: 12 identical calls to %TOOL%. Use task to escalate.";

/**
 * Replace the `%TOOL%` placeholder in a static template with the given tool
 * name. The placeholder is intentionally not a typical `${...}` expression
 * so it cannot collide with anything inside a tool name. `%TOOL%` is the
 * ONLY substitution performed.
 */
function interpolate(template: string, tool: string): string {
  return template.split("%TOOL%").join(tool);
}

/**
 * Threshold-5 message: system-prompt injection via
 * `experimental.chat.system.transform`. Subagent sees this as a
 * system reminder on its next turn.
 */
export function warnMessage(tool: string): string {
  return interpolate(WARN_TEMPLATE, tool);
}

/**
 * Threshold-8 message: stronger system-prompt injection via
 * `experimental.chat.system.transform`. Same mechanism as `warnMessage`,
 * different template.
 */
export function escalateMessage(tool: string): string {
  return interpolate(ESCALATE_TEMPLATE, tool);
}

/**
 * Threshold-12 message: thrown from `tool.execute.before`. Surfaces in the
 * TUI as a tool error. The plugin's hard-block runs BEFORE opencode's
 * `doom_loop` recovery (spec §3.3), so the plugin wins.
 */
export function blockMessage(tool: string): string {
  return interpolate(BLOCK_TEMPLATE, tool);
}

// Exported for test verification. Tests should assert the templates have not
// drifted from the spec's canonical text.
export const CANONICAL_TEMPLATES = {
  warn: WARN_TEMPLATE,
  escalate: ESCALATE_TEMPLATE,
  block: BLOCK_TEMPLATE,
} as const;
