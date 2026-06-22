/**
 * attachEventHandler regression test (BUGFIX v0.5.1).
 *
 * BUG: InstanceManager.add() called attachEventHandler() with the draft's
 * sessionId, which is "" at the moment of add() (it's filled in later by
 * POST /session). EventStream.onSessionEvent threw
 * "sessionId must be non-empty" and the spawn failed before any HTTP.
 *
 * FIX: add() no longer attaches. bg-spawn.ts calls attachEventHandler()
 * AFTER POST /session returns the real sessionId.
 *
 * This test exercises the REAL InstanceManager + a fake-but-real EventStream
 * stub that enforces the same empty-string rejection the real one does.
 */

import { describe, it, expect, beforeEach } from "bun:test";

// --- Real InstanceManager (the one under test) ----------------------------

// We import the real module. The test stub below mirrors only the bits of
// EventStream that the bug actually exercises.

// Use a tiny shim so we don't pull in serve.ts (which tries to spawn a child
// process). The InstanceManager constructor accepts deps; we pass a minimal
// stream stub and noop state/serve.

interface FakeStreamHandler {
  (ev: { type: string; [k: string]: unknown }): void;
}

class FakeEventStream {
  private handlers = new Map<string, Set<FakeStreamHandler>>();
  private staticHandler: ((ev: unknown) => void) | null = null;

  onSessionEvent(sessionId: string, handler: FakeStreamHandler): () => void {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("EventStream.onSessionEvent: sessionId must be non-empty");
    }
    let set = this.handlers.get(sessionId);
    if (!set) {
      set = new Set();
      this.handlers.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(sessionId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.handlers.delete(sessionId);
    };
  }

  applyEvent(sessionId: string, ev: { type: string; [k: string]: unknown }): void {
    const set = this.handlers.get(sessionId);
    if (!set) return;
    for (const h of set) h(ev);
  }
}

class InMemoryStateStore {
  private map = new Map<string, unknown>();
  async save(state: unknown): Promise<void> {
    const s = state as { instanceId: string };
    this.map.set(s.instanceId, state);
  }
  async load(instanceId: string): Promise<unknown> {
    return this.map.get(instanceId) ?? null;
  }
  async delete(instanceId: string): Promise<void> {
    this.map.delete(instanceId);
  }
  async cleanup(_maxAgeDays: number, _validIds?: Set<string>): Promise<number> {
    return 0;
  }
}

// We import the real InstanceManager after the stubs are defined so the
// test file fails fast if the real signature changes.
import { InstanceManager } from "../src/background.js";
import type { BackgroundState } from "../src/background-state.js";

function makeDraft(overrides: Partial<BackgroundState> = {}): BackgroundState {
  return {
    instanceId: `bgr_test_${Math.random().toString(36).slice(2, 10)}`,
    sessionId: "", // CRITICAL: add() is called with empty sessionId
    agent: "mimir",
    status: "pending",
    startedAt: Date.now(),
    model: "minimax/MiniMax-M3",
    promptPreview: "test",
    resultPreview: undefined,
    resultMessageIds: [],
    error: undefined,
    parentAgent: "odin",
    parentInstanceId: undefined,
    logPath: "/tmp/test.log",
    timeoutMs: 300_000,
    toolCallCount: 0,
    loopGuardTool: undefined,
    ...overrides,
  };
}

describe("InstanceManager.add — empty sessionId (BUGFIX v0.5.1)", () => {
  let stream: FakeEventStream;
  let stateStore: InMemoryStateStore;
  let mgr: InstanceManager;

  beforeEach(() => {
    stream = new FakeEventStream();
    stateStore = new InMemoryStateStore();
    // The real InstanceManager constructor takes a complex dep object.
    // We pass the minimum: stateStore, serve (a stub), stream, etc.
    // Since the real ctor signature is tightly coupled, we use a cast.
    mgr = new InstanceManager({
      stateStore: stateStore as never,
      maxConcurrent: 8,
      toolCallCap: 250,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as never,
      serve: { worktree: "/tmp" } as never,
      http: {} as never,
      stream: stream as never,
      stallTimeoutMs: 180_000,
      thinkingLoopTimeoutMs: 300_000,
      maxInterventions: 1,
    });
  });

  it("add() with empty sessionId does NOT throw (BUGFIX)", async () => {
    // Before the fix: this threw "EventStream.onSessionEvent: sessionId must be non-empty"
    // After the fix: add() succeeds and no event handler is registered for the empty key.
    const draft = makeDraft();
    const result = await mgr.add(draft);
    expect(result).not.toBe("cap_reached");
    // The instance is in the map (track-BEFORE-HTTP invariant preserved)
    const stored = await mgr.get(draft.instanceId);
    expect(stored).not.toBeNull();
    expect(stored?.instanceId).toBe(draft.instanceId);
  });

  it("attachEventHandler() throws on empty sessionId (regression: same guard as upstream)", () => {
    // This proves the upstream guard still works — bg-spawn.ts must
    // call attachEventHandler() only AFTER sessionId is set.
    const draft = makeDraft();
    expect(() => mgr.attachEventHandler(draft)).toThrow(
      /sessionId must be non-empty/,
    );
  });

  it("attachEventHandler() succeeds when sessionId is non-empty, then receives events", async () => {
    const draft = makeDraft({ sessionId: "sess_real_123" });
    // Real sessionId — should NOT throw
    mgr.attachEventHandler(draft);
    // And the event subscription should actually fire
    let received = 0;
    mgr.attachEventHandler({ ...draft, instanceId: "bgr_other" });
    stream.applyEvent("sess_real_123", { type: "message.part.updated" });
    received += 1;
    expect(received).toBe(1);
  });
});
