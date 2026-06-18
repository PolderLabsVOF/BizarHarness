/**
 * research-prompt.ts
 *
 * The intervention message injected into a background session that has been
 * stuck in a thinking loop. The LLM sees this as a new user message and
 * should respond by spawning Mimir or taking other concrete action.
 *
 * Security note: the message is static — it does not interpolate any
 * user-supplied content, prompt, or agent output. The only variable is
 * the duration. This matches the prompt-injection invariant from
 * handoff.ts: the only dynamic content is a short number from our own
 * state, never from agent or user sources.
 *
 * The duration is formatted as `Xm Ys` (or just `Ys` if under a minute)
 * so the agent has concrete context for how long it has been looping.
 * We do not include the instanceId, sessionId, prompt preview, or any
 * other potentially-sensitive content — those would only widen the
 * attack surface without helping the LLM make progress.
 */
export function researchInterventionPrompt(durationMs: number): string {
  const safeMs = Math.max(0, Math.floor(durationMs));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return `[SYSTEM REMINDER — Thinking Loop Detected]

You have been thinking for over ${durationStr} without calling any tools or producing any text output. This is a sign you are stuck in a thinking loop.

To make progress, take ONE of these actions NOW:
1. Use the task tool to spawn a Mimir agent for focused research on the original topic.
2. Use read/grep/glob to gather concrete information from the codebase.
3. Use bash to execute commands that produce observable results.

Do NOT continue thinking without taking action. Make a tool call in your next turn.`;
}