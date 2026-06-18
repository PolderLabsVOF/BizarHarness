/**
 * commands.ts
 *
 * v0.5.0 — Pure slash-command parser.
 *
 * The plugin's `chat.message` hook calls `parseSlashCommand(text, ctx)`
 * on every user message. If the message starts with `/`, this function
 * classifies it as a known command or returns `null` (so the message
 * passes through to the LLM normally).
 *
 * Design constraints:
 *   - Pure function. No I/O, no environment reads, no Date.now() calls
 *     inside the parser itself.
 *   - The function is the **only** place slash commands are parsed.
 *     The hook gathers context (current settings, available plan slugs)
 *     and feeds it to the parser, then dispatches the returned
 *     `sideEffect` via `executeSideEffect()` in commands-impl.ts.
 *   - Returns `null` for non-slash messages so the LLM still sees them.
 *
 * Output shape (per slash command):
 *   `{ handled: true, response, settingsPatch?, sideEffect? }`
 *
 *   - `response`: text surfaced to the user / LLM.
 *   - `settingsPatch`: optional partial `PlanSettings` to apply.
 *   - `sideEffect`: optional descriptor for the hook to execute. The
 *     `tool_invocation` kind routes through `executeToolInvocation`,
 *     which builds a synthetic `ToolContext` and invokes the
 *     registered tool directly. The other kinds (`create_plan`,
 *     `list_plans`, `open_plan_url`) are handled by
 *     `executeSideEffect` in commands-impl.ts.
 *
 * The parser is unit-tested directly (tests/commands.test.ts).
 * Side-effect execution is tested in tests/commands-impl.test.ts.
 */

import type { DefaultTemplate, PlanSettings } from "./settings.js";
import { KNOWN_TEMPLATES } from "./settings.js";

// --- Public types --------------------------------------------------------

/**
 * What the parser asks the chat.message hook to do on the host side.
 *
 * v0.5.0 — extended with the `tool_invocation` kind (per C3). Subcommand
 * parsers translate the user's typed subcommand into a `tool_invocation`
 * side-effect that calls a real `bizar_*` tool with a synthetic
 * `ToolContext`. The chat hook does not need to know about the tool
 * layer; it just hands the descriptor to `executeToolInvocation`.
 */
export type SideEffect =
  | {
      kind: "create_plan";
      slug: string;
      template: DefaultTemplate | null;
    }
  | {
      kind: "open_plan_url";
      slug: string;
    }
  | {
      kind: "list_plans";
    }
  | {
      kind: "tool_invocation";
      toolName: string;
      args: unknown;
    };

export interface SlashCommandResult {
  handled: true;
  /** Text shown to the user / LLM. */
  response: string;
  /** Optional settings mutation. */
  settingsPatch?: Partial<PlanSettings>;
  /** Optional side-effect to perform (file I/O lives in the hook, not here). */
  sideEffect?: SideEffect;
}

/**
 * Context passed to the parser. The parser does NOT call `getCurrentSettings`
 * itself — instead the caller injects the live values. This keeps the parser
 * pure and lets tests stub the context.
 */
export interface ParseContext {
  /** Current plan settings (already loaded by the caller). */
  currentSettings: PlanSettings;
  /** Slugs of plans that exist in the worktree's plans/ directory. */
  availablePlanSlugs?: readonly string[];
  /**
   * The default port for `/plan open <slug>` URLs. The viewer runs in-process
   * on 127.0.0.1:4321-4330. v0.5.0 defers actually starting the server; the
   * URL is informational only.
   */
  defaultPort?: number;
}

// --- Internals -----------------------------------------------------------

/** Same slug rule used by `cli/plan.mjs`. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isValidSlug(s: string): boolean {
  return SLUG_REGEX.test(s);
}

function isKnownTemplate(t: string): t is DefaultTemplate {
  return (KNOWN_TEMPLATES as readonly string[]).includes(t);
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Valid status values for `/plan status`. Mirrors plan-action.ts. */
const PLAN_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "in-progress",
  "done",
] as const;
type PlanStatus = (typeof PLAN_STATUSES)[number];

