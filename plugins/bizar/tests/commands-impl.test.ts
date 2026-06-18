/**
 * commands-impl.test.ts
 *
 * Unit tests for src/commands-impl.ts (the slash-command side-effect
 * executor) and its helpers. These cover the wiring added in v0.5.0
 * that makes `/plan add foo --title X` actually create an element on
 * the canvas by routing through `bizar_plan_action` with a synthetic
 * `ToolContext`.
 *
 * Groups:
 *   1. buildSyntheticToolContext       — populates all required fields
 *   2. validateToolArgs                — Zod pre-validation
 *   3. executeSideEffect — create_plan (happy + existing slug)
 *   4. executeSideEffect — list_plans (rich output)
 *   5. executeSideEffect — open_plan_url (no I/O; uses parser response)
 *   6. executeToolInvocation — happy path through real tool
 *   7. executeToolInvocation — malformed args → validation response
 *   8. executeToolInvocation — unknown tool → response error
 *   9. executeToolInvocation — tool throws → stringified response
 *  10. Synthetic context reaches the tool
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";

import {
  executeSideEffect,
  executeToolInvocation,
  buildSyntheticToolContext,
  validateToolArgs,
  type ExecuteOptions,
  type ExecutorContext,
} from "../src/commands-impl";
import type { SideEffect } from "../src/commands";
import {
  createPlanActionTool,
} from "../src/tools/plan-action";
import { createBgGetCommentsTool } from "../src/tools/bg-get-comments";
import { createWaitForFeedbackTool } from "../src/tools/wait-for-feedback";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  log(opts: { level: string; message: string }) { this.messages.push(opts); }
  debug(m: string) { this.messages.push({ level: "debug", message: m }); }
  info(m: string) { this.messages.push({ level: "info", message: m }); }
  warn(m: string) { this.messages.push({ level: "warn", message: m }); }
  error(m: string) { this.messages.push({ level: "error", message: m }); }
}

// ---------------------------------------------------------------------------
// Per-suite temp worktree
// ---------------------------------------------------------------------------

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

function optsWith(tools: Record<string, ToolDefinition>): ExecuteOptions {
  return {
    tools,
    defaultTemplate: "blank",
    defaultPort: 4321,
  };
}

const planTools = () => ({
  bizar_plan_action: createPlanActionTool({ worktree, logger }),
  bizar_get_plan_comments: createBgGetCommentsTool({ worktree, logger }),
  bizar_wait_for_feedback: createWaitForFeedbackTool({ worktree, logger }),
});

// ===========================================================================
// Group 1 — buildSyntheticToolContext
// ===========================================================================

describe("buildSyntheticToolContext", () => {
  test("populates all required fields (R6)", () => {
    const c = ctx();
    const tctx = buildSyntheticToolContext(c);

    expect(tctx.sessionID).toBe("slash-command");
    expect(tctx.messageID).toMatch(/^slash-command-\d+$/);
    expect(tctx.agent).toBe("");
    expect(tctx.directory).toBe(c.directory);
    expect(tctx.worktree).toBe(c.worktree);
    expect(tctx.abort).toBeInstanceOf(AbortSignal);
    expect(typeof tctx.metadata).toBe("function");
    expect(typeof tctx.ask).toBe("function");
  });

  test("metadata() and ask() are no-ops (do not throw)", () => {
    const tctx = buildSyntheticToolContext(ctx());
    expect(() => tctx.metadata({ title: "t" })).not.toThrow();
    expect(() => tctx.metadata({})).not.toThrow();
    return expect(tctx.ask({ permission: "x", patterns: [], always: [], metadata: {} })).resolves.toBeUndefined();
  });

  test("each call gets a fresh AbortSignal (not shared)", () => {
    const a = buildSyntheticToolContext(ctx());
    const b = buildSyntheticToolContext(ctx());
    expect(a.abort).not.toBe(b.abort);
  });
});

// ===========================================================================
// Group 2 — validateToolArgs
// ===========================================================================

describe("validateToolArgs", () => {
  const echoTool: ToolDefinition = tool({
    description: "echo",
    args: {
      message: z.string(),
    },
    execute: async (a) => ({ output: JSON.stringify(a) }),
  });

  test("ok on well-formed args", () => {
    const r = validateToolArgs(echoTool, { message: "hi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.message).toBe("hi");
  });

  test("error on malformed args (returns path + message)", () => {
    const r = validateToolArgs(echoTool, { message: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/message/);
    }
  });

  test("error on missing required arg", () => {
    const r = validateToolArgs(echoTool, {});
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// Group 3 — executeSideEffect — create_plan
// ===========================================================================

describe("executeSideEffect — create_plan", () => {
  test("happy path: writes plans/<slug>/meta.json and plan.json", async () => {
    const slug = "create-happy";
    const sideEffect: SideEffect = { kind: "create_plan", slug, template: null };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));

    // No error — success is encoded in responseSuffix.
    expect(res.responseOverride).toBeUndefined();
    expect(res.responseSuffix).toMatch(/Created plans\/create-happy\//);

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
    expect(canvas.connections).toEqual([]);
    expect(canvas.comments).toEqual([]);
  });

  test("refuses to clobber an existing plan (returns responseOverride)", async () => {
    const slug = "create-existing";
    const first: SideEffect = { kind: "create_plan", slug, template: null };
    const r1 = await executeSideEffect(first, ctx(), optsWith(planTools()));
    expect(r1.responseOverride).toBeUndefined(); // success path uses suffix

    // Second create must NOT clobber.
    const r2 = await executeSideEffect(first, ctx(), optsWith(planTools()));
    expect(r2.responseOverride).toBeDefined();
    expect(r2.responseOverride).toMatch(/already exists/);
    expect(r2.responseOverride).toContain(slug);
  });

  test("rejects invalid slug via plan-fs (delegates validation)", async () => {
    const sideEffect: SideEffect = { kind: "create_plan", slug: "INVALID", template: null };
    const r = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(r.responseOverride).toBeDefined();
    expect(r.responseOverride).toMatch(/Invalid slug/);
  });
});

// ===========================================================================
// Group 4 — executeSideEffect — list_plans
// ===========================================================================

describe("executeSideEffect — list_plans", () => {
  test("returns rich list with status + lastEdited", async () => {
    // Pre-seed two plans.
    await executeSideEffect(
      { kind: "create_plan", slug: "list-a", template: null },
      ctx(),
      optsWith(planTools()),
    );
    await executeSideEffect(
      { kind: "create_plan", slug: "list-b", template: null },
      ctx(),
      optsWith(planTools()),
    );

    const res = await executeSideEffect(
      { kind: "list_plans" },
      ctx(),
      optsWith(planTools()),
    );

    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/list-a/);
    expect(res.responseOverride).toMatch(/list-b/);
    expect(res.responseOverride).toMatch(/status: draft/);
  });

  test("returns 'No plans found' when worktree has no plans", async () => {
    // Use a fresh worktree so we don't see the seeded ones above.
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

// ===========================================================================
// Group 5 — executeSideEffect — open_plan_url
// ===========================================================================

describe("executeSideEffect — open_plan_url", () => {
  test("returns no override (the parser already built the URL)", async () => {
    const res = await executeSideEffect(
      { kind: "open_plan_url", slug: "any-slug" },
      ctx(),
      optsWith(planTools()),
    );
    expect(res.responseOverride).toBeUndefined();
    expect(res.responseSuffix).toBeUndefined();
  });
});

// ===========================================================================
// Group 6 — executeToolInvocation — happy path
// ===========================================================================

describe("executeToolInvocation — happy path", () => {
  test("invokes bizar_plan_action (get_canvas) with synthetic ToolContext", async () => {
    // Pre-create a plan so get_canvas has something to return.
    const slug = "inv-get-canvas";
    await executeSideEffect(
      { kind: "create_plan", slug, template: null },
      ctx(),
      optsWith(planTools()),
    );

    // Spy by wrapping the real tool's execute.
    const realPlanTool = planTools().bizar_plan_action;
    let capturedCtx: ToolContext | null = null;
    let capturedArgs: unknown = null;
    const spy: ToolDefinition = {
      description: realPlanTool.description,
      args: realPlanTool.args,
      execute: async (a, c) => {
        capturedCtx = c;
        capturedArgs = a;
        return realPlanTool.execute(a as never, c);
      },
    };

    const tools: Record<string, ToolDefinition> = {
      bizar_plan_action: spy,
      bizar_get_plan_comments: planTools().bizar_get_plan_comments,
      bizar_wait_for_feedback: planTools().bizar_wait_for_feedback,
    };

    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: slug },
    };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(tools));

    expect(res.responseOverride).toBeDefined();
    // The tool returns a JSON-stringified canvas; verify it parses and
    // contains our slug.
    const parsed = JSON.parse(res.responseOverride!);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("get_canvas");
    expect(parsed.planSlug).toBe(slug);
    expect(parsed.canvas.schemaVersion).toBe(2);

    // The synthetic ToolContext reached the tool.
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.sessionID).toBe("slash-command");
    expect(capturedCtx!.agent).toBe("");
    expect(capturedCtx!.worktree).toBe(worktree);
    expect(capturedCtx!.directory).toBe(worktree);
    expect(capturedCtx!.abort).toBeInstanceOf(AbortSignal);

    // Args were pre-validated (zod coerced/defaulted).
    expect(capturedArgs).toMatchObject({ action: "get_canvas", planSlug: slug });
  });
});

// ===========================================================================
// Group 7 — executeToolInvocation — malformed args
// ===========================================================================

describe("executeToolInvocation — arg validation", () => {
  test("rejects malformed args (missing planSlug) with a responseOverride", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas" /* missing planSlug */ },
    };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments for bizar_plan_action/);
    expect(res.responseOverride).toMatch(/planSlug/);
  });

  test("rejects malformed args (invalid slug) with a responseOverride", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: "UPPERCASE" },
    };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments for bizar_plan_action/);
  });
});

