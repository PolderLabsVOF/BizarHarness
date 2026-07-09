/**
 * tool-discipline.ts
 *
 * v6.0.1 — Tool-call discipline + preference directive injected into
 * every Cline system prompt produced by the Bizar harness.
 *
 * Why this exists:
 *
 *   Cline's runtime aborts sessions when the model emits consecutive
 *   tool calls that fail Zod schema validation (e.g. `editor({ new_text:
 *   undefined })`, `ask_question({ options: null })`,
 *   `run_commands({ ... })`). The defaults in `mistake-recovery.ts` keep
 *   the session alive — but the cheaper fix is preventing the bad tool
 *   calls in the first place.
 *
 *   We also steer the model away from over-using `run_commands` for
 *   things that have a dedicated built-in tool. Built-in tools give
 *   better diffs, easier approval, richer error context, and don't
 *   require shell quoting. Bash is for things that genuinely need a
 *   shell — anything else should hit a specialized tool.
 *
 *   This directive is appended to the system prompt by the harness's
 *   `beforeModel` hook (idempotent: detected via a marker). It is short
 *   enough to stay cheap (~220 tokens) and only fires once per session,
 *   so it does not bloat every turn's context.
 */

export const TOOL_DISCIPLINE_MARKER = "BIZAR_TOOL_DISCIPLINE_v0.6.3";

/**
 * The directive body. Kept compact; details are in the linked recovery
 * notice so we don't duplicate instructions between the system prompt
 * and the recovery callback.
 */
export const TOOL_DISCIPLINE_DIRECTIVE = [
  TOOL_DISCIPLINE_MARKER,
  "",
  "## Tool-call discipline",
  "",
  "• Required fields are required. Populate every field declared in the",
  "  tool's input schema, with a value of the right type. Do not omit",
  "  fields; Cline rejects the call before any side effect runs.",
  "• `editor.new_text` must be a non-empty string. To clear content, use",
  "  `applyPatch` or `delete_file`. To create a new file, pass the",
  "  full intended contents as `new_text`.",
  "• `ask_question.options` must be an array of ≥2 non-empty strings.",
  "  Passing `null`, `undefined`, or arrays of length <2 fails schema",
  "  validation.",
  "• `run_commands.commands` must be a non-empty array of strings.",
  "• If a tool call fails validation twice in a row, switch tools or",
  "  describe the problem in plain text before retrying. Do not loop on",
  "  the same mistake.",
  "",
  "## Prefer built-in tools over bash",
  "",
  "Cline ships dedicated tools for most file/shell work. Reach for them",
  "before reaching for `run_commands`:",
  "",
  "| If you want to…                       | Use this, not bash           |",
  "| ------------------------------------- | ---------------------------- |",
  "| read a file                           | `read_file`                  |",
  "| search a workspace                    | `search_codebase` / `search` |",
  "| edit a file in place                  | `editor` or `apply_patch`    |",
  "| create a new file                     | `editor` (new_text = full)   |",
  "| list a directory                      | `list_files`                 |",
  "| fetch a URL                           | `web_fetch`                  |",
  "| run a build / test / lint / script    | `run_commands`               |",
  "",
  "Reaching for bash first creates two problems:",
  "  1. Shell quoting bugs (quotes-in-quotes-in-quotes) are the most",
  "     common cause of malformed tool calls.",
  "  2. Each bash command lands in tool history as opaque output; a",
  "     dedicated tool keeps diffs, error context, and approval gates",
  "     intact.",
  "",
  "When you DO call `run_commands`, keep it small:",
  "",
  "• One logical command per call. Do not chain unrelated segments with",
  "  `&&`. Use multiple `run_commands` turns instead — each turn's output",
  "  is easier to debug and re-run.",
  "• Pass file paths via the tool's structured fields (`editor.path`,",
  "  `read_file.path`) — never as `cd ... && <cmd>` chdir hacks.",
  "• Hard cap: do not emit a single command longer than ~600 chars. If",
  "  the command doesn't fit, it's a sign you should use a built-in tool",
  "  or split it across turns.",
  "• No `for i in $(seq 1 100)` loops for batching work that has a tool",
  "  (`read_file`, `editor`). Loops in bash hide per-file failures.",
  "• No `xargs`, no `sed -i`, no heredocs to write files — these all",
  "  have a dedicated tool that produces a richer record.",
  "",
  "These conventions avoid both the consecutive-mistake abort and the",
  "common shell-quoting trap.",
].join("\n");

/**
 * Bump this constant when the directive body changes in a way that
 * warrants re-injection into existing sessions. The harness uses the
 * marker to detect "already injected", so an updated directive will
 * only land if a fresh session starts (or marker changes).
 */
export const TOOL_DISCIPLINE_VERSION = "0.6.3";

export function hasToolDiscipline(systemPrompt: string | undefined): boolean {
  return typeof systemPrompt === "string" && systemPrompt.includes(TOOL_DISCIPLINE_MARKER);
}