function isPlanStatus(s: string): s is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(s);
}

// --- Tokenization --------------------------------------------------------

/**
 * Tokenize a subcommand argument string into argv-like tokens, with
 * double-quoted strings preserved as a single token. This is just
 * enough for our flag parser; it does not support escape sequences
 * beyond `\"`.
 *
 * Examples:
 *   `add foo --title "Hello world" --type task` →
 *     ["add", "foo", "--title", "Hello world", "--type", "task"]
 *   `comment foo "Make this bigger"` →
 *     ["comment", "foo", "Make this bigger"]
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < input.length && input[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur !== "") {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "") tokens.push(cur);
  return tokens;
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

/**
 * Parse a flag list of the form `--key value` (or `--key=value`).
 * Positional arguments (no leading `--`) come back in order. Flags
 * without a value (e.g. `--verbose`) are stored as `""`.
 */
function parseFlags(tokens: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq !== -1) {
        flags[t.slice(2, eq)] = t.slice(eq + 1);
        continue;
      }
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "";
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}

// --- The main parser -----------------------------------------------------

/**
 * Parse a user message and decide whether it's a slash command.
 *
 * Returns:
 *   - `null`                          — not a slash command; pass through.
 *   - `SlashCommandResult`            — slash command was recognized.
 *
 * Recognized commands:
 *   - `/visual-plan on|off|status`   — settings patch only
 *   - `/plan new <slug> [template]`   — create_plan
 *   - `/plan list`                    — list_plans
 *   - `/plan open <slug>`             — open_plan_url
 *   - `/plan get <slug>`              — tool_invocation: bizar_plan_action (get_canvas)
 *   - `/plan add <slug> [--title … --type … --x N --y N …]`
 *                                     — tool_invocation: bizar_plan_action (add_element)
 *   - `/plan update <slug> <id> [--x N --y N --title T --content C]`
 *                                     — tool_invocation: bizar_plan_action (update_element)
 *   - `/plan delete <slug> <id>`      — tool_invocation: bizar_plan_action (delete_element)
 *   - `/plan comment <slug> [id] "text"`
 *                                     — tool_invocation: bizar_plan_action (add_comment)
 *   - `/plan status <slug> <status>`  — tool_invocation: bizar_plan_action (set_status)
 *   - `/plan comments <slug> [id]`    — tool_invocation: bizar_get_plan_comments
 *   - `/plan wait <slug> [--timeout N]`
 *                                     — deferred (returns response; no tool call)
 *   - `/help` / `/commands`           — help text
 */
export function parseSlashCommand(
  text: string,
  ctx: ParseContext,
): SlashCommandResult | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!trimmed.startsWith("/")) return null;

  // Just a bare slash — not a command
  if (trimmed === "/") return null;

  // Match `/<command>` optionally followed by whitespace and args
  const match = /^\/([a-zA-Z][\w-]*)(?:\s+(.*))?$/.exec(trimmed);
  if (match === null) return null;

  const command = match[1]!.toLowerCase();
  const rest = (match[2] ?? "").trim();

  switch (command) {
    case "visual-plan":
      return handleVisualPlan(rest, ctx);
    case "plan":
      return handlePlan(rest, ctx);
    case "help":
    case "commands":
      return helpResult();
    default:
      return {
        handled: true,
        response: `Unknown command: /${command}. Try /help for a list of available commands.`,
      };
  }
}

// --- Command handlers ----------------------------------------------------

