/**
 * commands.ts
 *
 * v0.4.0 — Pure slash-command parser.
 *
 * The plugin's `chat.message` hook calls `parseSlashCommand(text, ctx)`
 * on every user message. If the message starts with `/`, this function
 * classifies it as a known command or returns `null` (so the message
 * passes through to the LLM normally).
 *
 * Design constraints (per spec):
 *   - Pure function. No I/O, no environment reads, no Date.now() calls
 *     inside the parser itself.
 *   - The function is the **only** place slash commands are parsed.
 *     The hook then dispatches any side-effects (settings update,
 *     file I/O) based on the returned descriptor.
 *   - Returns `null` for non-slash messages so the LLM still sees them.
 *
 * Output shape:
 *   `{ handled: true, response, settingsPatch?, sideEffect? }`
 *
 *   - `response`: the text the host surfaces to the user. Also fed to the
 *     LLM so it knows the command was processed.
 *   - `settingsPatch`: optional partial `PlanSettings` to apply.
 *   - `sideEffect`: optional descriptor for the hook to execute (e.g.
 *     "create plan dir + minimal canvas"). The parser itself never
 *     performs I/O — it only describes what should happen.
 *
 * The parser is unit-tested directly (tests/commands.test.ts).
 */

import type { DefaultTemplate, PlanSettings } from "./settings.js";
import { KNOWN_TEMPLATES } from "./settings.js";

// --- Public types --------------------------------------------------------

/** What the parser asks the chat.message hook to do on the host side. */
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
   * on 127.0.0.1:4321-4330. v0.4.0 defers actually starting the server; the
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

// --- The main parser -----------------------------------------------------

/**
 * Parse a user message and decide whether it's a slash command.
 *
 * Returns:
 *   - `null`                          — not a slash command; pass through.
 *   - `SlashCommandResult`            — slash command was recognized.
 *
 * Behavior summary:
 *   - Empty / whitespace-only         → `null`
 *   - `"regular text"`                → `null`
 *   - `"/"` alone                     → `null`
 *   - `"/unknown"`                    → error response (handled, not null)
 *   - `"/visual-plan on|off"`         → settingsPatch only
 *   - `"/visual-plan"`                → returns current state (no mutation)
 *   - `"/plan new <slug> [template]"` → sideEffect=create_plan
 *   - `"/plan list"`                  → sideEffect=list_plans (info-only here)
 *   - `"/plan open <slug>"`           → sideEffect=open_plan_url
 *   - `"/help"` / `"/commands"`       → help text
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
    return {
      handled: true,
      response:
        `Plan commands:\n` +
        `  /plan new <slug> [template]   — Create a new plan\n` +
        `  /plan list                     — List all plans in the worktree\n` +
        `  /plan open <slug>              — Return the URL for a plan\n` +
        `\nAvailable templates: ${KNOWN_TEMPLATES.join(", ")}`,
    };
  }

  // Split subcommand from its args
  const tokens = arg.split(/\s+/);
  const sub = tokens[0]!.toLowerCase();
  const subArgs = tokens.slice(1);

  switch (sub) {
    case "new":
      return handlePlanNew(subArgs, ctx);
    case "list":
    case "ls":
      return handlePlanList(ctx);
    case "open":
      return handlePlanOpen(subArgs, ctx);
    default:
      return {
        handled: true,
        response: `Unknown /plan subcommand: "${sub}". Try /plan for usage.`,
      };
  }
}

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

  const templateName = template ?? ctx.currentSettings.defaultTemplate;

  return {
    handled: true,
    response:
      `Plan "${titleCase(slug)}" (slug: ${slug}) will be created with the ` +
      `"${templateName}" template.\n` +
      `After creation, use /plan open ${slug} to get the URL.`,
    sideEffect: {
      kind: "create_plan",
      slug,
      template,
    },
    settingsPatch: { lastUsedSlug: slug },
  };
}

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
      `(v0.4.0 MVP — server startup is a future enhancement; the URL is ` +
      `informational. Use "bizarharness plan open ${slug}" in the terminal to ` +
      `start the local viewer.)`,
    settingsPatch: { lastUsedSlug: slug },
    sideEffect: {
      kind: "open_plan_url",
      slug,
    },
  };
}

function helpResult(): SlashCommandResult {
  return {
    handled: true,
    response:
      `Available commands:\n` +
      `  /visual-plan on | off         — Toggle visual plan mode\n` +
      `  /visual-plan                  — Show current visual plan state\n` +
      `  /plan new <slug> [template]   — Create a new plan\n` +
      `  /plan list                    — List all plans in the worktree\n` +
      `  /plan open <slug>             — Return the URL for a plan\n` +
      `  /help | /commands             — Show this help\n` +
      `\nAvailable templates: ${KNOWN_TEMPLATES.join(", ")}`,
  };
}