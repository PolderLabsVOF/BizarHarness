/**
 * tool-routing.test.ts — Integration tests for the tool_invocation path
 * in slash commands.
 *
 * Exercises:
 *   - Synthetic ToolContext has all required fields (sessionID, messageID,
 *     agent, directory, worktree, abort, metadata, ask)
 *   - Args validation via Zod rejects malformed args → refusal response
 *   - Real `bizar_plan_action` factory is invoked when args are valid
 *   - Response string contains the tool's JSON output
 *   - `metadata()` and `ask()` stubs are callable and no-op
 *   - `abort.signal` is a valid AbortSignal (not aborted)
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  executeSideEffect,
  buildSyntheticToolContext,
  type ExecutorContext,
  type ExecuteOptions,
} from "../../src/commands-impl";
import { createPlanActionTool } from "../../src/tools/plan-action";
import { createBgGetCommentsTool } from "../../src/tools/bg-get-comments";
import { createWaitForFeedbackTool } from "../../src/tools/wait-for-feedback";
import type { SideEffect } from "../../src/commands";
import type { ToolContext } from "@opencode-ai/plugin";

// ---------------------------------------------------------------------------
// Mock logger
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
// Per-test temp worktree
// ---------------------------------------------------------------------------

let worktree: string;
let logger: MockLogger;

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-tool-routing-"));
  logger = new MockLogger();
});

afterEach(() => {
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

afterAll(() => {
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

function makeCtx(): ExecutorContext {
  return { worktree, directory: worktree, logger };
}

function makeOpts(toolsOverride?: Record<string, ReturnType<typeof createPlanActionTool>>): ExecuteOptions {
  return {
    tools: {
      bizar_plan_action: createPlanActionTool({ worktree, logger }),
      bizar_get_plan_comments: createBgGetCommentsTool({ worktree, logger }),
      bizar_wait_for_feedback: createWaitForFeedbackTool({ worktree, logger }),
      ...toolsOverride,
    },
    defaultTemplate: "blank",
    defaultPort: 4321,
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("ToolContext — required fields", () => {
  test("synthetic ToolContext has all required fields (R6)", () => {
    const ctx = makeCtx();
    const tctx = buildSyntheticToolContext(ctx);

    expect(tctx.sessionID).toBe("slash-command");
    expect(tctx.messageID).toMatch(/^slash-command-\d+$/);
    expect(tctx.agent).toBe("");
    expect(tctx.directory).toBe(ctx.directory);
    expect(tctx.worktree).toBe(ctx.worktree);
    expect(tctx.abort).toBeInstanceOf(AbortSignal);
    expect(typeof tctx.metadata).toBe("function");
    expect(typeof tctx.ask).toBe("function");
  });

  test("abort.signal is NOT aborted", () => {
    const tctx = buildSyntheticToolContext(makeCtx());
    expect(tctx.abort.aborted).toBe(false);
  });

  test("metadata() is a no-op (does not throw)", () => {
    const tctx = buildSyntheticToolContext(makeCtx());
    expect(() => tctx.metadata({ title: "test" })).not.toThrow();
    expect(() => tctx.metadata({})).not.toThrow();
  });

  test("ask() is a no-op (resolves to undefined)", async () => {
    const tctx = buildSyntheticToolContext(makeCtx());
    await expect(
      tctx.ask({ permission: "x", patterns: [], always: [], metadata: {} }),
    ).resolves.toBeUndefined();
  });

  test("each call gets a fresh AbortSignal (not shared)", () => {
    const a = buildSyntheticToolContext(makeCtx());
    const b = buildSyntheticToolContext(makeCtx());
    expect(a.abort).not.toBe(b.abort);
  });
});

describe("ToolContext — exhaustive field check", () => {
  test("exposes every field the tool contract requires", () => {
    const c = makeCtx();
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

describe("ToolInvocation — args validation via Zod", () => {
  test("malformed args (invalid slug) → refusal response, tool NOT invoked", async () => {
    // Pre-create the plan so the tool WOULD succeed with valid args
    await executeSideEffect(
      { kind: "create_plan", slug: "test-plan", template: null },
      makeCtx(),
      makeOpts(),
    );

    // Spy on the tool
    let invokeCount = 0;
    const realTool = makeOpts().tools["bizar_plan_action"]!;
    const spyOpts: ExecuteOptions = {
      ...makeOpts(),
      tools: {
        ...makeOpts().tools,
        bizar_plan_action: {
          description: realTool.description,
          args: realTool.args,
          execute: async (args, ctx) => {
            invokeCount++;
            return realTool.execute(args as never, ctx);
          },
        },
      },
    };

    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: "INVALID_SLUG_UPPER" },
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), spyOpts);

    // Should have returned a refusal (validation failed before tool call)
    expect(r.responseOverride).toMatch(/Invalid arguments/);
    expect(r.responseOverride).toMatch(/planSlug/);
    // Tool should NOT have been called (validation short-circuits)
    expect(invokeCount).toBe(0);
  });

  test("missing required arg (no planSlug) → refusal response, tool NOT invoked", async () => {
    let invokeCount = 0;
    const realTool = makeOpts().tools["bizar_plan_action"]!;
    const spyOpts: ExecuteOptions = {
      ...makeOpts(),
      tools: {
        ...makeOpts().tools,
        bizar_plan_action: {
          description: realTool.description,
          args: realTool.args,
          execute: async (args, ctx) => {
            invokeCount++;
            return realTool.execute(args as never, ctx);
          },
        },
      },
    };

    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas" /* missing planSlug */ },
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), spyOpts);

    expect(r.responseOverride).toMatch(/Invalid arguments/);
    expect(invokeCount).toBe(0);
  });

  test("valid args → tool IS invoked (spy verifies factory call)", async () => {
    // Pre-create plan
    await executeSideEffect(
      { kind: "create_plan", slug: "valid-test", template: null },
      makeCtx(),
      makeOpts(),
    );

    let invokeCount = 0;
    let capturedCtx: ToolContext | null = null;
    const realTool = makeOpts().tools["bizar_plan_action"]!;
    const spyOpts: ExecuteOptions = {
      ...makeOpts(),
      tools: {
        ...makeOpts().tools,
        bizar_plan_action: {
          description: realTool.description,
          args: realTool.args,
          execute: async (args, ctx) => {
            invokeCount++;
            capturedCtx = ctx;
            return realTool.execute(args as never, ctx);
          },
        },
      },
    };

    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: "valid-test" },
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), spyOpts);

    expect(invokeCount).toBe(1);
    expect(r.responseOverride).toBeDefined();
    // The response should be JSON containing our slug
    expect(r.responseOverride!).toMatch(/valid-test/);
    // Captured context should be the synthetic one
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.sessionID).toBe("slash-command");
  });
});