function handleVisualPlan(arg: string, ctx: ParseContext): SlashCommandResult {
  const lc = arg.toLowerCase();

  if (lc === "") {
    // No argument — return current state
    const on = ctx.currentSettings.visualPlanEnabled ? "on" : "off";
    return {
      handled: true,
      response:
        `Visual plan mode is **${on}**.\n` +
        `Default template: ${ctx.currentSettings.defaultTemplate}\n` +
        (ctx.currentSettings.lastUsedSlug
          ? `Last used plan: ${ctx.currentSettings.lastUsedSlug}\n`
          : "") +
        `\nUsage: /visual-plan on | off`,
    };
  }

  if (lc === "on" || lc === "true" || lc === "1" || lc === "enable") {
    return {
      handled: true,
      response: "Visual plan mode is now **on**. The agent will create a plan and wait for feedback on complex tasks.",
      settingsPatch: { visualPlanEnabled: true },
    };
  }

  if (lc === "off" || lc === "false" || lc === "0" || lc === "disable") {
    return {
      handled: true,
      response: "Visual plan mode is now **off**.",
      settingsPatch: { visualPlanEnabled: false },
    };
  }

  if (lc === "status" || lc === "state" || lc === "?") {
    const on = ctx.currentSettings.visualPlanEnabled ? "on" : "off";
    return {
      handled: true,
      response: `Visual plan mode: ${on}`,
    };
  }

  return {
    handled: true,
    response: `Unknown argument to /visual-plan: "${arg}". Use "on" or "off".`,
  };
}

function handlePlan(arg: string, ctx: ParseContext): SlashCommandResult {
  if (arg === "") {
    return helpPlan();
  }

  // Split subcommand from its args
  const tokens = tokenize(arg);
  const sub = (tokens[0] ?? "").toLowerCase();
  const subTokens = tokens.slice(1);

  switch (sub) {
    case "new":
      return handlePlanNew(subTokens, ctx);
    case "list":
    case "ls":
      return handlePlanList(ctx);
    case "open":
      return handlePlanOpen(subTokens, ctx);
    case "get":
      return handlePlanGet(subTokens);
    case "add":
      return handlePlanAdd(subTokens);
    case "update":
      return handlePlanUpdate(subTokens);
    case "delete":
    case "del":
    case "rm":
      return handlePlanDelete(subTokens);
    case "comment":
    case "comments":
      // `/plan comment` is the add-comment verb; `/plan comments` is the
      // list-comments verb. Disambiguate by looking at the first token.
      if (sub === "comments") return handlePlanComments(subTokens);
      return handlePlanComment(subTokens);
    case "status":
      return handlePlanStatus(subTokens);
    case "comments-list":
      return handlePlanComments(subTokens);
    case "wait":
      return handlePlanWait(subTokens);
    default:
      return {
        handled: true,
        response: `Unknown /plan subcommand: "${sub}". Try /plan for usage.`,
      };
  }
}

function helpPlan(): SlashCommandResult {
  return {
    handled: true,
    response:
      `Plan commands:\n` +
      `  /plan new <slug> [template]                — Create a new plan\n` +
      `  /plan list                                — List all plans in the worktree\n` +
      `  /plan open <slug>                         — Return the URL for a plan\n` +
      `  /plan get <slug>                          — Fetch the full canvas\n` +
      `  /plan add <slug> --title T --type kind    — Add an element to a plan\n` +
      `  /plan update <slug> <id> [--x N --y N …]  — Patch an existing element\n` +
      `  /plan delete <slug> <id>                  — Remove an element\n` +
      `  /plan comment <slug> [id] "text"          — Add a comment (canvas-pinned if no id)\n` +
      `  /plan comments <slug> [id]                — Read comments on a plan\n` +
      `  /plan status <slug> <status>              — Set the plan's status\n` +
      `  /plan wait <slug> [--timeout N]           — Wait for feedback (deferred — see note)\n` +
      `\nAvailable templates: ${KNOWN_TEMPLATES.join(", ")}\n` +
      `Available statuses: ${PLAN_STATUSES.join(", ")}`,
  };
}

// --- /plan new ------------------------------------------------------------

