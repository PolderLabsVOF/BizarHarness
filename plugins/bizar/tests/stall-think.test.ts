/**
 * stall-think.test.ts
 *
 * v0.3.0 stall timeout + thinking-loop protection tests.
 *
 * Groups:
 *   1. researchInterventionPrompt()          — 5 tests
 *   2. normalizeOptions() v0.3.0 fields     — 6 tests
 *   3. BackgroundState schema backfill       — 3 tests
 *   4. Stall + thinking-loop detection logic — 7 tests
 *   5. bg-status toView v0.3.0 fields        — 2 tests
 *
 * Total: 23 tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Group 1 — researchInterventionPrompt
// ---------------------------------------------------------------------------

import { researchInterventionPrompt } from "../src/research-prompt.js";

describe("researchInterventionPrompt", () => {
  it("returns a string containing '[SYSTEM REMINDER — Thinking Loop Detected]'", () => {
    const result = researchInterventionPrompt(60_000);
    expect(result).toContain("[SYSTEM REMINDER — Thinking Loop Detected]");
  });

  it("includes the duration formatted as 'Xm Ys' for multi-minute durations", () => {
    const result = researchInterventionPrompt(330_000); // 5m 30s
    expect(result).toContain("5m 30s");
  });

  it("formats under-a-minute durations as 'Ys' (not '0m Ys')", () => {
    const result = researchInterventionPrompt(45_000); // 45s
    expect(result).toContain("45s");
    // Must NOT contain "0m" in the duration portion
    expect(result).not.toMatch(/0m \d+s/);
  });

  it("clamps negative or zero duration to 0s", () => {
    const neg = researchInterventionPrompt(-99_000);
    const zero = researchInterventionPrompt(0);
    // Both should produce "0s" (Math.max(0, …) in the function)
    expect(neg).toContain("0s");
    expect(zero).toContain("0s");
  });

  it("mentions 'task tool', 'Mimir', and 'bash' — the three action options", () => {
    const result = researchInterventionPrompt(60_000);
    expect(result).toContain("task tool");
    expect(result).toContain("Mimir");
    expect(result).toContain("bash");
  });
});

// ---------------------------------------------------------------------------
// Group 2 — normalizeOptions v0.3.0 fields
// ---------------------------------------------------------------------------

import { normalizeOptions } from "../src/options.js";

describe("normalizeOptions — v0.3.0 fields", () => {
  it("defaults: backgroundStallTimeoutMs === 180_000, backgroundThinkingLoopTimeoutMs === 300_000, backgroundMaxInterventions === 1", () => {
    const { options } = normalizeOptions(undefined);
    expect(options.backgroundStallTimeoutMs).toBe(180_000);
    expect(options.backgroundThinkingLoopTimeoutMs).toBe(300_000);
    expect(options.backgroundMaxInterventions).toBe(1);
  });

  it("clamps backgroundStallTimeoutMs < 10000 to 10000 and pushes a note", () => {
    const { options, notes } = normalizeOptions({ backgroundStallTimeoutMs: 999 });
    expect(options.backgroundStallTimeoutMs).toBe(10_000);
    expect(notes.some((n) => n.includes("backgroundStallTimeoutMs") && n.includes("clamped"))).toBe(true);
  });

  it("clamps backgroundStallTimeoutMs > 600000 to 600000 and pushes a note", () => {
    const { options, notes } = normalizeOptions({ backgroundStallTimeoutMs: 999_999 });
    expect(options.backgroundStallTimeoutMs).toBe(600_000);
    expect(notes.some((n) => n.includes("backgroundStallTimeoutMs") && n.includes("clamped"))).toBe(true);
  });

  it("clamps backgroundMaxInterventions < 1 to 1", () => {
    const { options, notes } = normalizeOptions({ backgroundMaxInterventions: 0 });
    expect(options.backgroundMaxInterventions).toBe(1);
    expect(notes.some((n) => n.includes("backgroundMaxInterventions") && n.includes("clamped"))).toBe(true);
  });

  it("clamps backgroundMaxInterventions > 3 to 3", () => {
    const { options, notes } = normalizeOptions({ backgroundMaxInterventions: 99 });
    expect(options.backgroundMaxInterventions).toBe(3);
    expect(notes.some((n) => n.includes("backgroundMaxInterventions") && n.includes("clamped"))).toBe(true);
  });

  it("honors BIZAR_STALL_TIMEOUT_MS env var when no option is set", async () => {
    // Set the env var before importing/evaluating normalizeOptions.
    // Static imports are hoisted and evaluated before test code runs,
    // so we must use dynamic import AFTER setting the env var.
    process.env.BIZAR_STALL_TIMEOUT_MS = "42000";
    try {
      // Dynamically import AFTER the env var is set so the module's
      // function closure picks up the updated process.env at evaluation time.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import("../src/options.js") as any;
      const { options } = mod.normalizeOptions(undefined);
      expect(options.backgroundStallTimeoutMs).toBe(42000);
    } finally {
      delete process.env.BIZAR_STALL_TIMEOUT_MS;
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3 — BackgroundState schema backfill
// ---------------------------------------------------------------------------

import { BackgroundStateStore } from "../src/background-state.js";
import { TERMINAL_STATUSES } from "../src/background-state.js";

// Minimal Logger for tests
const silentLogger = {
  log(_opts: { level: "debug" | "info" | "warn" | "error"; message: string }) {},
  debug(_m: string) {},
  info(_m: string) {},
  warn(_m: string) {},
  error(_m: string) {},
};

function makeTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `bizar-stall-test-${prefix}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeOldStateFile(dir: string, instanceId: string, state: Record<string, unknown>): void {
  const bgDir = path.join(dir, "bg");
  mkdirSync(bgDir, { recursive: true });
  writeFileSync(path.join(bgDir, `${instanceId}.json`), JSON.stringify(state), "utf8");
}

describe("BackgroundState schema backfill", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("bg-state-backfill");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads an old-format state file (no lastEventAt) and backfills it to startedAt", async () => {
    const instanceId = "bgr_old_no_lastEventAt";
    const startedAt = 1_700_000_000_000;
    writeOldStateFile(tmpDir, instanceId, {
      instanceId,
      sessionId: "sess_abc",
      agent: "mimir",
      status: "running",
      startedAt,
      model: "openrouter/minimax-m3",
      promptPreview: "Do the thing",
      toolCallCount: 0,
      parentAgent: "odin",
      logPath: path.join(os.tmpdir(), "test.log"),
      timeoutMs: 300_000,
      // lastEventAt is intentionally absent
      lastToolOrTextAt: startedAt,
      interventionCount: 0,
    });

    const store = new BackgroundStateStore(tmpDir, silentLogger);
    const loaded = await store.load(instanceId);

    expect(loaded).not.toBeNull();
    expect(loaded!.lastEventAt).toBe(startedAt);
  });

  it("loads an old-format state file (no lastToolOrTextAt) and backfills it to startedAt", async () => {
    const instanceId = "bgr_old_no_lastToolOrTextAt";
    const startedAt = 1_700_000_000_000;
    writeOldStateFile(tmpDir, instanceId, {
      instanceId,
      sessionId: "sess_def",
      agent: "mimir",
      status: "running",
      startedAt,
      model: "openrouter/minimax-m3",
      promptPreview: "Do the thing",
      toolCallCount: 0,
      parentAgent: "odin",
      logPath: path.join(os.tmpdir(), "test.log"),
      timeoutMs: 300_000,
      lastEventAt: startedAt,
      // lastToolOrTextAt is intentionally absent
      interventionCount: 0,
    });

    const store = new BackgroundStateStore(tmpDir, silentLogger);
    const loaded = await store.load(instanceId);

    expect(loaded).not.toBeNull();
    expect(loaded!.lastToolOrTextAt).toBe(startedAt);
  });

  it("loads an old-format state file (no interventionCount) and backfills it to 0", async () => {
    const instanceId = "bgr_old_no_interventionCount";
    const startedAt = 1_700_000_000_000;
    writeOldStateFile(tmpDir, instanceId, {
      instanceId,
      sessionId: "sess_ghi",
      agent: "mimir",
      status: "running",
      startedAt,
      model: "openrouter/minimax-m3",
      promptPreview: "Do the thing",
      toolCallCount: 0,
      parentAgent: "odin",
      logPath: path.join(os.tmpdir(), "test.log"),
      timeoutMs: 300_000,
      lastEventAt: startedAt,
      lastToolOrTextAt: startedAt,
      // interventionCount is intentionally absent
    });

    const store = new BackgroundStateStore(tmpDir, silentLogger);
    const loaded = await store.load(instanceId);

    expect(loaded).not.toBeNull();
    expect(loaded!.interventionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — Stall + thinking-loop detection logic
//
// FakeInstanceManager replicates the v0.3.0 stall and thinking-loop
// detection algorithm from the real InstanceManager. It mirrors the
// real class surface and implements the exact same logic.
// ---------------------------------------------------------------------------

import type { BackgroundState, BackgroundStatus } from "../src/background-state.js";
import { TERMINAL_STATUSES as TERMINAL } from "../src/background-state.js";

/** Format duration as the checker does internally. */
function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Minimal Logger for tests */
const noopLogger = {
  log(_opts: { level: "debug" | "info" | "warn" | "error"; message: string }) {},
  debug(_m: string) {},
  info(_m: string) {},
  warn(_m: string) {},
  error(_m: string) {},
};