describe("ToolInvocation — response format", () => {
  test("response string contains the tool's JSON output", async () => {
    // Pre-create plan with known content
    await executeSideEffect(
      { kind: "create_plan", slug: "resp-test", template: null },
      makeCtx(),
      makeOpts(),
    );

    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_plan_action",
      args: { action: "get_canvas", planSlug: "resp-test" },
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), makeOpts());

    expect(r.responseOverride).toBeDefined();
    // Should be parseable JSON with our fields
    const parsed = JSON.parse(r.responseOverride!);
    expect(parsed.ok).toBe(true);
    expect(parsed.planSlug).toBe("resp-test");
  });
});

describe("ToolInvocation — unknown tool", () => {
  test("unknown tool name → refusal response listing available tools", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_nonexistent",
      args: {},
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), makeOpts());

    expect(r.responseOverride).toBeDefined();
    expect(r.responseOverride).toMatch(/bizar_nonexistent/);
    expect(r.responseOverride).toMatch(/bizar_plan_action/);
  });

  test("when no tools registered, error says \(none\)", async () => {
    const sideEffect: SideEffect = {
      kind: "tool_invocation",
      toolName: "bizar_anything",
      args: {},
    };

    const r = await executeSideEffect(sideEffect, makeCtx(), { tools: {}, defaultTemplate: "blank", defaultPort: 4321 });

    expect(r.responseOverride).toMatch(/\(none\)/);
  });
});
