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
      kind: "launch_dashboard";
      defaultPort: number;
    }
  | {
      kind: "tool_invocation";
      toolName: string;
      args: unknown;
    };

/** Dialog component types that can be rendered in the dashboard. */
export type DialogComponent =
  | "visual-plan"
  | "plan-create"
  | "plan-list"
  | "help"
  | "audit"
  | "generic";

export interface DialogDescriptor {
  id: string;
  title: string;
  command: string;
  component: DialogComponent;
  data?: Record<string, unknown>;
}

function generateId(): string {
  return `dlg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface SlashCommandResult {
  handled: true;
  /** Text shown to the user / LLM. */
  response: string;
  /** Optional settings mutation. */
  settingsPatch?: Partial<PlanSettings>;
  /** Optional side-effect to perform (file I/O lives in the hook, not here). */
  sideEffect?: SideEffect;
  /** Optional dialog to open in the dashboard instead of showing text. */
  dialog?: DialogDescriptor;
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
 *   - `/kb`                          — open the Bizar Memory vault in Obsidian
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
    case "bizar":
      return handleBizar(rest, ctx);
    case "kb":
      return handleKb(rest, ctx);
    case "odin":
      return handleOdin(rest, ctx);
    case "loop":
      return handleLoop(rest, ctx);
    case "kanban":
      return handleKanban(rest, ctx);
    case "review":
      return handleReview(rest, ctx);
    case "handoff":
      return handleHandoff(rest, ctx);
    case "grill":
      return handleGrill(rest, ctx);
    case "glyph":
      return handleGlyph(rest, ctx);
    case "decision":
      return handleDecision(rest, ctx);
    case "issue":
      return handleIssue(rest, ctx);
    case "digest":
      return handleDigest(rest, ctx);
    case "usage":
      return handleUsage(rest, ctx);
    case "memory":
      return handleMemory(rest, ctx);
    case "spawn":
      return handleSpawn(rest, ctx);
    case "team":
      return handleTeam(rest, ctx);
    case "audit":
      return handleAudit(rest, ctx);
    case "deploy":
      return handleDeploy(rest, ctx);
    case "status":
      return handleStatus(rest, ctx);
    case "lightrag":
      return handleLightrag(rest, ctx);
    case "headroom":
      return handleHeadroom(rest, ctx);
    case "minimax":
      return handleMiniMax(rest, ctx);
    case "service":
      return handleService(rest, ctx);
    case "dash":
      return handleDash(rest, ctx);
    case "mod":
      return handleMod(rest, ctx);
    case "init":
      return handleInit(rest, ctx);
    case "dev":
      return handleDev(rest, ctx);
    case "test":
      return handleTest(rest, ctx);
    case "agent-browser":
      return handleAgentBrowser(rest, ctx);
    case "plow-through":
      return handlePlowThrough(rest, ctx);
    case "tailscale":
      return handleTailscale(rest, ctx);
    case "providers":
      return handleProviders(rest, ctx);
    case "clip":
      return handleClip(rest, ctx);
    case "ocr":
      return handleOcr(rest, ctx);
    case "workspace":
      return handleWorkspace(rest, ctx);
    case "voice":
      return handleVoice(rest, ctx);
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
  const currentEnabled = ctx.currentSettings.visualPlanEnabled;

  if (lc === "") {
    // No argument — return current state as a dialog
    return {
      handled: true,
      response: `Visual plan mode is currently ${currentEnabled ? "on" : "off"}.`,
      dialog: {
        id: generateId(),
        title: "Visual Plan",
        command: "/visual-plan",
        component: "visual-plan",
        data: {
          enabled: currentEnabled,
          previousEnabled: currentEnabled,
          defaultTemplate: ctx.currentSettings.defaultTemplate,
          lastUsedSlug: ctx.currentSettings.lastUsedSlug ?? null,
          mode: "status",
        },
      },
    };
  }

  if (lc === "on" || lc === "true" || lc === "1" || lc === "enable") {
    return {
      handled: true,
      response: `Visual plan mode is now on.`,
      settingsPatch: { visualPlanEnabled: true },
      dialog: {
        id: generateId(),
        title: "Visual Plan",
        command: "/visual-plan on",
        component: "visual-plan",
        data: {
          enabled: true,
          previousEnabled: currentEnabled,
          mode: "toggle",
        },
      },
    };
  }

  if (lc === "off" || lc === "false" || lc === "0" || lc === "disable") {
    return {
      handled: true,
      response: `Visual plan mode is now off.`,
      settingsPatch: { visualPlanEnabled: false },
      dialog: {
        id: generateId(),
        title: "Visual Plan",
        command: "/visual-plan off",
        component: "visual-plan",
        data: {
          enabled: false,
          previousEnabled: currentEnabled,
          mode: "toggle",
        },
      },
    };
  }

  if (lc === "status" || lc === "state" || lc === "?") {
    return {
      handled: true,
      response: `Visual plan mode is currently ${currentEnabled ? "on" : "off"}.`,
      dialog: {
        id: generateId(),
        title: "Visual Plan",
        command: "/visual-plan status",
        component: "visual-plan",
        data: {
          enabled: currentEnabled,
          previousEnabled: currentEnabled,
          mode: "status",
        },
      },
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
    response: "Plan commands: /plan new <slug> [template] | /plan list | /plan open <slug> | /plan get <slug> | /plan add <slug> | /plan update <slug> <id> | /plan delete <slug> <id> | /plan comment <slug> [id] \"text\" | /plan comments <slug> [id] | /plan status <slug> <status> | /plan wait <slug> [--timeout N]. Run /plan <subcommand> for details.",
    dialog: {
      id: generateId(),
      title: "Plan Commands",
      command: "/plan",
      component: "help",
      data: {
        commands: [
          { cmd: "/plan new <slug> [template]", desc: "Create a new plan" },
          { cmd: "/plan list", desc: "List all plans in the worktree" },
          { cmd: "/plan open <slug>", desc: "Open a plan in the viewer" },
          { cmd: "/plan get <slug>", desc: "Fetch the full canvas" },
          { cmd: "/plan add <slug> --title T --type kind", desc: "Add an element to a plan" },
          { cmd: "/plan update <slug> <id> [--x N --y N …]", desc: "Patch an existing element" },
          { cmd: "/plan delete <slug> <id>", desc: "Remove an element" },
          { cmd: "/plan comment <slug> [id] \"text\"", desc: "Add a comment" },
          { cmd: "/plan comments <slug> [id]", desc: "Read comments on a plan" },
          { cmd: "/plan status <slug> <status>", desc: "Set the plan's status" },
          { cmd: "/plan wait <slug> [--timeout N]", desc: "Wait for feedback (deferred)" },
        ],
        templates: KNOWN_TEMPLATES,
        statuses: PLAN_STATUSES,
      },
    },
  };
}

// --- /plan new ------------------------------------------------------------

function handlePlanNew(args: string[], ctx: ParseContext): SlashCommandResult {
  if (args.length === 0 || args[0] === "") {
    return {
      handled: true,
      response: "Usage: /plan new <slug> [template]. Available templates: " + KNOWN_TEMPLATES.join(", ") + ".",
      dialog: {
        id: generateId(),
        title: "Create New Plan",
        command: "/plan new",
        component: "plan-create",
        data: {
          templates: [...KNOWN_TEMPLATES],
          defaultTemplate: ctx.currentSettings.defaultTemplate,
          suggestedSlug: "",
        },
      },
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

  const resolvedTemplate = template ?? ctx.currentSettings.defaultTemplate;

  return {
    handled: true,
    response: `Created plan "${titleCase(slug)}" with the "${resolvedTemplate}" template. Use /plan open ${slug} to open it.`,
    sideEffect: {
      kind: "create_plan",
      slug,
      template,
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Plan Created",
      command: `/plan new ${slug}`,
      component: "generic",
      data: {
        message: `Plan "${titleCase(slug)}" created with the "${resolvedTemplate}" template.`,
        detail: `Use /plan open ${slug} to open it.`,
      },
    },
  };
}

// --- /plan list ----------------------------------------------------------

function handlePlanList(ctx: ParseContext): SlashCommandResult {
  const slugs = ctx.availablePlanSlugs ?? [];
  if (slugs.length === 0) {
    return {
      handled: true,
      response: "No plans found in the current worktree. Use /plan new <slug> to create one.",
      sideEffect: { kind: "list_plans" },
      dialog: {
        id: generateId(),
        title: "Plans",
        command: "/plan list",
        component: "plan-list",
        data: {
          plans: slugs,
          count: slugs.length,
        },
      },
    };
  }
  return {
    handled: true,
    response: `Found ${slugs.length} plan(s) (${slugs.length}): ${slugs.join(", ")}.`,
    sideEffect: { kind: "list_plans" },
    dialog: {
      id: generateId(),
      title: "Plans",
      command: "/plan list",
      component: "plan-list",
      data: {
        plans: slugs,
        count: slugs.length,
      },
    },
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
    response: `Opening plan "${slug}" at ${url}.`,
    settingsPatch: { lastUsedSlug: slug },
    sideEffect: {
      kind: "open_plan_url",
      slug,
    },
    dialog: {
      id: generateId(),
      title: "Opening Plan",
      command: `/plan open ${slug}`,
      component: "generic",
      data: {
        message: `Opening plan: ${slug}`,
        url,
      },
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
    dialog: {
      id: generateId(),
      title: "Plan Canvas",
      command: `/plan get ${slug}`,
      component: "generic",
      data: {
        message: `Fetching canvas for plan "${slug}"…`,
      },
    },
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
    response: "",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "add_element", planSlug: slug, element },
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Element Added",
      command: `/plan add ${slug}`,
      component: "generic",
      data: {
        message: `Adding element to plan "${slug}"…`,
      },
    },
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
    response: "",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "update_element", planSlug: slug, elementId, element },
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Element Updated",
      command: `/plan update ${slug}`,
      component: "generic",
      data: {
        message: `Updating element ${elementId} in plan "${slug}"…`,
      },
    },
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
    response: "",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "delete_element", planSlug: slug, elementId },
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Element Deleted",
      command: `/plan delete ${slug}`,
      component: "generic",
      data: {
        message: `Deleting element ${elementId} from plan "${slug}"…`,
      },
    },
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
    response: "",
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
    dialog: {
      id: generateId(),
      title: "Comment Added",
      command: `/plan comment ${slug}`,
      component: "generic",
      data: {
        message:
          elementId === null
            ? `Adding canvas-pinned comment to plan "${slug}"…`
            : `Adding comment to element ${elementId} on plan "${slug}"…`,
      },
    },
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
    response: "",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_get_plan_comments",
      args: elementId === undefined ? { planSlug: slug } : { planSlug: slug, elementId },
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Comments",
      command: `/plan comments ${slug}`,
      component: "generic",
      data: {
        message:
          elementId === undefined
            ? `Reading comments on plan "${slug}"…`
            : `Reading comments on element ${elementId} of plan "${slug}"…`,
      },
    },
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
    response: "",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "set_status", planSlug: slug, status },
    },
    settingsPatch: { lastUsedSlug: slug },
    dialog: {
      id: generateId(),
      title: "Status Updated",
      command: `/plan status ${slug}`,
      component: "generic",
      data: {
        message: `Setting plan "${slug}" status to "${status}"…`,
      },
    },
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

// --- /bizar --------------------------------------------------------------

/**
 * v2.5.0 — `/bizar [args]` launches the dashboard or routes a sub-request.
 *
 * Behavior:
 *   - `/bizar` (no args) — emits a `launch_dashboard` side-effect. The
 *     executor spawns `bizar dash start` as a detached child
 *     process, then the host surfaces the URL in the response.
 *   - `/bizar <args>` — passes the args to the menu command file. Today
 *     the menu routes intent (`/explain`, `/plan`, `/audit`, etc.); the
 *     response is the menu's natural-language routing advice.
 *
 * Note: the menu text lives in `config/commands/bizar.md` and is shipped
 * via the CLI package. The plugin only handles the no-arg case for the
 * side-effect; with args we return a short pointer so the user knows
 * where the routing table lives.
 */
function handleBizar(arg: string, ctx: ParseContext): SlashCommandResult {
  const trimmed = arg.trim();

  if (trimmed === "") {
    const port = ctx.defaultPort ?? 4321;
    return {
      handled: true,
      response: "",
      sideEffect: {
        kind: "launch_dashboard",
        defaultPort: port,
      },
      dialog: {
        id: generateId(),
        title: "Dashboard",
        command: "/bizar",
        component: "generic",
        data: {
          message: "Dashboard launching in the background…",
          url: `http://localhost:${port}/`,
        },
      },
    };
  }

  // With args, defer to the menu command file shipped with the CLI.
  return {
    handled: true,
    response: "",
    dialog: {
      id: generateId(),
      title: "Bizar Commands",
      command: `/bizar ${trimmed}`,
      component: "help",
      data: {
        commands: [
          { cmd: "/bizar", desc: "Launch the Bizar dashboard" },
          { cmd: "/bizar explain <question>", desc: "Read-only code Q&A" },
          { cmd: "/bizar plan <args>", desc: "Manage plans" },
          { cmd: "/bizar audit", desc: "Run security audit" },
          { cmd: "/bizar learn", desc: "Extract patterns from session" },
          { cmd: "/bizar init", desc: "Initialize .bizar/ in this project" },
          { cmd: "/bizar pr-review", desc: "PR review" },
        ],
      },
    },
  };
}

