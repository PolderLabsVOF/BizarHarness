/**
 * commands-impl.ts
 *
 * v0.5.0 — Side-effect executor for slash commands.
 *
 * The `commands.ts` module is a pure parser: given a user message, it
 * returns a `SlashCommandResult` describing what the chat hook should
 * do. This module implements the "do" half:
 *
 *   - `executeSideEffect`      — dispatches `create_plan`,
 *     `list_plans`, `open_plan_url`, and `tool_invocation` to the
 *     right handler.
 *   - `executeToolInvocation`  — builds a synthetic `ToolContext`,
 *     pre-validates args against the tool's Zod schema, and invokes
 *     the tool's `execute()` directly.
 *   - `buildSyntheticToolContext` — constructs the `ToolContext` shape
 *     that opencode's tool framework requires (per R6).
 *   - `validateToolArgs`       — wraps the tool's `ZodRawShape` into
 *     a `z.object(...)` and runs `safeParse` (per C2).
 *
 * The split keeps the parser pure (no I/O, no tool imports, no
 * ToolContext) and concentrates the runtime dependencies in one
 * module that the chat hook imports. The parser remains testable
 * without Bun, the opencode SDK, or a real worktree.
 *
 * Error handling:
 *   - All functions return a structured `ExecuteResult` and NEVER
 *     throw. The chat hook wraps calls in a try/catch as a
 *     defense-in-depth measure, but normal failures land in
 *     `responseOverride` so the user sees them.
 */

import { z } from "zod";
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin";

import type { Logger } from "./logger.js";
import type { DefaultTemplate } from "./settings.js";
import type { SideEffect } from "./commands.js";
import {
  createPlan as fsCreatePlan,
  listPlans as fsListPlans,
  getPlanMeta as fsGetPlanMeta,
} from "./plan-fs.js";

// --- Public types --------------------------------------------------------

/**
 * Minimal context the executor needs. The full `RuntimeContext` from
 * `index.ts` has more fields, but this module only depends on a
 * subset; using a narrower interface keeps the executor decoupled
 * and makes it trivial to test (pass a plain object).
 */
export interface ExecutorContext {
  /** Project worktree root (where `plans/` lives). */
  worktree: string;
  /** Project directory (often equal to `worktree`; the viewer / TUI
   *  may use this to display paths differently from the worktree). */
  directory: string;
  logger: Logger;
}

export interface ExecuteOptions {
  /**
   * The registered `Hooks.tool` map. The executor looks up tools by
   * name when handling `tool_invocation` side-effects. In tests, the
   * caller can pass a minimal map containing only the tools under test.
   */
  tools: Record<string, ToolDefinition>;
  /**
   * The current default template (from `PlanSettings`). Used to
   * resolve `template: null` in `create_plan` side-effects.
   */
  defaultTemplate: DefaultTemplate;
  /**
   * The default port for `/plan open` URLs. The executor builds the
   * URL the same way the parser does, so the value should be the
   * same one the parser was given.
   */
  defaultPort: number;
}

/**
 * Result of executing a side effect. The chat hook uses this to
 * decide whether to override the parser's response (e.g. with a
 * tool-call result or a plan-creation error).
 */
export interface ExecuteResult {
  /**
   * If set, replaces the parser's `response` text. Used for:
   *   - plan-create failures (refusing to clobber existing slugs)
   *   - tool-call output (so the user sees the result)
   *   - arg-validation failures
   *   - any caught exception
   */
  responseOverride?: string;
  /**
   * Optional follow-up text to APPEND to the parser's response.
   * Used for `/plan list` where the parser already returns a
   * formatted list and the executor may add status info.
   */
  responseSuffix?: string;
}

// --- executeSideEffect ---------------------------------------------------

/**
 * Dispatch a `SideEffect` to the appropriate handler. The chat hook
 * calls this for every slash command that returns `sideEffect`.
 *
 * `create_plan`   — calls `plan-fs.createPlan`.
 * `list_plans`    — calls `plan-fs.listPlans` (overrides the parser's
 *                    list so we can include status + lastEdited).
 * `open_plan_url` — just returns the parser's response (the parser
 *                    already built the URL). No I/O.
 * `launch_dashboard` — spawns `bizar dashboard start` as a detached
 *                    child process. Reads the port file back and
 *                    appends the URL to the parser's response.
 * `tool_invocation` — delegates to `executeToolInvocation`.
 *
 * Never throws. All failures become `responseOverride` strings.
 */
