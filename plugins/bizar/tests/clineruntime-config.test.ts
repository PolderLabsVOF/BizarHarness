/**
 * tests/clineruntime-config.test.ts
 *
 * v6.0.1 — Unit tests for `clineruntime.ts` config plumbing.
 *
 * Verifies that `startSession` routes `execution`,
 * `onConsecutiveMistakeLimitReached`, and the per-runtime defaults
 * through to `core.start()`. We do NOT call `ClineCore.create()` — a
 * stub core is injected via the (private) `core` field. `ensure()` is
 * the only path that touches ClineCore; once `core` is set, ensure()
 * returns synchronously, so the stub captures calls without booting
 * the real runtime.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ClineRuntime,
} from "../src/clineruntime";
import type { ConsecutiveMistakeLimitContext } from "@cline/shared";

interface CapturedStartInput {
  config: Record<string, unknown>;
  prompt: string;
}

const capturedConfig: CapturedStartInput[] = [];

function makeFakeCore() {
  const fake = {
    sessionId: "sess-fake-001",
    async start(input: CapturedStartInput): Promise<{ ok: true; sessionId: string }> {
      capturedConfig.push(input);
      return { ok: true, sessionId: fake.sessionId };
    },
    async send(): Promise<unknown> { return { ok: true }; },
    async abort(): Promise<unknown> { return { ok: true }; },
    async stop(): Promise<unknown> { return { ok: true }; },
    subscribe(): () => void { return () => undefined; },
    async dispose(): Promise<unknown> { return { ok: true }; },
  };
  return fake;
}

beforeEach(() => {
  capturedConfig.length = 0;
});

afterEach(() => {
  capturedConfig.length = 0;
});

describe("ClineRuntime.startSession — execution plumbing", () => {
  test("no execution + no runtime default → config.execution is absent", async () => {
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    expect(capturedConfig.length).toBe(1);
    const cfg = capturedConfig[0]!.config;
    expect("execution" in cfg).toBe(false);
    expect("onConsecutiveMistakeLimitReached" in cfg).toBe(false);
  });

  test("runtime default is applied when caller omits execution", async () => {
    const recoveryCalls: Array<ConsecutiveMistakeLimitContext> = [];
    const recovery = (ctx: ConsecutiveMistakeLimitContext) => {
      recoveryCalls.push(ctx);
      return { action: "continue" as const, guidance: "x" };
    };
    const runtime = new ClineRuntime({
      logger: stubLogger(),
      defaultMaxConsecutiveMistakes: 10,
      defaultOnConsecutiveMistakeLimitReached: recovery,
    });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.execution).toEqual({ maxConsecutiveMistakes: 10 });
    expect(typeof cfg.onConsecutiveMistakeLimitReached).toBe("function");
    // Invoke the wire-through function and confirm it IS the recovery closure.
    const fn = cfg.onConsecutiveMistakeLimitReached as (ctx: ConsecutiveMistakeLimitContext) => unknown;
    fn({ iteration: 1, consecutiveMistakes: 3, maxConsecutiveMistakes: 10, reason: "invalid_tool_call" });
    expect(recoveryCalls.length).toBe(1);
    expect(recoveryCalls[0]!.reason).toBe("invalid_tool_call");
  });

  test("v6.2.4 — plugin default is a FLOOR; CLI default of 3 is bumped to plugin default", async () => {
    // This is the v6.2.0 → v6.2.4 regression test. Previously the
    // caller's maxConsecutiveMistakes (e.g. the Cline CLI's --retries
    // default of 3) would silently override the plugin's higher
    // default. Now we use Math.max so the plugin's 10 wins.
    const runtime = new ClineRuntime({
      logger: stubLogger(),
      defaultMaxConsecutiveMistakes: 10,
    });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
      execution: { maxConsecutiveMistakes: 3, reminderAfterIterations: 8 },
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.execution?.maxConsecutiveMistakes).toBe(10,
      "plugin default must win over CLI default of 3 (was a v6.0 regression)");
    expect(cfg.execution?.reminderAfterIterations).toBe(8, "other caller fields pass through");
  });

  test("caller-supplied HIGHER execution.maxConsecutiveMistakes still wins", async () => {
    const runtime = new ClineRuntime({
      logger: stubLogger(),
      defaultMaxConsecutiveMistakes: 10,
    });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
      execution: { maxConsecutiveMistakes: 20, reminderAfterIterations: 8 },
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.execution?.maxConsecutiveMistakes).toBe(20,
      "user can still raise the limit with --retries 20");
  });

  test("caller-supplied execution.maxConsecutiveMistakes wins over default (legacy behavior)", async () => {
    const runtime = new ClineRuntime({
      logger: stubLogger(),
      defaultMaxConsecutiveMistakes: 4,
    });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
      execution: { maxConsecutiveMistakes: 12, reminderAfterIterations: 8 },
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.execution).toEqual({ maxConsecutiveMistakes: 12, reminderAfterIterations: 8 });
  });

  test("caller-supplied recovery callback overrides runtime default", async () => {
    let defaultCalled = false;
    let overrideCalled = false;
    const runtime = new ClineRuntime({
      logger: stubLogger(),
      defaultOnConsecutiveMistakeLimitReached: () => {
        defaultCalled = true;
        return { action: "continue" as const };
      },
    });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
      onConsecutiveMistakeLimitReached: () => {
        overrideCalled = true;
        return { action: "continue" as const };
      },
    });
    const fn = capturedConfig[0]!.config.onConsecutiveMistakeLimitReached as () => { action: string };
    fn();
    expect(overrideCalled).toBe(true);
    expect(defaultCalled).toBe(false);
  });

  test("defaultMaxConsecutiveMistakes floors at 3", () => {
    const runtime = new ClineRuntime({ logger: stubLogger(), defaultMaxConsecutiveMistakes: 1 });
    const value = (runtime as unknown as { defaultMaxConsecutiveMistakes?: number }).defaultMaxConsecutiveMistakes;
    expect(value).toBe(3);
  });

  test("reminderText and loopDetection pass through unchanged", async () => {
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
      execution: {
        reminderAfterIterations: 5,
        reminderText: "synthesize now",
        loopDetection: { softThreshold: 4, hardThreshold: 7 },
      },
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.execution).toEqual({
      reminderAfterIterations: 5,
      reminderText: "synthesize now",
      loopDetection: { softThreshold: 4, hardThreshold: 7 },
    });
  });
});

describe("ClineRuntime.startSession — agent teams plumbing (v6.2.0)", () => {
  test("enableAgentTeams is true on every session (team-spawn requires it)", async () => {
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.enableAgentTeams).toBe(true);
  });

  test("enableTools is true, enableSpawnAgent is true (subagents + task tool)", async () => {
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.enableTools).toBe(true);
    expect(cfg.enableSpawnAgent).toBe(true,
      "enableSpawnAgent must be true so Odin can use the `task` tool and `use_subagents`");
  });

  test("all three boolean flags survive even when caller passes no opts", async () => {
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.enableAgentTeams).toBe(true);
    expect(cfg.enableTools).toBe(true);
    expect(cfg.enableSpawnAgent).toBe(true,
      "v6.2.3 — subagents + task tool must be available even without caller opts");
  });
});

describe("ClineRuntime.startSession — subagents plumbing (v6.2.3)", () => {
  test("enableSpawnAgent regression: must NEVER be false (v6.2.3 fix)", async () => {
    // v6.2.3 flipped enableSpawnAgent from false → true. Before this
    // change, Odin could not use the `task` tool or `use_subagents`,
    // which silently broke subagent delegation. This test pins the fix.
    const runtime = new ClineRuntime({ logger: stubLogger() });
    (runtime as unknown as { core: unknown }).core = makeFakeCore();
    await runtime.startSession({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      workspaceRoot: "/tmp",
      prompt: "go",
    });
    const cfg = capturedConfig[0]!.config;
    expect(cfg.enableSpawnAgent).not.toBe(false);
    expect(cfg.enableSpawnAgent).toBe(true);
  });
});

function stubLogger(): { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug: (m: string) => void; log: (o: { level: string; message: string }) => void } {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => {},
  };
}