// --- /kb -----------------------------------------------------------------

/**
 * v4.0.0 — `/kb` opens the Bizar Memory vault in Obsidian.
 *
 * Behavior:
 *   - Routes through the `bizar_open_kb` tool via tool_invocation.
 *   - The tool resolves the vault path from .bizar/memory.json and
 *     spawns Obsidian (or xdg-open as fallback).
 *   - If memory isn't initialized, the tool returns a helpful message.
 *
 * No subcommands. With args, returns a help pointer.
 */
function handleKb(arg: string, _ctx: ParseContext): SlashCommandResult {
  const trimmed = arg.trim();

  if (trimmed !== "") {
    return {
      handled: true,
      response:
        `Unknown argument: \`${trimmed}\`. \`/kb\` takes no arguments.\n\n` +
        `Use \`/kb\` to open the Bizar Memory vault in Obsidian.\n` +
        `Use \`bizar memory status\` to see vault details.`,
    };
  }

  return {
    handled: true,
    response: "Opening Bizar Memory vault in Obsidian…",
    sideEffect: {
      kind: "tool_invocation",
      toolName: "bizar_open_kb",
      args: {},
    },
  };
}

// --- /help ----------------------------------------------------------------

/**
 * Helper: build a SlashCommandResult that invokes a Bizar tool.
 * Most slash commands are thin shims over an existing tool.
 */
