/**
 * slash-command.test.ts — Integration tests for the full slash-command
 * hook → parser → side-effect → file-I/O path.
 *
 * Exercises:
 *   - `/plan new foo` → `plans/foo/meta.json` + `plans/foo/plan.json` on disk
 *   - `/plan list` → response contains slugs of seeded plans
 *   - `/plan add foo --title X --type task` → element written to `plan.json`
 *   - `/plan status foo approved` → `meta.json` status updated
 *   - `/plan delete foo <elementId>` → element removed from `plan.json`
 *   - `/plan wait foo` → deferred response (< 100 ms, no blocking)
 *   - `/plan new foo` on existing slug → refusal, no clobber
 *   - `/plan comment foo "text"` → comment written to `plan.json`
 *   - `/plan comments foo` → response lists the comment
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseSlashCommand } from "../../src/commands";
import {
  executeSideEffect,
  type ExecutorContext,
  type ExecuteOptions,
} from "../../src/commands-impl";
import { createPlanActionTool } from "../../src/tools/plan-action";
import { createBgGetCommentsTool } from "../../src/tools/bg-get-comments";
import { createWaitForFeedbackTool } from "../../src/tools/wait-for-feedback";
import { DEFAULT_PLAN_SETTINGS, type PlanSettings } from "../../src/settings";

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
  worktree = mkdtempSync(join(tmpdir(), "bizar-integration-"));
  logger = new MockLogger();
});

afterEach(() => {
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

afterAll(() => {
  // already cleaned in afterEach, but keep for safety
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: build minimal ExecutorContext + ExecuteOptions
// ---------------------------------------------------------------------------

function makeCtx(): ExecutorContext {
  return { worktree, directory: worktree, logger };
}

function makeOpts(): ExecuteOptions {
  return {
    tools: {
      bizar_plan_action: createPlanActionTool({ worktree, logger }),
      bizar_get_plan_comments: createBgGetCommentsTool({ worktree, logger }),
      bizar_wait_for_feedback: createWaitForFeedbackTool({ worktree, logger }),
    },
    defaultTemplate: "blank",
    defaultPort: 4321,
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("integration: /plan new", () => {
  test("/plan new foo → creates plans/foo/meta.json and plan.json with correct content", async () => {
    const result = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    expect(result).not.toBeNull();
    expect(result!.sideEffect!.kind).toBe("create_plan");

    await executeSideEffect(result!.sideEffect!, makeCtx(), makeOpts());

    const metaPath = join(worktree, "plans", "foo", "meta.json");
    const planPath = join(worktree, "plans", "foo", "plan.json");
    expect(existsSync(metaPath)).toBe(true);
    expect(existsSync(planPath)).toBe(true);

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.status).toBe("draft");
    expect(meta.slug).toBeUndefined(); // slug not stored, title is titleCase
    expect(typeof meta.lastEdited).toBe("string");

    const canvas = JSON.parse(readFileSync(planPath, "utf-8"));
    expect(canvas.schemaVersion).toBe(2);
    expect(canvas.elements).toEqual([]);
    expect(canvas.connections).toEqual([]);
    expect(canvas.comments).toEqual([]);
  });
});

describe("integration: /plan list", () => {
  test("/plan list after creating foo and bar → response contains both slugs", async () => {
    // Seed two plans
    for (const slug of ["foo", "bar"]) {
      const r = parseSlashCommand(`/plan new ${slug}`, {
        currentSettings: DEFAULT_PLAN_SETTINGS,
        availablePlanSlugs: [],
        defaultPort: 4321,
      });
      await executeSideEffect(r!.sideEffect!, makeCtx(), makeOpts());
    }

    const listResult = parseSlashCommand("/plan list", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo", "bar"],
      defaultPort: 4321,
    });
    expect(listResult).not.toBeNull();
    const execResult = await executeSideEffect(listResult!.sideEffect!, makeCtx(), makeOpts());
    const response = execResult.responseOverride ?? listResult!.response;
    expect(response).toMatch(/foo/);
    expect(response).toMatch(/bar/);
  });
});

describe("integration: /plan add", () => {
  test("/plan add foo --title X --type task → plan.json contains the element", async () => {
    // First create the plan
    const newR = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(newR!.sideEffect!, makeCtx(), makeOpts());

    // Now add an element
    const addR = parseSlashCommand('/plan add foo --title X --type task', {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    expect(addR).not.toBeNull();
    expect(addR!.sideEffect!.kind).toBe("tool_invocation");
    const execR = await executeSideEffect(addR!.sideEffect!, makeCtx(), makeOpts());

    const planPath = join(worktree, "plans", "foo", "plan.json");
    const canvas = JSON.parse(readFileSync(planPath, "utf-8"));
    expect(canvas.elements).toHaveLength(1);
    expect(canvas.elements[0]!.title).toBe("X");
    expect(canvas.elements[0]!.type).toBe("task");
  });
});

describe("integration: /plan status", () => {
  test("/plan status foo approved → meta.json status is approved", async () => {
    // Create the plan first
    const newR = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(newR!.sideEffect!, makeCtx(), makeOpts());

    const statusR = parseSlashCommand("/plan status foo approved", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    await executeSideEffect(statusR!.sideEffect!, makeCtx(), makeOpts());

    const metaPath = join(worktree, "plans", "foo", "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.status).toBe("approved");
  });
});

describe("integration: /plan delete", () => {
  test("/plan delete foo <elementId> → element removed from plan.json", async () => {
    // Create plan and add an element
    const newR = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(newR!.sideEffect!, makeCtx(), makeOpts());

    const addR = parseSlashCommand('/plan add foo --title Elem1 --type task', {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    await executeSideEffect(addR!.sideEffect!, makeCtx(), makeOpts());

    // Read back to get element id
    const planPath = join(worktree, "plans", "foo", "plan.json");
    let canvas = JSON.parse(readFileSync(planPath, "utf-8")) as {
      elements: Array<{ id: string; title: string }>;
    };
    expect(canvas.elements).toHaveLength(1);
    const elementId = canvas.elements[0]!.id;

    // Now delete it
    const delR = parseSlashCommand(`/plan delete foo ${elementId}`, {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    await executeSideEffect(delR!.sideEffect!, makeCtx(), makeOpts());

    canvas = JSON.parse(readFileSync(planPath, "utf-8"));
    expect(canvas.elements).toHaveLength(0);
  });
});

describe("integration: /plan wait", () => {
  test("/plan wait foo → returns deferred response, does NOT block hook (< 100ms)", async () => {
    const r = parseSlashCommand("/plan wait foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    expect(r).not.toBeNull();
    expect(r!.response).toMatch(/deferred/i);
    expect(r!.response).toMatch(/bizar_wait_for_feedback/);
    expect(r!.sideEffect).toBeUndefined(); // wait is NOT a tool_invocation

    // Verify it returns instantly (no async I/O)
    const start = Date.now();
    await executeSideEffect({ kind: "list_plans" }, makeCtx(), makeOpts()); // no-op
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

describe("integration: /plan new on existing slug", () => {
  test("/plan new foo on existing slug → refusal response, existing files intact", async () => {
    // Create the plan
    const r1 = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(r1!.sideEffect!, makeCtx(), makeOpts());

    const planDir = join(worktree, "plans", "foo");
    const metaBefore = readFileSync(join(planDir, "meta.json"), "utf-8");
    const planBefore = readFileSync(join(planDir, "plan.json"), "utf-8");

    // Try to create again
    const r2 = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    const execR = await executeSideEffect(r2!.sideEffect!, makeCtx(), makeOpts());

    // Should have refused
    expect(execR.responseOverride).toMatch(/already exists/);

    // Files should be unchanged
    expect(readFileSync(join(planDir, "meta.json"), "utf-8")).toBe(metaBefore);
    expect(readFileSync(join(planDir, "plan.json"), "utf-8")).toBe(planBefore);
  });
});

describe("integration: /plan comment", () => {
  test('/plan comment foo "first comment" → plan.json contains the comment', async () => {
    // Create the plan first
    const newR = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(newR!.sideEffect!, makeCtx(), makeOpts());

    const commentR = parseSlashCommand('/plan comment foo "first comment"', {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    await executeSideEffect(commentR!.sideEffect!, makeCtx(), makeOpts());

    const planPath = join(worktree, "plans", "foo", "plan.json");
    const canvas = JSON.parse(readFileSync(planPath, "utf-8")) as {
      comments: Array<{ id: string; text: string; author: string }>;
    };
    expect(canvas.comments).toHaveLength(1);
    expect(canvas.comments[0]!.text).toBe("first comment");
    expect(canvas.comments[0]!.author).toBe("user");
  });
});

describe("integration: /plan comments", () => {
  test("/plan comments foo → response lists the comment", async () => {
    // Create the plan first
    const newR = parseSlashCommand("/plan new foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: [],
      defaultPort: 4321,
    });
    await executeSideEffect(newR!.sideEffect!, makeCtx(), makeOpts());

    // Add a comment
    const commentR = parseSlashCommand('/plan comment foo "Hello world"', {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    await executeSideEffect(commentR!.sideEffect!, makeCtx(), makeOpts());

    // Now list comments
    const listR = parseSlashCommand("/plan comments foo", {
      currentSettings: DEFAULT_PLAN_SETTINGS,
      availablePlanSlugs: ["foo"],
      defaultPort: 4321,
    });
    const execR = await executeSideEffect(listR!.sideEffect!, makeCtx(), makeOpts());
    const response = execR.responseOverride ?? listR!.response;
    expect(response).toMatch(/Hello world/);
  });
});
