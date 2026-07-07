/**
 * commands-impl.ts
 *
 * v0.5.0 — Side-effect executor for slash commands.
 *
 * Phase 2 (Cline SDK port) — replaces OpenCode's ToolContext and
 * ToolDefinition with Cline's AgentToolContext and AgentTool.
 *
 * The `commands.ts` module is a pure parser: given a user message, it
 * returns a `SlashCommandResult` describing what the chat hook should
 * do. This module implements the "do" half:
 *
 *   - `executeSideEffect`      — dispatches `create_plan`,
 *     `list_plans`, `open_plan_url`, and `tool_invocation` to the
 *     right handler.
 *   - `executeToolInvocation`  — builds a synthetic `AgentToolContext`,
 *     pre-validates args against the tool's Zod schema, and invokes
 *     the tool's `execute()` directly.
 *   - `buildSyntheticToolContext` — constructs the `AgentToolContext`
 *     shape Cline's tool framework requires.
 *   - `validateToolArgs`       — wraps the tool's inputSchema into
 *     a `z.object(...)` and runs `safeParse`.
 */

import { z } from "zod";
import type { AgentTool, AgentToolContext } from "@cline/sdk";

import type { Logger } from "./logger.js";
import type { DefaultTemplate } from "./settings.js";
import type { SideEffect } from "./commands.js";
import { createPlan as fsCreatePlan, listPlans as fsListPlans } from "./plan-fs.js";

export interface ExecutorContext {
  worktree: string;
  directory: string;
  logger: Logger;
}

export interface ExecuteOptions {
  tools: Record<string, AgentTool>;
  defaultTemplate: DefaultTemplate;
  defaultPort: number;
}

export interface ExecuteResult {
  responseOverride?: string;
  responseSuffix?: string;
}

export async function executeSideEffect(sideEffect: SideEffect, ctx: ExecutorContext, opts: ExecuteOptions): Promise<ExecuteResult> {
  try {
    switch (sideEffect.kind) {
      case "create_plan": return await executeCreatePlan(sideEffect, ctx, opts);
      case "list_plans": return await executeListPlans(sideEffect, ctx, opts);
      case "open_plan_url": return await executeOpenPlanUrl(sideEffect, ctx, opts);
      case "launch_dashboard": return await executeLaunchDashboard(sideEffect, ctx, opts);
      case "tool_invocation": return await executeToolInvocation(sideEffect, ctx, opts);
      default: {
        const _exhaustive: never = sideEffect;
        return { responseOverride: `Unknown side-effect: ${String(_exhaustive)}` };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`bizar: executeSideEffect crashed: ${msg}`);
    return { responseOverride: `Command failed: ${msg}` };
  }
}

async function executeCreatePlan(sideEffect: Extract<SideEffect, { kind: "create_plan" }>, ctx: ExecutorContext, opts: ExecuteOptions): Promise<ExecuteResult> {
  const template = sideEffect.template ?? opts.defaultTemplate;
  try {
    const result = await fsCreatePlan(ctx.worktree, sideEffect.slug, { template, logger: ctx.logger });
    if (!result.ok) return { responseOverride: `Failed to create plan: ${result.error}` };
    return { responseOverride: `Created plan "${sideEffect.slug}" using the "${template}" template.` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { responseOverride: `Failed to create plan: ${msg}` };
  }
}

async function executeListPlans(_sideEffect: Extract<SideEffect, { kind: "list_plans" }>, ctx: ExecutorContext, _opts: ExecuteOptions): Promise<ExecuteResult> {
  try {
    const plans = await fsListPlans(ctx.worktree, ctx.logger);
    if (plans.length === 0) return { responseOverride: "No plans found. Use /plan create <slug> to start one." };
    const lines = plans.map((p) => `- ${p.slug} [${p.status ?? "draft"}] — ${p.slug}`);
    return { responseOverride: `Plans (${plans.length}):\n${lines.join("\n")}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { responseOverride: `Failed to list plans: ${msg}` };
  }
}

async function executeLaunchDashboard(sideEffect: Extract<SideEffect, { kind: "launch_dashboard" }>, _ctx: ExecutorContext, _opts: ExecuteOptions): Promise<ExecuteResult> {
  return { responseOverride: `Launch dashboard at http://127.0.0.1:${sideEffect.defaultPort}/` };
}

async function executeOpenPlanUrl(sideEffect: Extract<SideEffect, { kind: "open_plan_url" }>, _ctx: ExecutorContext, opts: ExecuteOptions): Promise<ExecuteResult> {
  return { responseOverride: `Open plan: http://127.0.0.1:${opts.defaultPort}/plans/${sideEffect.slug}` };
}

export async function executeToolInvocation(sideEffect: Extract<SideEffect, { kind: "tool_invocation" }>, ctx: ExecutorContext, opts: ExecuteOptions): Promise<ExecuteResult> {
  const { toolName, args } = sideEffect;
  const tool = opts.tools[toolName];
  if (tool === undefined) {
    const known = Object.keys(opts.tools).sort().join(", ");
    return { responseOverride: `Tool "${toolName}" is not registered in this plugin. Available tools: ${known || "(none)"}.` };
  }
  const validation = validateToolArgs(tool, args);
  if (!validation.ok) return { responseOverride: `Invalid arguments for ${toolName}: ${validation.error}` };
  const syntheticCtx = buildSyntheticToolContext(ctx);
  try {
    const result = await tool.execute(validation.args, syntheticCtx);
    return { responseOverride: stringifyToolResult(result) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`bizar: tool ${toolName} crashed: ${msg}`);
    return { responseOverride: `Tool ${toolName} failed: ${msg}` };
  }
}

export function buildSyntheticToolContext(ctx: ExecutorContext): AgentToolContext {
  return { agentId: "slash-command", sessionId: "slash-command", runId: `slash-command-${Date.now()}`, iteration: 0, signal: new AbortController().signal, metadata: { worktree: ctx.worktree, directory: ctx.directory, parentAgent: "" } } as unknown as AgentToolContext;
}

export function validateToolArgs(tool: AgentTool, args: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const rawShape = (tool.inputSchema ?? {}) as z.ZodRawShape;
    const schema = z.object(rawShape);
    const result = schema.safeParse(args);
    if (result.success) return { ok: true, args: result.data as Record<string, unknown> };
    const first = result.error.issues[0];
    const where = first?.path && first.path.length > 0 ? first.path.join(".") : "(root)";
    return { ok: false, error: `${where}: ${first?.message ?? "validation failed"}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `schema error: ${msg}` };
  }
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  const r = result as { output?: unknown };
  if (r && typeof r === "object" && "output" in r) {
    if (typeof r.output === "string") return r.output;
    try { return JSON.stringify(r.output, null, 2); } catch { return String(r.output); }
  }
  if (typeof result === "object") { try { return JSON.stringify(result, null, 2); } catch { return String(result); } }
  return String(result);
}