function toolInvocation(toolName: string, args: unknown, response: string): SlashCommandResult {
  return {
    handled: true,
    response,
    sideEffect: { kind: "tool_invocation", toolName, args },
  };
}

/**
 * Helper: parse `--key=value` and `--key value` flag pairs from an arg
 * string. Returns `{ positional: string[], flags: Record<string,string> }`.
 *
 * NOTE: Named `parseSlashFlags` to avoid colliding with the existing
 * `parseFlags(tokens: string[])` helper used by the legacy `/plan *`
 * handlers.
 */
function parseSlashFlags(arg: string): { positional: string[]; flags: Record<string, string> } {
  const tokens = arg.split(/\s+/).filter((t) => t.length > 0);
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

/**
 * `/odin <task>` — Spawn a Cline agent team orchestrated by Odin.
 *
 * v6.0.0 — Decomposes the task via `odin.decomposeTask`, builds an Odin
 * system prompt with subtasks + roles, and dispatches via
 * `bizar_spawn_team`. The Odin lead coordinates teammates via Cline's
 * TeamSendMessage.
 */
function handleOdin(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional, flags } = parseSlashFlags(arg);
  const task = positional.join(" ").trim();
  if (!task) {
    return {
      handled: true,
      response:
        "Usage: /odin <task>\n\nSpawn a Cline agent team orchestrated by Odin. Odin decomposes the task and dispatches subtasks to teammates.",
    };
  }
  const maxAgents = flags["max"] ? parseInt(flags["max"], 10) : 3;

  // Lazy import to avoid a circular load at module init.
  // The odin module is small and side-effect free.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { decomposeTask, buildOdinPrompt } = require("./odin.js") as typeof import("./odin.js");
  const decomposition = decomposeTask(task, Math.max(2, Math.min(6, maxAgents)));
  const mission = buildOdinPrompt(task, decomposition);

  return toolInvocation(
    "bizar_spawn_team",
    {
      teamName: "odin-squad",
      mission,
      maxAgents: decomposition.estimatedAgents,
      // Pass the decomposition to the team so individual teammates can
      // pick up their assigned subtasks.
      metadata: {
        odinDecomposition: decomposition,
        originalTask: task,
      },
    },
    `Spawning Odin team for: ${task} (${decomposition.subtasks.length} subtasks, ${decomposition.estimatedAgents} agents)`,
  );
}

