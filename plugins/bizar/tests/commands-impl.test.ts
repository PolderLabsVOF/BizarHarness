/**
 * commands-impl.test.ts
 *
 * Unit tests for src/commands-impl.ts (the slash-command side-effect
 * executor). Phase 2 — Cline SDK port: uses Cline's `createTool` API
 * and the new `AgentToolContext` shape (no `metadata()` method, no
 * `ask()` method).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";

import {
  executeSideEffect,
  buildSyntheticToolContext,
  validateToolArgs,
  type ExecuteOptions,
  type ExecutorContext,
} from "../src/commands-impl";
import type { SideEffect } from "../src/commands";
import { createPlanActionTool } from "../src/tools/plan-action";
import { createBgGetCommentsTool } from "../src/tools/bg-get-comments";
import { createWaitForFeedbackTool } from "../src/tools/wait-for-feedback";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  debug(m: string) { this.messages.push({ level: "debug", message: m }); }
  info(m: string) { this.messages.push({ level: "info", message: m }); }
  warn(m: string) { this.messages.push({ level: "warn", message: m }); }
  error(m: string) { this.messages.push({ level: "error", message: m }); }
  log(_o: { level: string; message: string }) {}
}

let worktree: string;
const logger = new MockLogger();

beforeAll(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-commands-impl-test-"));
});

afterAll(() => {
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

function ctx(): ExecutorContext {
  return { worktree, directory: worktree, logger };
}

function optsWith(tools: Record<string, AgentTool>): ExecuteOptions {
  return { tools, defaultTemplate: "blank", defaultPort: 4321 };
}

const planTools = (): Record<string, AgentTool> => ({
  bizar_plan_action: createPlanActionTool({ worktree, logger }) as unknown as AgentTool,
  bizar_get_plan_comments: createBgGetCommentsTool({ worktree, logger }) as unknown as AgentTool,
  bizar_wait_for_feedback: createWaitForFeedbackTool({ worktree, logger }) as unknown as AgentTool,
});

// ---------------------------------------------------------------------------
// Group 1 — buildSyntheticToolContext
// ---------------------------------------------------------------------------

describe("buildSyntheticToolContext", () => {
  test("populates all required fields (R6)", () => {
    const tctx = buildSyntheticToolContext(ctx()) as unknown as Record<string, unknown>;
    expect(tctx.sessionId).toBe("slash-command");
    expect(typeof tctx.runId).toBe("string");
    expect(String(tctx.runId)).toMatch(/^slash-command-\d+$/);
    expect(tctx.agentId).toBe("slash-command");
    expect(tctx.iteration).toBe(0);
    const meta = tctx.metadata as { worktree: string; directory: string };
    expect(meta.worktree).toBe(worktree);
    expect(meta.directory).toBe(worktree);
  });

  test("each call gets a fresh AbortSignal (not shared)", () => {
    const a = buildSyntheticToolContext(ctx()) as unknown as { signal: AbortSignal };
    const b = buildSyntheticToolContext(ctx()) as unknown as { signal: AbortSignal };
    expect(a.signal).not.toBe(b.signal);
    expect(a.signal).toBeInstanceOf(AbortSignal);
    expect(a.signal.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — validateToolArgs
// ---------------------------------------------------------------------------

describe("validateToolArgs", () => {
  const echoSchema = z.object({ message: z.string() });
  const echoTool: AgentTool = createTool({
    name: "echo",
    description: "echo",
    inputSchema: echoSchema.shape,
    execute: async (input) => ({ echoed: input }),
  });

  test("ok on well-formed args", () => {
    const r = validateToolArgs(echoTool, { message: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.message).toBe("hi");
  });

  test("error on malformed args (returns path + message)", () => {
    const r = validateToolArgs(echoTool, { message: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/message/);
  });

  test("error on missing required arg", () => {
    const r = validateToolArgs(echoTool, {});
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 3 — executeSideEffect — create_plan
// ---------------------------------------------------------------------------

describe("executeSideEffect — create_plan", () => {
  test("happy path: writes plans/<slug>/meta.json and plan.json", async () => {
    const slug = "create-happy";
    const sideEffect: SideEffect = { kind: "create_plan", slug, template: null };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));

    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toContain(slug);

    const dir = join(worktree, "plans", slug);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "meta.json"))).toBe(true);
    expect(existsSync(join(dir, "plan.json"))).toBe(true);

    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8"));
    expect(meta.status).toBe("draft");
    expect(typeof meta.lastEdited).toBe("string");

    const canvas = JSON.parse(readFileSync(join(dir, "plan.json"), "utf-8"));
    expect(canvas.schemaVersion).toBe(2);
    expect(canvas.elements).toEqual([]);
  });

  test("refuses to clobber an existing plan (returns responseOverride)", async () => {
    const slug = "create-existing";
    const sideEffect: SideEffect = { kind: "create_plan", slug, template: null };
    const r1 = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(r1.responseOverride).toBeDefined();

    const r2 = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(r2.responseOverride).toBeDefined();
    expect(r2.responseOverride).toMatch(/already exists|Failed to create/);
    expect(r2.responseOverride).toContain(slug);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — executeSideEffect — list_plans
// ---------------------------------------------------------------------------

describe("executeSideEffect — list_plans", () => {
  test("returns rich list with status + draft", async () => {
    await executeSideEffect({ kind: "create_plan", slug: "list-a", template: null }, ctx(), optsWith(planTools()));
    await executeSideEffect({ kind: "create_plan", slug: "list-b", template: null }, ctx(), optsWith(planTools()));

    const res = await executeSideEffect({ kind: "list_plans" }, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/list-a/);
    expect(res.responseOverride).toMatch(/list-b/);
    expect(res.responseOverride).toMatch(/draft/);
  });

  test("returns 'No plans found' when worktree has no plans", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "bizar-empty-"));
    const c: ExecutorContext = { worktree: tmp, directory: tmp, logger };
    try {
      const res = await executeSideEffect({ kind: "list_plans" }, c, optsWith(planTools()));
      expect(res.responseOverride).toMatch(/No plans found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5 — executeSideEffect — open_plan_url
// ---------------------------------------------------------------------------

describe("executeSideEffect — open_plan_url", () => {
  test("returns the open URL", async () => {
    const res = await executeSideEffect({ kind: "open_plan_url", slug: "any-slug" }, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toContain("any-slug");
    expect(res.responseOverride).toMatch(/^Open plan:/);
  });
});

// ---------------------------------------------------------------------------
// Group 6 — executeToolInvocation — happy path
// ---------------------------------------------------------------------------

describe("executeToolInvocation — happy path", () => {
  test("invokes bizar_plan_action (get_canvas) with synthetic context", async () => {
    const slug = "inv-get-canvas";
    await executeSideEffect({ kind: "create_plan", slug, template: null }, ctx(), optsWith(planTools()));

    const realPlanTool = planTools().bizar_plan_action!;
    let capturedCtx: AgentToolContext | null = null;
    let capturedArgs: unknown = null;
    const spy: AgentTool = createTool({
      name: realPlanTool!.name,
      description: realPlanTool!.description,
      inputSchema: (realPlanTool! as unknown as { inputSchema: Record<string, unknown> }).inputSchema,
      execute: async (a, c) => {
        capturedCtx = c;
        capturedArgs = a;
        return (realPlanTool!.execute as (a: unknown, c: unknown) => Promise<unknown>)(a, c);
      },
    });

    const tools: Record<string, AgentTool> = {
      bizar_plan_action: spy,
      bizar_get_plan_comments: planTools().bizar_get_plan_comments!,
      bizar_wait_for_feedback: planTools().bizar_wait_for_feedback!,
    };

    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas", planSlug: slug } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(tools));

    expect(res.responseOverride).toBeDefined();
    // The tool returns a structured object that gets stringified.
    expect(capturedCtx).not.toBeNull();
    const cc = capturedCtx as unknown as { sessionId: string; agentId: string };
    expect(cc.sessionId).toBe("slash-command");
    expect(cc.agentId).toBe("slash-command");
    expect(capturedArgs).toMatchObject({ action: "get_canvas", planSlug: slug });
  });
});

// ---------------------------------------------------------------------------
// Group 7 — executeToolInvocation — arg validation
// ---------------------------------------------------------------------------

describe("executeToolInvocation — arg validation", () => {
  test("rejects malformed args (missing planSlug) with a responseOverride", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments for bizar_plan_action/);
  });

  test("rejects malformed args (invalid slug) with a responseOverride", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas", planSlug: "UPPERCASE" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments/);
  });
});

// ---------------------------------------------------------------------------
// Group 8 — executeToolInvocation — unknown tool
// ---------------------------------------------------------------------------

describe("executeToolInvocation — unknown tool", () => {
  test("returns responseOverride listing available tools", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_nonexistent", args: {} };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/bizar_nonexistent.*not registered/);
    expect(res.responseOverride).toMatch(/bizar_plan_action/);
  });

  test("when no tools are registered, the error says (none)", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_anything", args: {} };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith({}));
    expect(res.responseOverride).toMatch(/\(none\)/);
  });
});

// ---------------------------------------------------------------------------
// Group 9 — executeToolInvocation — tool throws
// ---------------------------------------------------------------------------

describe("executeToolInvocation — tool throws", () => {
  test("stringifies the error into responseOverride (does NOT throw)", async () => {
    const explodingTool: AgentTool = createTool({
      name: "bizar_explode",
      description: "explodes",
      inputSchema: z.object({ x: z.string() }).shape,
      execute: async () => { throw new Error("boom!"); },
    });
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_explode", args: { x: "hi" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith({ bizar_explode: explodingTool }));
    expect(res.responseOverride).toMatch(/bizar_explode failed: boom!/);
  });
});

// ---------------------------------------------------------------------------
// Group 10 — synthetic context field check
// ---------------------------------------------------------------------------

describe("synthetic context — exhaustive field check", () => {
  test("exposes sessionId, agentId, runId, iteration, signal, metadata", () => {
    const tctx = buildSyntheticToolContext(ctx()) as unknown as Record<string, unknown>;
    for (const k of ["sessionId", "agentId", "runId", "iteration", "signal", "metadata"]) {
      expect(tctx[k]).toBeDefined();
    }
  });
});