function handlePlanNew(args: string[], ctx: ParseContext): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return {
      handled: true,
      response: "Usage: /plan new <slug> [template]",
    };
  }

  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response:
        `Invalid slug "${slug}". Slug must be lowercase, may contain hyphens, ` +
        `must start with an alphanumeric character, and be 1–64 characters.`,
    };
  }

  // Optional second arg is the template name
  let template: DefaultTemplate | null = null;
  if (args.length >= 2 && args[1] !== "") {
    const candidate = args[1]!.toLowerCase();
    if (!isKnownTemplate(candidate)) {
      return {
        handled: true,
        response:
          `Unknown template "${args[1]}". Available: ${KNOWN_TEMPLATES.join(", ")}.`,
      };
    }
    template = candidate;
  }

  // The response surfaces the resolved template name (the user-supplied
  // argument, or the user's current default). The sideEffect carries
  // the explicit `null` so the executor knows to fall back to
  // `currentSettings.defaultTemplate` at write time.
  const resolvedTemplate = template ?? ctx.currentSettings.defaultTemplate;

  return {
    handled: true,
    response:
      `Plan "${titleCase(slug)}" (slug: ${slug}) will be created with the ` +
      `"${resolvedTemplate}" template.\n` +
      `After creation, use /plan open ${slug} to get the URL.`,
    sideEffect: {
      kind: "create_plan",
      slug,
      template,
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan list ----------------------------------------------------------

function handlePlanList(ctx: ParseContext): SlashCommandResult {
  const slugs = ctx.availablePlanSlugs ?? [];
  if (slugs.length === 0) {
    return {
      handled: true,
      response:
        "No plans found in this worktree. Use /plan new <slug> to create one.",
      sideEffect: { kind: "list_plans" },
    };
  }
  const lines = slugs.map((s) => `  - ${s}`);
  return {
    handled: true,
    response: `Plans in this worktree (${slugs.length}):\n${lines.join("\n")}`,
    sideEffect: { kind: "list_plans" },
  };
}

// --- /plan open ----------------------------------------------------------

function handlePlanOpen(args: string[], ctx: ParseContext): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return {
      handled: true,
      response: "Usage: /plan open <slug>",
    };
  }

  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }

  const port = ctx.defaultPort ?? 4321;
  const url = `http://localhost:${port}/${slug}/`;

  return {
    handled: true,
    response:
      `Plan URL: ${url}\n` +
      `(v0.5.0 MVP — server startup is a future enhancement; the URL is ` +
      `informational. Use "bizarharness plan open ${slug}" in the terminal to ` +
      `start the local viewer.)`,
    settingsPatch: { lastUsedSlug: slug },
    sideEffect: {
      kind: "open_plan_url",
      slug,
    },
  };
}

// --- /plan get -----------------------------------------------------------

function handlePlanGet(args: string[]): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return { handled: true, response: "Usage: /plan get <slug>" };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  return {
    handled: true,
    response: `Fetching canvas for plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: slug },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan add -----------------------------------------------------------

const ELEMENT_FLAG_KEYS = [
  "title",
  "content",
  "type",
  "id",
] as const;
type ElementFlagKey = (typeof ELEMENT_FLAG_KEYS)[number];

const ELEMENT_NUMERIC_FLAG_KEYS = ["x", "y", "width", "height"] as const;
type ElementNumericFlagKey = (typeof ELEMENT_NUMERIC_FLAG_KEYS)[number];

function readElementFlags(flags: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ELEMENT_FLAG_KEYS) {
    const v = flags[k];
    if (v !== undefined && v !== "") out[k] = v;
  }
  for (const k of ELEMENT_NUMERIC_FLAG_KEYS) {
    const v = flags[k];
    if (v !== undefined && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

function handlePlanAdd(args: string[]): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return {
      handled: true,
      response: 'Usage: /plan add <slug> --title "Title" --type task [--x N --y N --width N --height N --content "…"]',
    };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  const { flags } = parseFlags(args.slice(1));
  const element = readElementFlags(flags);
  if (Object.keys(element).length === 0) {
    return {
      handled: true,
      response:
        `Usage: /plan add ${slug} --title "Title" --type task [--x N --y N --width N --height N --content "…"]\n` +
        `At least one of --title / --type / --content / --x / --y is required.`,
    };
  }
  return {
    handled: true,
    response: `Adding element to plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "add_element", planSlug: slug, element },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan update --------------------------------------------------------