/**
 * `/loop <pattern> <task>` — Start a continuous loop.
 * Patterns: ralph | repl | cron | plan-execute
 */
function handleLoop(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional, flags } = parseSlashFlags(arg);
  const [pattern, ...rest] = positional;
  const task = rest.join(" ").trim();
  if (!pattern) {
    return {
      handled: true,
      response:
        "Usage: /loop <pattern> <task> [options]\n\nPatterns: ralph | repl | cron | plan-execute\nOptions: --interval N (cron) | --max N (default 10)",
    };
  }
  const valid = new Set(["ralph", "repl", "cron", "plan-execute"]);
  if (!valid.has(pattern)) {
    return { handled: true, response: `Unknown loop pattern: ${pattern}. Valid: ${[...valid].join(", ")}` };
  }
  if (!task) return { handled: true, response: `Usage: /loop ${pattern} <task>` };
  return toolInvocation(
    "bizar_loop_start",
    {
      pattern,
      task,
      interval: flags["interval"] ? parseInt(flags["interval"], 10) : undefined,
      maxIterations: flags["max"] ? parseInt(flags["max"], 10) : 10,
    },
    `Starting ${pattern} loop: ${task}`,
  );
}

/**
 * `/kanban [list|add|move]` — Kanban board operations.
 */
