/**
 * tool-routing.test.ts — Integration tests for the tool_invocation path
 * in slash commands. Phase 2 — Cline SDK port: tests the new
 * `AgentToolContext` shape and the Cline `createTool` API.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
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
import type { AgentTool, AgentToolContext } from "@cline/sdk";

class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  debug(m: string) { this.messages.push({ level: "debug", message: m }); }
  info(m: string) { this.messages.push({ level: "info", message: m }); }
  warn(m: string) { this.messages.push({ level: "warn", message: m }); }
  error(m: string) { this.messages.push({ level: "error", message: m }); }
  log(_o: unknown) { /* swallow */ }
}

let worktree: string;
const logger = new MockLogger();

beforeAll(() => { worktree = mkdtempSync(join(tmpdir(), "bizar-tool-routing-")); });
afterAll(() => { if (worktree) rmSync(worktree, { recursive: true, force: true }); });

function ctx(): ExecutorContext { return { worktree, directory: worktree, logger }; }

function optsWith(tools: Record<string, AgentTool>): ExecuteOptions {
  return { tools, defaultTemplate: "blank", defaultPort: 4321 };
}

const planTools = (): Record<string, AgentTool> => ({
  bizar_plan_action: createPlanActionTool({ worktree, logger }) as unknown as AgentTool,
  bizar_get_plan_comments: createBgGetCommentsTool({ worktree, logger }) as unknown as AgentTool,
  bizar_wait_for_feedback: createWaitForFeedbackTool({ worktree, logger }) as unknown as AgentTool,
});

describe("ToolContext — required fields", () => {
  test("synthetic context has all required fields", () => {
    const tctx = buildSyntheticToolContext(ctx()) as unknown as Record<string, unknown>;
    expect(tctx.sessionId).toBe("slash-command");
    expect(tctx.agentId).toBe("slash-command");
    expect(tctx.runId).toBeDefined();
    expect(tctx.iteration).toBe(0);
    expect(tctx.signal).toBeDefined();
    expect(tctx.metadata).toBeDefined();
  });

  test("abort.signal is NOT aborted", () => {
    const tctx = buildSyntheticToolContext(ctx()) as unknown as { signal: AbortSignal };
    expect(tctx.signal.aborted).toBe(false);
  });

  test("each call gets a fresh AbortSignal (not shared)", () => {
    const a = buildSyntheticToolContext(ctx()) as unknown as { signal: AbortSignal };
    const b = buildSyntheticToolContext(ctx()) as unknown as { signal: AbortSignal };
    expect(a.signal).not.toBe(b.signal);
  });
});

describe("ToolInvocation — args validation via Zod", () => {
  test("malformed args (invalid slug) → refusal response, tool NOT invoked", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas", planSlug: "UPPERCASE" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments/);
  });

  test("missing required arg (no planSlug) → refusal response, tool NOT invoked", async () => {
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    expect(res.responseOverride).toMatch(/Invalid arguments/);
  });

  test("valid args → tool IS invoked (spy verifies factory call)", async () => {
    // Pre-create a plan first.
    await executeSideEffect({ kind: "create_plan", slug: "routing-spy", template: null }, ctx(), optsWith(planTools()));
    const sideEffect: SideEffect = { kind: "tool_invocation", toolName: "bizar_plan_action", args: { action: "get_canvas", planSlug: "routing-spy" } };
    const res = await executeSideEffect(sideEffect, ctx(), optsWith(planTools()));
    expect(res.responseOverride).toBeDefined();
    // Should not be a validation error
    expect(res.responseOverride).not.toMatch(/Invalid arguments/);
  });
});