function handlePlanUpdate(args: string[]): SlashCommandResult {
  if (args.length < 2 || args[0] === "" || args[1] === "") {
    return {
      handled: true,
      response:
        'Usage: /plan update <slug> <elementId> [--x N --y N --title T --content C --width N --height N --type kind]',
    };
  }
  const slug = args[0]!;
  const elementId = args[1]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  if (elementId === "") {
    return {
      handled: true,
      response: "Element id cannot be empty.",
    };
  }
  const { flags } = parseFlags(args.slice(2));
  const element = readElementFlags(flags);
  if (Object.keys(element).length === 0) {
    return {
      handled: true,
      response:
        `Usage: /plan update ${slug} ${elementId} [--x N --y N --title T --content C --width N --height N --type kind]\n` +
        `At least one update flag is required.`,
    };
  }
  return {
    handled: true,
    response: `Updating element ${elementId} in plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "update_element", planSlug: slug, elementId, element },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan delete --------------------------------------------------------

function handlePlanDelete(args: string[]): SlashCommandResult {
  if (args.length < 2 || args[0] === "" || args[1] === "") {
    return {
      handled: true,
      response: "Usage: /plan delete <slug> <elementId>",
    };
  }
  const slug = args[0]!;
  const elementId = args[1]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  return {
    handled: true,
    response: `Deleting element ${elementId} from plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "delete_element", planSlug: slug, elementId },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan comment (add) -------------------------------------------------

function handlePlanComment(args: string[]): SlashCommandResult {
  // /plan comment <slug> [elementId] "text"
  // The text is the LAST positional arg. The slug is first. The middle
  // arg (if any) is the elementId. We re-tokenize the raw arg string
  // (NOT the tokenized form) so that quoted text is preserved as a
  // single token. We've already tokenized at the parent level, so
  // we re-tokenize the raw form here by joining back together.
  // The parent passes a tokenized array, so we look at the trailing
  // token and assume the text is the last non-flag argument. The
  // parent already did quote-preserving tokenization, so trailing
  // tokens after the slug/elementId are the text.
  if (args.length < 2 || args[0] === "") {
    return {
      handled: true,
      response: 'Usage: /plan comment <slug> [elementId] "text"',
    };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  // Disambiguate: if the second token is a flag, then there's no
  // elementId and the rest is the text.
  if (args[1]!.startsWith("--")) {
    // No elementId; everything after slug is text.
    const text = args.slice(1).join(" ").trim();
    if (text === "") {
      return { handled: true, response: "Comment text is required." };
    }
    return commentSideEffect(slug, null, text);
  }
  // If exactly 2 args, treat second as text (no elementId).
  if (args.length === 2) {
    return commentSideEffect(slug, null, args[1]!);
  }
  // 3+ args: slug, elementId, text. The text may itself be quoted
  // already (the parent tokenizer preserves quoted strings), so we
  // join the rest with spaces.
  const elementId = args[1]!;
  const text = args.slice(2).join(" ").trim();
  if (text === "") {
    return { handled: true, response: "Comment text is required." };
  }
  return commentSideEffect(slug, elementId, text);
}

function commentSideEffect(
  slug: string,
  elementId: string | null,
  text: string,
): SlashCommandResult {
  return {
    handled: true,
    response:
      elementId === null
        ? `Adding canvas-pinned comment to plan "${slug}"…`
        : `Adding comment to element ${elementId} on plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: {
        action: "add_comment",
        planSlug: slug,
        comment: {
          elementId,
          author: "user",
          text,
        },
      },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan comments (list) -----------------------------------------------

function handlePlanComments(args: string[]): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return { handled: true, response: "Usage: /plan comments <slug> [elementId]" };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  const elementId = args.length >= 2 ? args[1]! : undefined;
  return {
    handled: true,
    response:
      elementId === undefined
        ? `Reading comments on plan "${slug}"…`
        : `Reading comments on element ${elementId} of plan "${slug}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_get_plan_comments",
      args: elementId === undefined ? { planSlug: slug } : { planSlug: slug, elementId },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan status --------------------------------------------------------

function handlePlanStatus(args: string[]): SlashCommandResult {
  if (args.length < 2 || args[0] === "" || args[1] === "") {
    return {
      handled: true,
      response: `Usage: /plan status <slug> <status>\nAvailable: ${PLAN_STATUSES.join(", ")}`,
    };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  const status = args[1]!;
  if (!isPlanStatus(status)) {
    return {
      handled: true,
      response: `Invalid status "${status}". Available: ${PLAN_STATUSES.join(", ")}.`,
    };
  }
  return {
    handled: true,
    response: `Setting plan "${slug}" status to "${status}"…`,
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "set_status", planSlug: slug, status },
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

// --- /plan wait (deferred) -----------------------------------------------

function handlePlanWait(args: string[]): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return { handled: true, response: "Usage: /plan wait <slug> [--timeout N]" };
  }
  const slug = args[0]!;
  if (!isValidSlug(slug)) {
    return {
      handled: true,
      response: `Invalid slug "${slug}". Slug must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    };
  }
  // Per the audit: /plan wait is deferred from MVP. We acknowledge the
  // command and point the user at the real tool. The slash command
  // does NOT block — that's the hard-rule requirement.
  return {
    handled: true,
    response:
      `"/plan wait" is deferred from the v0.5.0 MVP.\n` +
      `Until the SSE-based command ships, the agent should call ` +
      `\`bizar_wait_for_feedback\` directly as a tool call. It polls every 2s ` +
      `and returns when the user adds a comment, approves/rejects the plan, ` +
      `or the timeout fires (default 10 min, max 30 min).\n` +
      `\n` +
      `For now, the LLM can call the tool itself — this is the path the ` +
      `visual-plan flow uses. A future release will wire /plan wait to an ` +
      `SSE push from the local viewer so the user does not see a polling ` +
      `loop.`,
  };
}

// --- /help ----------------------------------------------------------------

function helpResult(): SlashCommandResult {
  return {
    handled: true,
    response:
      `Available commands:\n` +
      `  /visual-plan on | off         — Toggle visual plan mode\n` +
      `  /visual-plan                  — Show current visual plan state\n` +
      `\n` +
      `  /plan new <slug> [template]   — Create a new plan\n` +
      `  /plan list                    — List all plans in the worktree\n` +
      `  /plan open <slug>             — Return the URL for a plan\n` +
      `\n` +
      `  /plan get <slug>              — Fetch the full canvas (via bizar_plan_action)\n` +
      `  /plan add <slug> --title T --type kind [--x N --y N …]\n` +
      `                                — Add an element to a plan (via bizar_plan_action)\n` +
      `  /plan update <slug> <id> [--x N --y N --title T --content C …]\n` +
      `                                — Patch an existing element (via bizar_plan_action)\n` +
      `  /plan delete <slug> <id>      — Remove an element (via bizar_plan_action)\n` +
      `  /plan comment <slug> [id] "text"\n` +
      `                                — Add a comment (via bizar_plan_action)\n` +
      `  /plan comments <slug> [id]    — Read comments (via bizar_get_plan_comments)\n` +
      `  /plan status <slug> <status>  — Set the plan's status (via bizar_plan_action)\n` +
      `  /plan wait <slug> [--timeout N]\n` +
      `                                — Wait for feedback (deferred — see /plan wait)\n` +
      `\n` +
      `  /help | /commands             — Show this help\n` +
      `\n` +
      `Available templates: ${KNOWN_TEMPLATES.join(", ")}\n` +
      `Available statuses: ${PLAN_STATUSES.join(", ")}`,
  };
}