function handleKanban(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional, flags } = parseSlashFlags(arg);
  const sub = positional[0] || "list";
  const args = positional.slice(1);
  if (sub === "list") return toolInvocation("bizar_kanban_list", {}, "Listing kanban board…");
  if (sub === "add") {
    return toolInvocation(
      "bizar_kanban_add",
      { title: args.join(" "), column: flags["column"] || "todo" },
      `Adding kanban card: ${args.join(" ")}`,
    );
  }
  if (sub === "move") {
    return toolInvocation(
      "bizar_kanban_move",
      { cardId: args[0], column: args[1] },
      `Moving card ${args[0]} → ${args[1]}`,
    );
  }
  return { handled: true, response: `Unknown /kanban subcommand: ${sub}. Try list|add|move.` };
}

/**
 * `/review [scope]` — Run a code review.
 */
function handleReview(arg: string, _ctx: ParseContext): SlashCommandResult {
  const scope = arg.trim() || ".";
  return toolInvocation("bizar_review", { scope }, `Running review on ${scope}…`);
}

/**
 * `/handoff <text>` — Compact current session into a handoff document.
 */
function handleHandoff(arg: string, _ctx: ParseContext): SlashCommandResult {
  const text = arg.trim();
  if (!text) return { handled: true, response: "Usage: /handoff <summary text>" };
  return toolInvocation("bizar_handoff_write", { text }, "Writing handoff document…");
}

/**
 * `/grill <topic>` — Run a relentless interview on a topic.
 */
function handleGrill(arg: string, _ctx: ParseContext): SlashCommandResult {
  const topic = arg.trim();
  if (!topic) return { handled: true, response: "Usage: /grill <topic to be grilled on>" };
  return toolInvocation("bizar_grill", { topic, mode: "grill" }, `Grilling on: ${topic}`);
}

/**
 * `/glyph <type> <slug>` — Create a visual glyph.
 */
function handleGlyph(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const [type, ...rest] = positional;
  const slug = rest.join(" ").trim();
  if (!type || !slug) {
    return {
      handled: true,
      response: "Usage: /glyph <type> <slug>\n\nTypes: plan, recap, design, postmortem, handoff",
    };
  }
  return toolInvocation("bizar_glyph_create", { type, slug }, `Creating glyph: ${slug}`);
}

/**
 * `/decision <title>` — Document an architectural decision (ADR).
 */
function handleDecision(arg: string, _ctx: ParseContext): SlashCommandResult {
  const title = arg.trim();
  if (!title) return { handled: true, response: "Usage: /decision <ADR title>" };
  return toolInvocation("bizar_decision_write", { title }, `Documenting decision: ${title}`);
}

/**
 * `/issue <title>` — File an issue.
 */
function handleIssue(arg: string, _ctx: ParseContext): SlashCommandResult {
  const title = arg.trim();
  if (!title) return { handled: true, response: "Usage: /issue <issue title>" };
  return toolInvocation("bizar_issue_create", { title }, `Filing issue: ${title}`);
}

/**
 * `/digest [period]` — Show or generate a digest.
 */
function handleDigest(arg: string, _ctx: ParseContext): SlashCommandResult {
  const period = arg.trim() || "weekly";
  return toolInvocation("bizar_digest", { period, action: "show" }, `Showing ${period} digest…`);
}

/**
 * `/usage [period]` — Show usage analytics.
 */
