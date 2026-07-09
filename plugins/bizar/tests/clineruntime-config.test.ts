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
      defaultMaxConsecutiveMistakes: 6,
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
    expect(cfg.execution).toEqual({ maxConsecutiveMistakes: 6 });
    expect(typeof cfg.onConsecutiveMistakeLimitReached).toBe("function");
    // Invoke the wire-through function and confirm it IS the recovery closure.
    const fn = cfg.onConsecutiveMistakeLimitReached as (ctx: ConsecutiveMistakeLimitContext) => unknown;
    fn({ iteration: 1, consecutiveMistakes: 3, maxConsecutiveMistakes: 6, reason: "invalid_tool_call" });
    expect(recoveryCalls.length).toBe(1);
    expect(recoveryCalls[0]!.reason).toBe("invalid_tool_call");
  });

  test("caller-supplied execution.maxConsecutiveMistakes wins over default", async () => {
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

function stubLogger(): { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug: (m: string) => void; log: (o: { level: string; message: string }) => void } {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    log: () => {},
  };
}
