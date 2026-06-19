/**
 * Regression tests for the background-state mutex.
 *
 * BUG: `InstanceManager.update()` acquired the per-instance lock and then
 * called `BackgroundStateStore.save()`, which tried to acquire the same lock
 * again. That nested re-entry never resolved, so startup deadlocked while
 * `rebuildInMemoryMap()` tried to mark pending/running instances failed.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { InstanceManager, type AddDraft } from "../src/background.ts";
import {
  BackgroundStateStore,
  type BackgroundState,
} from "../src/background-state.ts";

const TEST_DIRS: string[] = [];

const logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

class FakeEventStream {
  onSessionEvent(): () => void {
    return () => {};
  }
}

function makeTempStateDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bizar-update-deadlock-"));
  TEST_DIRS.push(dir);
  return dir;
}

function makeDraft(overrides: Partial<AddDraft> = {}): AddDraft {
  return {
    instanceId: "bgr_deadlock_test",
    sessionId: "",
    agent: "odin",
    model: "agent-default",
    promptPreview: "Investigate startup deadlock",
    resultPreview: undefined,
    resultMessageIds: undefined,
    error: undefined,
    parentAgent: "odin",
    parentInstanceId: undefined,
    logPath: "/tmp/bgr_deadlock_test.log",
    timeoutMs: 30_000,
    toolCallCount: 0,
    loopGuardTool: undefined,
    lastEventAt: undefined,
    lastToolOrTextAt: undefined,
    interventionCount: undefined,
    interventionAt: undefined,
    interventionReason: undefined,
    ...overrides,
  };
}

function createManager(stateDir: string): {
  manager: InstanceManager;
  stateStore: BackgroundStateStore;
} {
  const stateStore = new BackgroundStateStore(stateDir, logger);
  const manager = new InstanceManager({
    stateStore,
    maxConcurrent: 8,
    toolCallCap: 250,
    logger,
    serve: { worktree: "/tmp" } as never,
    http: {} as never,
    stream: new FakeEventStream() as never,
    stallTimeoutMs: 180_000,
    thinkingLoopTimeoutMs: 300_000,
    maxInterventions: 1,
  });
  manager.disablePeriodicChecks();
  return { manager, stateStore };
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  return await Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
}

afterEach(() => {
  for (const dir of TEST_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("InstanceManager.update mutex regression", () => {
  it("resolves and persists instead of deadlocking on nested save", async () => {
    const stateDir = makeTempStateDir();
    const { manager, stateStore } = createManager(stateDir);
    const draft = makeDraft();

    await manager.add(draft);

    const result = await settleWithin(
      manager.update(draft.instanceId, {
        status: "failed",
        error: "plugin restarted while instance was pending",
      }),
      250,
    );

    expect(result).not.toBe("timeout");

    const stored = await stateStore.load(draft.instanceId);
    expect(stored?.status).toBe("failed");
  });

  it("rebuildInMemoryMap marks a pending instance failed without hanging", async () => {
    const stateDir = makeTempStateDir();
    const { manager, stateStore } = createManager(stateDir);
    const pendingState: BackgroundState = {
      ...makeDraft(),
      status: "pending",
      startedAt: Date.now(),
    };

    await stateStore.save(pendingState);

    const result = await settleWithin(manager.rebuildInMemoryMap(), 250);

    expect(result).not.toBe("timeout");

    const stored = await stateStore.load(pendingState.instanceId);
    expect(stored?.error).toBe("plugin restarted while instance was pending");
  });
});