// ===========================================================================
// Group 8 — executeToolInvocation — unknown tool
// ===========================================================================

describe("executeToolInvocation — unknown tool", () => {
  test("returns responseOverride listing available tools", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_nonexistent",
      args: {},
    };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/bizar_nonexistent.*not registered/);
    // The error message should list the available tools.
    expect(res.responseOverride).toMatch(/bizar_plan_action/);
  });

  test("when no tools are registered, the error says (none)", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_anything",
      args: {},
    };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith({}));
    expect(res.responseOverride).toMatch(/\(none\)/);
  });
});

// ===========================================================================
// Group 9 — executeToolInvocation — tool throws
// ===========================================================================

describe("executeToolInvocation — tool throws", () => {
  test("stringifies the error into responseOverride (does NOT throw)", async () => {
    const explodingTool: ToolDefinition = {
      description: "explodes",
      args: { x: z.string() },
      execute: async () => {
        throw new Error("boom!");
      },
    };
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_explode",
      args: { x: "hi" },
    };
    const tools: Record<string, ToolDefinition> = {
      bizar_explode: explodingTool,
    };
    // Must not throw.
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(tools));
    expect(res.responseOverride).toMatch(/bizar_explode failed: boom!/);
  });
});

// ===========================================================================
// Group 10 — synthetic context field-by-field
// ===========================================================================

describe("synthetic ToolContext — exhaustive field check", () => {
  test("exposes every field the tool contract requires", () => {
    const c = ctx();
    const tctx = buildSyntheticToolContext(c);
    const keys: Array<keyof ToolContext> = [
      "sessionID",
      "messageID",
      "agent",
      "directory",
      "worktree",
      "abort",
      "metadata",
      "ask",
    ];
    for (const k of keys) {
      expect(tctx[k]).toBeDefined();
    }
  });
});