function handleUsage(arg: string, _ctx: ParseContext): SlashCommandResult {
  const period = arg.trim() || "24h";
  return toolInvocation("bizar_usage", { period }, `Showing ${period} usage…`);
}

/**
 * `/memory <subcommand>` — Memory vault operations.
 */
function handleMemory(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  const rest = positional.slice(1);
  switch (sub) {
    case "status": return toolInvocation("bizar_memory_status", {}, "Memory status…");
    case "search": return toolInvocation(
      "bizar_memory_search", { query: rest.join(" "), mode: "semantic" },
      `Searching memory: ${rest.join(" ")}`,
    );
    case "read": return toolInvocation(
      "bizar_memory_read", { path: rest.join(" ") },
      `Reading memory note ${rest.join(" ")}`,
    );
    case "write": return toolInvocation(
      "bizar_memory_write", { path: rest.join(" ") },
      `Writing memory note ${rest.join(" ")}`,
    );
    case "list": return toolInvocation("bizar_memory_list", {}, "Listing memory notes…");
    case "link": return toolInvocation(
      "bizar_memory_link", { url: rest[0] },
      `Linking memory vault to ${rest[0]}`,
    );
  }
  return {
    handled: true,
    response: `Unknown /memory subcommand: ${sub}. Try: status|search|read|write|list|link`,
  };
}

/**
 * `/spawn <agent> <prompt>` — Spawn a background agent.
 */
function handleSpawn(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional, flags } = parseSlashFlags(arg);
  const agent = positional[0];
  const prompt = positional.slice(1).join(" ");
  if (!agent || !prompt) {
    return {
      handled: true,
      response: "Usage: /spawn <agent> <prompt>\n\nAgents: odin, heimdall, thor, tyr, vidarr, forseti, frigg, mimir, hermod",
    };
  }
  return toolInvocation(
    "bizar_spawn_background",
    {
      agent,
      prompt,
      timeoutMs: flags["timeout"] ? parseInt(flags["timeout"], 10) : 300000,
    },
    `Spawning ${agent}: ${prompt.slice(0, 80)}…`,
  );
}

/**
 * `/team [status|stop|list]` — Team operations.
 */
function handleTeam(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  switch (sub) {
    case "status":
      return toolInvocation("bizar_team_status", { sessionId: positional[1] }, "Team status…");
    case "stop":
      return toolInvocation(
        "bizar_team_stop", { sessionId: positional[1] },
        `Stopping team ${positional[1] || "(active)"}`,
      );
    case "list":
      return toolInvocation("bizar_team_list", {}, "Listing teams…");
  }
  return { handled: true, response: `Unknown /team subcommand: ${sub}. Try: status|stop|list` };
}

/**
 * `/audit` — Run security audit.
 */
function handleAudit(_arg: string, _ctx: ParseContext): SlashCommandResult {
  return toolInvocation("bizar_audit", {}, "Running security audit…");
}

/**
 * `/deploy <target>` — One-click deploy.
 */
function handleDeploy(arg: string, _ctx: ParseContext): SlashCommandResult {
  const target = arg.trim() || "vercel";
  return toolInvocation("bizar_deploy", { target }, `Deploying to ${target}…`);
}

/**
 * `/status` — Show current session status.
 */
function handleStatus(_arg: string, _ctx: ParseContext): SlashCommandResult {
  return toolInvocation("bizar_status", {}, "Session status…");
}

/**
 * `/lightrag <subcommand>` — LightRAG server management.
 */
function handleLightrag(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_lightrag", { subcommand: sub, args: positional.slice(1) },
    `LightRAG ${sub}…`,
  );
}

/**
 * `/headroom <subcommand>` — Headroom context compression.
 */
function handleHeadroom(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_headroom", { subcommand: sub, args: positional.slice(1) },
    `Headroom ${sub}…`,
  );
}

/**
 * `/minimax <subcommand>` — MiniMax Token Plan integration.
 */
function handleMiniMax(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_minimax", { subcommand: sub, args: positional.slice(1) },
    `MiniMax ${sub}…`,
  );
}

/**
 * `/service <subcommand>` — Background service management.
 */
function handleService(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_service", { subcommand: sub, args: positional.slice(1) },
    `Service ${sub}…`,
  );
}

/**
 * `/dash <subcommand>` — Dashboard control.
 */
function handleDash(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_dash", { subcommand: sub, args: positional.slice(1) },
    `Dashboard ${sub}…`,
  );
}