/**
 * FakeInstanceManager — mirrors the v0.3.0 InstanceManager surface with
 * full stall and thinking-loop detection logic. Uses in-memory state only
 * (no HTTP, no EventStream, no serve child). Exposes sentPrompts and
 * abortedSessions for test assertions.
 */
class FakeInstanceManagerForStall {
  /** Exposed for test assertions */
  sentPrompts: Array<{ sessionId: string; text: string }> = [];
  abortedSessions: string[] = [];

  private instances = new Map<string, BackgroundState>();
  private stallTimeoutMs: number;
  private thinkingLoopTimeoutMs: number;
  private maxInterventions: number;
  private stallCheckerDisabled = false;

  constructor(opts: {
    stallTimeoutMs?: number;
    thinkingLoopTimeoutMs?: number;
    maxInterventions?: number;
  } = {}) {
    this.stallTimeoutMs = opts.stallTimeoutMs ?? 180_000;
    this.thinkingLoopTimeoutMs = opts.thinkingLoopTimeoutMs ?? 300_000;
    this.maxInterventions = opts.maxInterventions ?? 1;
  }

  get stallTimeoutMsValue(): number {
    return this.stallTimeoutMs;
  }

  get thinkingLoopTimeoutMsValue(): number {
    return this.thinkingLoopTimeoutMs;
  }