export async function executeSideEffect(
  sideEffect: SideEffect,
  ctx: ExecutorContext,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  try {
    switch (sideEffect.kind) {
      case "create_plan":
        return await executeCreatePlan(sideEffect.slug, sideEffect.template, ctx, opts);
      case "list_plans":
        return await executeListPlans(ctx, opts);
      case "open_plan_url":
        // No I/O — the parser already built the URL. The chat hook
        // uses the parser's response unchanged.
        return {};
      case "launch_dashboard":
        return await executeLaunchDashboard(sideEffect.defaultPort, ctx);
      case "tool_invocation":
        return await executeToolInvocation(sideEffect, ctx, opts);
      default: {
        // Exhaustiveness check — TS errors here if a new kind is added.
        const _exhaustive: never = sideEffect;
        return { responseOverride: `Unknown side-effect: ${String(_exhaustive)}` };
      }
    }
  } catch (err: unknown) {
    ctx.logger.warn(
      `bizar: side-effect execution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      responseOverride: `Side-effect failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function executeCreatePlan(
  slug: string,
  template: DefaultTemplate | null,
  ctx: ExecutorContext,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const result = await fsCreatePlan(ctx.worktree, slug, {
    template: template ?? opts.defaultTemplate,
    logger: ctx.logger,
  });
  if (!result.ok) {
    return { responseOverride: `Failed to create plan: ${result.error}` };
  }
  // Success: the parser's "will be created" message is now confirmed.
  // Append a short note so the user knows it landed.
  return {
    responseSuffix: `\n✓ Created plans/${slug}/ (meta.json + plan.json).`,
  };
}

async function executeListPlans(
  ctx: ExecutorContext,
  _opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const list = await fsListPlans(ctx.worktree, ctx.logger);
  if (list.length === 0) {
    return {
      responseOverride:
        "No plans found in this worktree. Use /plan new <slug> to create one.",
    };
  }
  const lines = list.map(
    (p) => `  - ${p.slug} (status: ${p.status}, last edited: ${p.lastEdited || "—"})`,
  );
  return {
    responseOverride: `Plans in this worktree (${list.length}):\n${lines.join("\n")}`,
  };
}

/**
 * Launch the Bizar dashboard as a detached child process.
 *
 * We spawn `bizar dashboard start` with `detached: true` and `unref()`
 * so the child's lifetime is independent of the plugin host. We then
 * poll the port file (written by the child) for up to ~3s and append
 * the URL to the parser's response. If anything goes wrong we surface
 * a clear error so the user knows where to look.
 *
 * Never throws — all failures become responseSuffix/Override.
 */
async function executeLaunchDashboard(
  defaultPort: number,
  ctx: ExecutorContext,
): Promise<ExecuteResult> {
  const { spawn } = await import("node:child_process");
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  const portFile = join(homedir(), ".config", "bizar", "dashboard.port");

  // If a dashboard is already running, just report its URL.
  if (existsSync(portFile)) {
    try {
      const port = readFileSync(portFile, "utf8").trim();
      if (port && Number.isFinite(Number(port))) {
        return {
          responseSuffix:
            `\n✓ Dashboard already running at http://localhost:${port}/`,
        };
      }
    } catch {
      /* fall through to spawn */
    }
  }

  try {
    // `bizar` is on $PATH for global installs; for npx / local installs
    // we'd want to resolve to the package's bin. Spawn `bizar` directly
    // for now — the user's $PATH is the source of truth.
    const child = spawn("bizar", ["dashboard", "start"], {
      detached: true,
      stdio: "ignore",
      cwd: ctx.worktree,
    });
    child.on("error", (err) => {
      ctx.logger.warn(`bizar: dashboard spawn error: ${err.message}`);
    });
    child.unref();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      responseOverride:
        `Could not launch the Bizar dashboard: ${msg}\n` +
        `Try running \`bizar dashboard start\` in your terminal.`,
    };
  }

  // Poll the port file briefly so the response carries the live URL.
  const deadline = Date.now() + 3000;
  let resolvedPort: number | null = null;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      try {
        const port = Number(readFileSync(portFile, "utf8").trim());
        if (Number.isFinite(port) && port > 0) {
          resolvedPort = port;
          break;
        }
      } catch {
        /* ignore — keep polling */
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (resolvedPort === null) {
    return {
      responseSuffix:
        `\n✓ Dashboard launching… (preferred port ${defaultPort}, ` +
        `fallback to a free port). The browser will open shortly.`,
    };
  }

  return {
    responseSuffix: `\n✓ Dashboard running at http://localhost:${resolvedPort}/`,
  };
}

// --- executeToolInvocation -----------------------------------------------

/**
 * Invoke a registered tool from a slash-command side-effect. The
 * `tool_invocation` kind is the parser's way of saying "do whatever
 * `/plan <sub>` would do, but using the actual tool so the result
 * and the LLM see the same thing".
 *
 * Steps:
 *   1. Look up the tool by name in `opts.tools`.
 *   2. Pre-validate the args against the tool's Zod schema (C2).
 *      Validation failure → responseOverride with a clear error.
 *   3. Build a synthetic `ToolContext` (R6).
 *   4. Call `tool.execute(args, syntheticCtx)`.
 *   5. Stringify the result and return it as `responseOverride`.
 *
 * Never throws.
 */
export async function executeToolInvocation(
  sideEffect: Extract<SideEffect, { kind: "tool_invocation" }>,
  ctx: ExecutorContext,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  const { toolName, args } = sideEffect;
  const tool = opts.tools[toolName];
  if (tool === undefined) {
    const known = Object.keys(opts.tools).sort().join(", ");
    return {
      responseOverride:
        `Tool "${toolName}" is not registered in this plugin. ` +
        `Available tools: ${known || "(none)"}.`,
    };
  }

  // Pre-validate args against the tool's Zod schema (C2).
  const validation = validateToolArgs(tool, args);
  if (!validation.ok) {
    return {
      responseOverride:
        `Invalid arguments for ${toolName}: ${validation.error}`,
    };
  }

  // Build the synthetic context (R6) and invoke.
  const syntheticCtx = buildSyntheticToolContext(ctx);
  try {
    const result = await tool.execute(validation.args, syntheticCtx);
    const outputStr = stringifyToolResult(result);
    // The tool output replaces the parser's "X-ing…" placeholder with
    // a real outcome. This is the entire point of routing through the
    // tool — the user sees the actual canvas/comments/etc.
    return {
      responseOverride: outputStr,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`bizar: tool ${toolName} crashed: ${msg}`);
    return {
      responseOverride: `Tool ${toolName} failed: ${msg}`,
    };
  }
}

// --- buildSyntheticToolContext -------------------------------------------

/**
 * Build a `ToolContext` suitable for invoking a tool from a slash
 * command. The values are deliberately synthetic — a slash command
 * is not a real tool call from the agent's perspective, so we cannot
 * use the chat-message's `sessionID` / `agent` / `messageID` (per R6).
 *
 * Fields:
 *   - `sessionID`  — `"slash-command"` sentinel. Downstream code that
 *     branches on session ID (e.g. state seeding) will see this and
 *     treat the call as out-of-band.
 *   - `messageID`  — `"slash-command-<timestamp>"` so a single chat
 *     turn that triggers multiple slash commands still gets unique
 *     IDs.
 *   - `agent`      — `""` (empty string). The agent is the user; the
 *     tool should not assume a specific agent role.
 *   - `directory`  — `ctx.directory` (R6).
 *   - `worktree`   — `ctx.worktree` (R6).
 *   - `abort`      — fresh `AbortSignal`. The slash-command flow has
 *     no cancellation source of its own; the chat hook's lifetime
 *     bounds the call. If a follow-up needs cancellation, the host
 *     would need to wire it through (not in MVP scope).
 *   - `metadata()` — no-op.
 *   - `ask()`      — no-op (auto-approves). The user has already
 *     authorized by typing the slash command.
 *
 * The return value is exported for tests; production callers should
 * use `executeToolInvocation` which calls this internally.
 */
export function buildSyntheticToolContext(ctx: ExecutorContext): ToolContext {
  return {
    sessionID: "slash-command",
    messageID: `slash-command-${Date.now()}`,
    agent: "",
    directory: ctx.directory,
    worktree: ctx.worktree,
    abort: new AbortController().signal,
    metadata: () => {
      // No-op. A slash command has no "progress" UX to update.
    },
    ask: async () => {
      // No-op. The user has already authorized by typing the command;
      // an interactive "ask" prompt would block the chat hook past the
      // 60-second limit and isn't appropriate for a slash command.
    },
  };
}

// --- validateToolArgs ----------------------------------------------------

/**
 * Pre-validate `args` against a tool's Zod schema. The tool's
 * `args` field is a `ZodRawShape` (a record of Zod types, not a
 * Zod object). We wrap it in `z.object(...)` to get a parseable
 * schema, then call `safeParse`.
 *
 * Returns either:
 *   - `{ ok: true, args: T }` where `T` is the inferred type, OR
 *   - `{ ok: false, error: string }` with a human-readable error.
 *
 * The `T` is typed loosely (`Record<string, unknown>`) because the
 * tool factories use a generic constraint that we can't easily express
 * here. The downstream `tool.execute` re-validates against its own
 * schema, so a too-loose type at this layer is safe.
 */
export function validateToolArgs(
  tool: ToolDefinition,
  args: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  try {
    // The tool's `args` is a ZodRawShape; wrap in z.object to get a schema.
    const schema = z.object(tool.args as z.ZodRawShape);
    const result = schema.safeParse(args);
    if (result.success) {
      return { ok: true, args: result.data as Record<string, unknown> };
    }
    // Format the issues into a single readable line. We don't dump the
    // full Zod tree — the user just needs the first thing that went
    // wrong and the field name.
    const first = result.error.issues[0];
    const where = first?.path && first.path.length > 0 ? first.path.join(".") : "(root)";
    const what = first?.message ?? "unknown validation error";
    return { ok: false, error: `${where}: ${what}` };
  } catch (err: unknown) {
    // We should never get here — z.object(anything) always works.
    // But if we do (e.g. the tool's schema is broken), surface it.
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `internal: failed to construct schema (${msg})` };
  }
}

// --- Helpers -------------------------------------------------------------

/**
 * Stringify a tool's result. The opencode tool contract allows
 * either a plain string or a `{ title?, output, metadata?, attachments? }`
 * object. We always return the `output` field (or the string itself).
 *
 * We DO NOT pretty-print JSON — the user pasted a slash command and
 * wants to see the result. If the tool returned JSON, dump it.
 */
function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  if (typeof result === "object") {
    const obj = result as { output?: unknown; title?: unknown };
    if (typeof obj.output === "string") return obj.output;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}