/**
 * `/mod <subcommand>` — Mod management.
 */
function handleMod(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "list";
  return toolInvocation(
    "bizar_mod", { subcommand: sub, args: positional.slice(1) },
    `Mod ${sub}…`,
  );
}

/**
 * `/init` — Initialize Bizar in the current project.
 */
function handleInit(_arg: string, _ctx: ParseContext): SlashCommandResult {
  return toolInvocation(
    "bizar_init", { projectRoot: process.cwd() },
    "Initializing Bizar in project…",
  );
}

/**
 * `/dev <subcommand>` — Developer commands.
 */
function handleDev(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_dev", { subcommand: sub, args: positional.slice(1) },
    `Dev ${sub}…`,
  );
}

/**
 * `/test` — Run the project's test suite.
 */
function handleTest(_arg: string, _ctx: ParseContext): SlashCommandResult {
  return toolInvocation("bizar_test_gate", {}, "Running tests…");
}

/**
 * `/agent-browser <subcommand>` — Browser automation.
 */
function handleAgentBrowser(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_agent_browser", { subcommand: sub, args: positional.slice(1) },
    `Agent-browser ${sub}…`,
  );
}

/**
 * `/plow-through <task>` — Run the plow-through sprint workflow.
 */
function handlePlowThrough(arg: string, _ctx: ParseContext): SlashCommandResult {
  const task = arg.trim();
  if (!task) return { handled: true, response: "Usage: /plow-through <task>" };
  return toolInvocation("bizar_plow_through", { task }, `Plowing through: ${task}`);
}

/**
 * `/tailscale <subcommand>` — Tailscale integration.
 */
function handleTailscale(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_tailscale", { subcommand: sub, args: positional.slice(1) },
    `Tailscale ${sub}…`,
  );
}

/**
 * `/providers <subcommand>` — Provider detection.
 */
function handleProviders(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "detect";
  return toolInvocation(
    "bizar_providers", { subcommand: sub, args: positional.slice(1) },
    `Providers ${sub}…`,
  );
}

/**
 * `/clip <subcommand>` — Web clipper.
 */
function handleClip(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "list";
  return toolInvocation(
    "bizar_clip", { subcommand: sub, args: positional.slice(1) },
    `Clip ${sub}…`,
  );
}

/**
 * `/ocr <subcommand>` — OCR operations.
 */
function handleOcr(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "list";
  return toolInvocation(
    "bizar_ocr", { subcommand: sub, args: positional.slice(1) },
    `OCR ${sub}…`,
  );
}

/**
 * `/workspace <subcommand>` — Workspace management.
 */
function handleWorkspace(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_workspace", { subcommand: sub, args: positional.slice(1) },
    `Workspace ${sub}…`,
  );
}

/**
 * `/voice <subcommand>` — Voice notes.
 */
function handleVoice(arg: string, _ctx: ParseContext): SlashCommandResult {
  const { positional } = parseSlashFlags(arg);
  const sub = positional[0] || "status";
  return toolInvocation(
    "bizar_voice", { subcommand: sub, args: positional.slice(1) },
    `Voice ${sub}…`,
  );
}