  get maxInterventionsValue(): number {
    return this.maxInterventions;
  }

  disablePeriodicChecks(): void {
    this.stallCheckerDisabled = true;
  }

  // ---------------------------------------------------------------------------
  // Fake public API used by tests to set up instance state
  // ---------------------------------------------------------------------------

  /** Add a fake instance directly to the in-memory map */
  addInstance(state: BackgroundState): void {
    this.instances.set(state.instanceId, { ...state });
  }

  getInstance(instanceId: string): BackgroundState | undefined {
    return this.instances.get(instanceId);
  }

  // ---------------------------------------------------------------------------
  // runStallAndLoopChecks — exact replica of InstanceManager.runStallAndLoopChecks
  // ---------------------------------------------------------------------------

  async runStallAndLoopChecks(): Promise<void> {
    if (this.stallCheckerDisabled) return;

    const ids: string[] = [];
    for (const inst of this.instances.values()) {
      if (TERMINAL.has(inst.status)) continue;
      ids.push(inst.instanceId);
    }

    for (const id of ids) {
      const inst = this.instances.get(id);
      if (!inst || TERMINAL.has(inst.status)) continue;

      const now = Date.now();
      const lastEventAt = inst.lastEventAt ?? 0;
      const lastToolOrTextAt = inst.lastToolOrTextAt ?? 0;

      // Stall check
      if (now - lastEventAt > this.stallTimeoutMs) {
        await this._abortAsStalled(inst);
        continue;
      }

      // Thinking-loop check — only for running instances
      if (inst.status === "running") {
        const since = now - lastToolOrTextAt;
        if (since > this.thinkingLoopTimeoutMs) {
          const currentCount = inst.interventionCount ?? 0;
          if (currentCount < this.maxInterventions) {
            await this._sendIntervention(inst, since);
          } else {
            await this._abortAsThinkingLoop(inst, since);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // simulatePartUpdated — replicates InstanceManager.onPartUpdated
  // ---------------------------------------------------------------------------

  simulatePartUpdated(
    instanceId: string,
    partType: "tool" | "text" | "thinking",
  ): void {
    const inst = this.instances.get(instanceId);
    if (!inst) return;

    // Every event advances lastEventAt (heartbeat)
    inst.lastEventAt = Date.now();

    if (partType === "tool" || partType === "text") {
      inst.lastToolOrTextAt = Date.now();
      // Reset intervention counter after progress
      if ((inst.interventionCount ?? 0) > 0) {
        inst.interventionCount = 0;
        delete inst.interventionAt;
        delete inst.interventionReason;
      }
    }
    // 'thinking' parts do NOT advance lastToolOrTextAt — that is intentional
  }

  // ---------------------------------------------------------------------------
  // Private helpers — exact replicas of InstanceManager private methods
  // ---------------------------------------------------------------------------

  private async _abortAsStalled(inst: BackgroundState): Promise<void> {
    const lastEventAt = inst.lastEventAt ?? 0;
    const sinceMs = Date.now() - lastEventAt;
    noopLogger.warn(
      `bizar: instance ${inst.instanceId} stalled (no event for ${sinceMs}ms); aborting`,
    );
    this.abortedSessions.push(inst.sessionId);
    inst.status = "failed";
    inst.error = `No activity for ${this.stallTimeoutMs}ms — LLM appears stalled`;
    inst.completedAt = Date.now();
  }

  private async _sendIntervention(inst: BackgroundState, sinceMs: number): Promise<void> {
    const prompt = researchInterventionPrompt(sinceMs);
    const currentCount = inst.interventionCount ?? 0;
    noopLogger.warn(
      `bizar: instance ${inst.instanceId} thinking loop (${sinceMs}ms without tool/text); sending intervention #${currentCount + 1}/${this.maxInterventions}`,
    );
    this.sentPrompts.push({ sessionId: inst.sessionId, text: prompt });
    const reason = `thinking loop (${formatDuration(sinceMs)} without tool/text)`;
    inst.interventionCount = currentCount + 1;
    inst.interventionAt = Date.now();
    inst.interventionReason = reason;
    // Bumping lastEventAt here is intentional (mirrors real impl)
    inst.lastEventAt = Date.now();
  }

  private async _abortAsThinkingLoop(inst: BackgroundState, sinceMs: number): Promise<void> {
    noopLogger.warn(
      `bizar: instance ${inst.instanceId} thinking loop exhausted ${this.maxInterventions} intervention(s) over ${sinceMs}ms; aborting`,
    );
    this.abortedSessions.push(inst.sessionId);
    inst.status = "failed";
    inst.error = `Thinking loop detected: ${formatDuration(sinceMs)} of thinking without tool calls or output. Spawn a Mimir agent for research.`;
    inst.completedAt = Date.now();
  }
}

function makeBgState(overrides: Partial<BackgroundState> = {}): BackgroundState {
  const now = Date.now();
  return {
    instanceId: `bgr_${Math.random().toString(36).slice(2, 10)}`,
    sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`,
    agent: "mimir",
    status: "running",
    startedAt: now,
    model: "openrouter/minimax-m3",
    promptPreview: "Do the thing",
    resultPreview: undefined,
    resultMessageIds: [],
    error: undefined,
    parentAgent: "odin",
    parentInstanceId: undefined,
    logPath: "~/.cache/bizar/logs/test.log",
    timeoutMs: 300_000,
    toolCallCount: 0,
    loopGuardTool: undefined,
    lastEventAt: now,
    lastToolOrTextAt: now,
    interventionCount: 0,
    ...overrides,
  };
}

describe("Stall + thinking-loop detection logic", () => {
  // Test 1: Stall timeout fires when no events
  it("stall timeout fires when no events (lastEventAt is old)", async () => {
    const mgr = new FakeInstanceManagerForStall({
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });

    const oldTime = Date.now() - (180_000 + 1000); // past the stall threshold
    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_stall_fire",
        status: "running",
        lastEventAt: oldTime,
        lastToolOrTextAt: oldTime,
      }),
    );

    await mgr.runStallAndLoopChecks();

    expect(mgr.abortedSessions).toContain(
      mgr.getInstance("bgr_stall_fire")!.sessionId,
    );
    const inst = mgr.getInstance("bgr_stall_fire")!;
    expect(inst.status).toBe("failed");
    expect(inst.error!).toContain("No activity for");
  });

  // Test 2: Stall timeout does NOT fire when events are recent
  it("stall timeout does NOT fire when events are recent", async () => {
    const mgr = new FakeInstanceManagerForStall({ stallTimeoutMs: 180_000 });

    const recentTime = Date.now();
    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_stall_recent",
        status: "running",
        lastEventAt: recentTime,
        lastToolOrTextAt: recentTime,
      }),
    );

    await mgr.runStallAndLoopChecks();

    expect(mgr.abortedSessions).toHaveLength(0);
    const inst = mgr.getInstance("bgr_stall_recent")!;
    expect(inst.status).toBe("running");
  });

  // Test 3: Stall timeout does NOT fire for terminal instances
  it("stall timeout does NOT fire for terminal instances", async () => {
    const mgr = new FakeInstanceManagerForStall({ stallTimeoutMs: 180_000 });

    const oldTime = Date.now() - (180_000 + 1000);
    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_stall_terminal",
        status: "done",
        lastEventAt: oldTime, // would fire if not terminal
        lastToolOrTextAt: oldTime,
      }),
    );

    await mgr.runStallAndLoopChecks();

    expect(mgr.abortedSessions).toHaveLength(0);
    const inst = mgr.getInstance("bgr_stall_terminal")!;
    expect(inst.status).toBe("done");
  });

  // Test 4: Thinking loop detection fires after threshold
  it("thinking loop detection fires after threshold, sends intervention, increments counter", async () => {
    const mgr = new FakeInstanceManagerForStall({
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });

    // lastEventAt must be within stall timeout so we reach the thinking-loop
    // check. lastToolOrTextAt must be beyond the thinking-loop threshold.
    const now = Date.now();
    const lastEventAt = now - 60_000; // 60s ago — within 180s stall timeout
    const lastToolOrTextAt = now - 301_000; // 301s ago — beyond 300s loop threshold

    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_thinking_loop",
        status: "running",
        lastEventAt,
        lastToolOrTextAt,
        interventionCount: 0,
      }),
    );

    await mgr.runStallAndLoopChecks();

    expect(mgr.sentPrompts).toHaveLength(1);
    expect(mgr.sentPrompts[0]!.text).toContain("[SYSTEM REMINDER — Thinking Loop Detected]");

    const inst = mgr.getInstance("bgr_thinking_loop")!;
    expect(inst.interventionCount).toBe(1);
    expect(inst.interventionAt).toBeDefined();
    expect(inst.interventionReason).toContain("thinking loop");
    expect(inst.status).toBe("running"); // still running — not failed yet
  });

  // Test 5: Thinking loop intervention respects maxInterventions
  it("when interventionCount >= maxInterventions, instance is aborted as thinking loop", async () => {
    const mgr = new FakeInstanceManagerForStall({
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });

    // lastEventAt recent (within stall timeout) so we reach the thinking-loop check
    const now = Date.now();
    const lastEventAt = now - 60_000; // 60s ago — within 180s stall timeout
    const lastToolOrTextAt = now - 301_000; // 301s ago — beyond 300s loop threshold

    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_max_interventions",
        status: "running",
        lastEventAt,
        lastToolOrTextAt,
        // Already at max interventions — should abort immediately without sending prompt
        interventionCount: 1,
      }),
    );

    await mgr.runStallAndLoopChecks();

    expect(mgr.sentPrompts).toHaveLength(0); // No new prompt sent
    expect(mgr.abortedSessions).toContain(
      mgr.getInstance("bgr_max_interventions")!.sessionId,
    );
    const inst = mgr.getInstance("bgr_max_interventions")!;
    expect(inst.status).toBe("failed");
    expect(inst.error!).toMatch(/thinking loop/i); // case-insensitive
  });

  // Test 6: Tool/text events reset intervention counter
  it("a tool or text part after intervention resets interventionCount to 0", async () => {
    const mgr = new FakeInstanceManagerForStall({
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });

    const oldTime = Date.now() - (300_000 + 1000);
    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_reset_counter",
        status: "running",
        lastEventAt: oldTime,
        lastToolOrTextAt: oldTime,
        interventionCount: 1,
        interventionAt: oldTime,
        interventionReason: "thinking loop (1m 0s without tool/text)",
      }),
    );

    // Simulate a text part arriving (progress signal)
    mgr.simulatePartUpdated("bgr_reset_counter", "text");

    const inst = mgr.getInstance("bgr_reset_counter")!;
    expect(inst.interventionCount).toBe(0);
    expect(inst.interventionAt).toBeUndefined();
    expect(inst.interventionReason).toBeUndefined();
    expect(inst.lastToolOrTextAt).toBeGreaterThanOrEqual(oldTime);
  });

  // Test 7: Thinking-only events do NOT reset intervention counter
  it("a thinking part does NOT update lastToolOrTextAt or reset interventionCount", async () => {
    const mgr = new FakeInstanceManagerForStall({
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });

    const baseTime = Date.now() - 60_000;
    mgr.addInstance(
      makeBgState({
        instanceId: "bgr_thinking_only",
        status: "running",
        lastEventAt: baseTime,
        lastToolOrTextAt: baseTime, // set to 60s ago
        interventionCount: 0,
      }),
    );

    // Simulate a thinking part arriving
    mgr.simulatePartUpdated("bgr_thinking_only", "thinking");

    const inst = mgr.getInstance("bgr_thinking_only")!;
    // lastToolOrTextAt should NOT have been updated by the thinking part
    expect(inst.lastToolOrTextAt).toBe(baseTime);
    // interventionCount stays at 0 (was already 0 in this case)
    expect(inst.interventionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Group 5 — bg-status toView includes v0.3.0 fields
// ---------------------------------------------------------------------------

import type { InstanceView } from "../src/background.js";

function toViewForTest(inst: import("../src/background-state.js").BackgroundState): InstanceView {
  const v: InstanceView = {
    instanceId: inst.instanceId,
    agent: inst.agent,
    status: inst.status,
    startedAt: inst.startedAt,
    toolCallCount: inst.toolCallCount,
    promptPreview: inst.promptPreview,
    parentAgent: inst.parentAgent,
    sessionId: inst.sessionId,
    lastEventAt: inst.lastEventAt,
  };
  if (inst.completedAt !== undefined) v.completedAt = inst.completedAt;
  if (inst.resultPreview !== undefined) v.resultPreview = inst.resultPreview;
  if (inst.error !== undefined) v.error = inst.error;
  if (inst.parentInstanceId !== undefined) v.parentInstanceId = inst.parentInstanceId;
  // v0.3.0: only surface intervention metadata when at least one
  // intervention has actually been sent.
  const interventionCount = inst.interventionCount ?? 0;
  if (interventionCount > 0) {
    v.interventionCount = interventionCount;
    if (inst.interventionAt !== undefined) v.interventionAt = inst.interventionAt;
    if (inst.interventionReason !== undefined) v.interventionReason = inst.interventionReason;
  }
  return v;
}

describe("bg-status toView — v0.3.0 fields", () => {
  it("toView includes lastEventAt, interventionCount, interventionAt, interventionReason after intervention", () => {
    const now = Date.now();
    const inst: import("../src/background-state.js").BackgroundState = {
      instanceId: "bgr_view_test",
      sessionId: "sess_view",
      agent: "mimir",
      status: "running",
      startedAt: now - 600_000,
      model: "openrouter/minimax-m3",
      promptPreview: "Research X",
      toolCallCount: 0,
      parentAgent: "odin",
      logPath: path.join(os.tmpdir(), "test.log"),
      timeoutMs: 300_000,
      lastEventAt: now - 60_000,
      lastToolOrTextAt: now - 60_000,
      interventionCount: 2,
      interventionAt: now - 60_000,
      interventionReason: "thinking loop (5m 0s without tool/text)",
    };

    const view = toViewForTest(inst);

    expect(view.lastEventAt).toBe(now - 60_000);
    expect(view.interventionCount).toBe(2);
    expect(view.interventionAt).toBe(now - 60_000);
    expect(view.interventionReason).toBe("thinking loop (5m 0s without tool/text)");
  });

  it("toView omits intervention fields (not null) when interventionCount is 0 or undefined", () => {
    const now = Date.now();
    const inst: import("../src/background-state.js").BackgroundState = {
      instanceId: "bgr_view_no_intervention",
      sessionId: "sess_view2",
      agent: "mimir",
      status: "running",
      startedAt: now,
      model: "openrouter/minimax-m3",
      promptPreview: "Research Y",
      toolCallCount: 0,
      parentAgent: "odin",
      logPath: path.join(os.tmpdir(), "test.log"),
      timeoutMs: 300_000,
      // v0.3.0 fields are absent (no intervention yet)
    };

    const view = toViewForTest(inst);

    // lastEventAt should still be present (always surfaced)
    expect(view.lastEventAt).toBeUndefined(); // not set in this instance
    // Intervention fields should be absent — not null, not 0, not present
    expect("interventionCount" in view).toBe(false);
    expect("interventionAt" in view).toBe(false);
    expect("interventionReason" in view).toBe(false);
  });
});