function helpResult(): SlashCommandResult {
  return {
    handled: true,
    response:
      "Available commands — Bizar commands: /odin <task>, /loop <pattern> <task>, /kanban [list|add|move], " +
      "/review [scope], /handoff <text>, /grill <topic>, /glyph <type> <slug>, " +
      "/decision <title>, /issue <title>, /digest [period], /usage [period], " +
      "/memory <sub>, /spawn <agent> <prompt>, /team <sub>, /audit, /deploy [target], " +
      "/status, /lightrag <sub>, /headroom <sub>, /minimax <sub>, /service <sub>, " +
      "/dash <sub>, /mod <sub>, /init, /dev <sub>, /test, /agent-browser <sub>, " +
      "/plow-through <task>, /tailscale <sub>, /providers <sub>, /clip <sub>, " +
      "/ocr <sub>, /workspace <sub>, /voice <sub>, " +
      "/visual-plan [on|off|status], /plan new <slug> [template], /plan list, /plan open <slug>, " +
      "/plan get <slug>, /plan add <slug>, /plan update <slug> <id>, /plan delete <slug> <id>, " +
      "/plan comment <slug> [id] \"text\", /plan comments <slug> [id], /plan status <slug> <status>, " +
      "/plan wait <slug> [--timeout N], /bizar <args>, /kb, /help.",
    dialog: {
      id: generateId(),
      title: "Bizar Commands",
      command: "/help",
      component: "help",
      data: {
        commands: [
          { cmd: "/odin <task>", desc: "Spawn a Cline agent team orchestrated by Odin" },
          { cmd: "/loop <pattern> <task>", desc: "Start a loop (ralph/repl/cron/plan-execute)" },
          { cmd: "/kanban [list|add|move]", desc: "Kanban board operations" },
          { cmd: "/review [scope]", desc: "Run a code review" },
          { cmd: "/handoff <text>", desc: "Compact current session into a handoff document" },
          { cmd: "/grill <topic>", desc: "Run a relentless interview" },
          { cmd: "/glyph <type> <slug>", desc: "Create a visual glyph (plan/recap/design)" },
          { cmd: "/decision <title>", desc: "Document an architectural decision (ADR)" },
          { cmd: "/issue <title>", desc: "File an issue" },
          { cmd: "/digest [period]", desc: "Show or generate a digest" },
          { cmd: "/usage [period]", desc: "Show usage analytics" },
          { cmd: "/memory <subcommand>", desc: "Memory vault operations (status/search/read/write/list/link)" },
          { cmd: "/spawn <agent> <prompt>", desc: "Spawn a background agent" },
          { cmd: "/team [status|stop|list]", desc: "Team operations" },
          { cmd: "/audit", desc: "Run security audit" },
          { cmd: "/deploy <target>", desc: "One-click deploy (vercel/cloudflare/fly/docker)" },
          { cmd: "/status", desc: "Show current session status" },
          { cmd: "/lightrag <subcommand>", desc: "LightRAG server management" },
          { cmd: "/headroom <subcommand>", desc: "Headroom context compression" },
          { cmd: "/minimax <subcommand>", desc: "MiniMax Token Plan integration" },
          { cmd: "/service <subcommand>", desc: "Background service management" },
          { cmd: "/dash <subcommand>", desc: "Dashboard control" },
          { cmd: "/mod <subcommand>", desc: "Mod management" },
          { cmd: "/init", desc: "Initialize Bizar in current project" },
          { cmd: "/dev <subcommand>", desc: "Developer commands (link/unlink/build)" },
          { cmd: "/test", desc: "Run the project's test suite" },
          { cmd: "/agent-browser <subcommand>", desc: "Browser automation" },
          { cmd: "/plow-through <task>", desc: "Run the plow-through sprint workflow" },
          { cmd: "/tailscale <subcommand>", desc: "Tailscale integration" },
          { cmd: "/providers <subcommand>", desc: "Provider detection" },
          { cmd: "/clip <subcommand>", desc: "Web clipper" },
          { cmd: "/ocr <subcommand>", desc: "OCR operations" },
          { cmd: "/workspace <subcommand>", desc: "Workspace management" },
          { cmd: "/voice <subcommand>", desc: "Voice notes" },
          { cmd: "/visual-plan [on|off|status]", desc: "Toggle or view visual plan mode" },
          { cmd: "/plan new <slug> [template]", desc: "Create a new plan" },
          { cmd: "/plan list", desc: "List all plans in the worktree" },
          { cmd: "/plan open <slug>", desc: "Open a plan in the viewer" },
          { cmd: "/plan get <slug>", desc: "Fetch the full canvas" },
          { cmd: "/plan add <slug> --title T --type kind", desc: "Add an element to a plan" },
          { cmd: "/plan update <slug> <id> [flags]", desc: "Patch an existing element" },
          { cmd: "/plan delete <slug> <id>", desc: "Remove an element" },
          { cmd: "/plan comment <slug> [id] \"text\"", desc: "Add a comment" },
          { cmd: "/plan comments <slug> [id]", desc: "Read comments on a plan" },
          { cmd: "/plan status <slug> <status>", desc: "Set the plan's status" },
          { cmd: "/plan wait <slug> [--timeout N]", desc: "Wait for feedback (deferred)" },
          { cmd: "/bizar", desc: "Launch the Bizar dashboard" },
          { cmd: "/bizar <args>", desc: "Route a request via the menu" },
          { cmd: "/kb", desc: "Open the Bizar Memory vault in Obsidian" },
          { cmd: "/help | /commands", desc: "Show this help" },
        ],
        templates: [...KNOWN_TEMPLATES],
        statuses: [...PLAN_STATUSES],
      },
    },
  };
}
