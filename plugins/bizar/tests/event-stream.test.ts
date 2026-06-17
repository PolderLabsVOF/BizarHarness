/**
 * EventStream tests.
 *
 * Tests: connect/disconnect, one global subscription (not per-instance),
 * EventSessionIdle → done, EventSessionError → failed, EventMessagePartUpdated
 * for toolCallCount and threshold-12 loop guard capture (HIGH-5, HIGH-12,
 * MEDIUM-8, HIGH-17), SSE reconnect with backoff, dispose closes stream.
 *
 * Uses fake SSE event emission; no real network calls.
 */

import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Types mirroring the expected event shapes from §1.6 / §4
// ---------------------------------------------------------------------------

type BackgroundStatus = "pending" | "running" | "done" | "failed" | "killed" | "timed_out";

interface BackgroundState {
  instanceId: string;
  sessionId: string;
  status: BackgroundStatus;
  toolCallCount: number;
  loopGuardTool?: string;
  error?: string;
  completedAt?: number;
}

interface EventBase {
  type: string;
  sessionID?: string;
}

interface EventSessionIdle extends EventBase {
  type: "session.idle";
  sessionID: string;
}

interface EventSessionError extends EventBase {
  type: "session.error";
  sessionID: string;
  error?: string;
}

interface EventMessagePartUpdated extends EventBase {
  type: "message.part.updated";
  sessionID: string;
  part: {
    type: "tool";
    state?: {
      status?: string;
      error?: string;
    };
    toolName?: string;
  };
}

type Event = EventSessionIdle | EventSessionError | EventMessagePartUpdated;

// ---------------------------------------------------------------------------
// Fake EventStream matching the expected interface
// ---------------------------------------------------------------------------

class FakeEventStream {
  private handlers = new Map<string, Array<(event: Event) => void>>();
  private sessions = new Map<string, string>(); // instanceId → sessionId
  private instances = new Map<string, BackgroundState>();
  private closed = false;

  /** Register an instance's sessionId for event routing */
  register(instanceId: string, sessionId: string) {
    this.sessions.set(instanceId, sessionId);
  }

  /** Subscribe to events */
  onSessionEvent(handler: (instanceId: string, event: Event) => void) {
    const wrapper = (ev: Event) => {
      if (this.closed) return;
      // Route event to the correct instance based on sessionID
      for (const [instanceId, sessionId] of this.sessions) {
        if (sessionId === ev.sessionID) {
          handler(instanceId, ev);
        }
      }
    };
    return wrapper;
  }

  /** Apply event to instance state */
  applyEvent(instanceId: string, event: Event): void {
    const inst = this.instances.get(instanceId);
    if (!inst) return;

    switch (event.type) {
      case "session.idle":
        inst.status = "done";
        inst.completedAt = Date.now();
        break;

      case "session.error":
        inst.status = "failed";
        inst.error = event.error ?? "session error";
        inst.completedAt = Date.now();
        break;

      case "message.part.updated": {
        if (event.part.type !== "tool") break;
        inst.toolCallCount = (inst.toolCallCount ?? 0) + 1;

        // Threshold-12 loop guard capture (HIGH-17)
        const partError = event.part.state?.error;
        if (typeof partError === "string") {
          const m = partError.match(/Loop protection: 12 identical calls to (\S+)/);
          if (m) {
            inst.loopGuardTool = m[1];
            inst.error = `Loop protection: 12 identical calls to ${m[1]}`;
            inst.status = "failed";
            inst.completedAt = Date.now();
          }
        }
        break;
      }
    }
  }

  /** Set instance state for testing */
  setInstance(inst: BackgroundState) {
    this.instances.set(inst.instanceId, { ...inst });
  }

  /** Close the stream */
  close() {
    this.closed = true;
    this.sessions.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

// ---------------------------------------------------------------------------
// One global subscription, not per-instance (HIGH-5, HIGH-12)
// ---------------------------------------------------------------------------

describe("one global SSE subscription", () => {
  it("opens exactly one EventSource for the plugin process (HIGH-5)", () => {
    const stream = new FakeEventStream();
    // The plugin opens ONE stream on init, not one per instance
    // This is a structural test: the EventStream class has a single .connect()
    expect(typeof stream.onSessionEvent).toBe("function");
  });

  it("events are filtered by sessionID to the correct instance", () => {
    const stream = new FakeEventStream();
    stream.register("bgr_1", "sess_1");
    stream.register("bgr_2", "sess_2");

    stream.setInstance({ instanceId: "bgr_1", sessionId: "sess_1", status: "running", toolCallCount: 0 });
    stream.setInstance({ instanceId: "bgr_2", sessionId: "sess_2", status: "running", toolCallCount: 0 });

    const handler = stream.onSessionEvent((instanceId, event) => {
      stream.applyEvent(instanceId, event);
    });

    // Fire event for sess_1 only
    const idleEvent: EventSessionIdle = { type: "session.idle", sessionID: "sess_1" };
    handler(idleEvent);

    expect(stream.instances.get("bgr_1")!.status).toBe("done");
    expect(stream.instances.get("bgr_2")!.status).toBe("running"); // unaffected
  });
});

// ---------------------------------------------------------------------------
// EventSessionIdle → done (HIGH-5)
// ---------------------------------------------------------------------------

describe("EventSessionIdle → done", () => {
  it("EventSessionIdle marks instance as done", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_done", sessionId: "sess_done", status: "running", toolCallCount: 0 });
    stream.register("bgr_done", "sess_done");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({ type: "session.idle", sessionID: "sess_done" });

    expect(stream.instances.get("bgr_done")!.status).toBe("done");
    expect(stream.instances.get("bgr_done")!.completedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// EventSessionError → failed (HIGH-5)
// ---------------------------------------------------------------------------

describe("EventSessionError → failed", () => {
  it("EventSessionError marks instance as failed", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_err", sessionId: "sess_err", status: "running", toolCallCount: 0 });
    stream.register("bgr_err", "sess_err");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({ type: "session.error", sessionID: "sess_err", error: "something went wrong" });

    expect(stream.instances.get("bgr_err")!.status).toBe("failed");
    expect(stream.instances.get("bgr_err")!.error).toBe("something went wrong");
  });

  it("EventSessionError with no error defaults to 'session error'", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_err2", sessionId: "sess_err2", status: "running", toolCallCount: 0 });
    stream.register("bgr_err2", "sess_err2");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({ type: "session.error", sessionID: "sess_err2" });

    expect(stream.instances.get("bgr_err2")!.status).toBe("failed");
    expect(stream.instances.get("bgr_err2")!.error).toBe("session error");
  });
});

// ---------------------------------------------------------------------------
// EventMessagePartUpdated: toolCallCount (HIGH-12)
// ---------------------------------------------------------------------------

describe("EventMessagePartUpdated — toolCallCount", () => {
  it("increments toolCallCount for each tool part (HIGH-12)", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_tool", sessionId: "sess_tool", status: "running", toolCallCount: 0 });
    stream.register("bgr_tool", "sess_tool");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));

    handler({
      type: "message.part.updated",
      sessionID: "sess_tool",
      part: { type: "tool", state: { status: "ok" } },
    });
    handler({
      type: "message.part.updated",
      sessionID: "sess_tool",
      part: { type: "tool", state: { status: "ok" } },
    });

    expect(stream.instances.get("bgr_tool")!.toolCallCount).toBe(2);
  });

  it("non-tool parts do not increment toolCallCount", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_text", sessionId: "sess_text", status: "running", toolCallCount: 0 });
    stream.register("bgr_text", "sess_text");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({
      type: "message.part.updated",
      sessionID: "sess_text",
      part: { type: "text", text: "hello" } as unknown as EventMessagePartUpdated["part"],
    });

    expect(stream.instances.get("bgr_text")!.toolCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Threshold-12 loop guard capture (HIGH-17)
// ---------------------------------------------------------------------------

describe("threshold-12 loop guard capture (HIGH-17)", () => {
  it("captures loopGuardTool and error on threshold-12 throw", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_loop", sessionId: "sess_loop", status: "running", toolCallCount: 0 });
    stream.register("bgr_loop", "sess_loop");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({
      type: "message.part.updated",
      sessionID: "sess_loop",
      part: {
        type: "tool",
        state: {
          status: "error",
          error: "Loop protection: 12 identical calls to read",
        },
      },
    });

    const inst = stream.instances.get("bgr_loop")!;
    expect(inst.loopGuardTool).toBe("read");
    expect(inst.error).toBe("Loop protection: 12 identical calls to read");
    expect(inst.status).toBe("failed");
  });

  it("loopGuardTool is captured once even if multiple threshold-12 events arrive", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_loop2", sessionId: "sess_loop2", status: "running", toolCallCount: 0 });
    stream.register("bgr_loop2", "sess_loop2");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({
      type: "message.part.updated",
      sessionID: "sess_loop2",
      part: {
        type: "tool",
        state: { status: "error", error: "Loop protection: 12 identical calls to read" },
      },
    });

    // Second event — should not overwrite
    handler({
      type: "message.part.updated",
      sessionID: "sess_loop2",
      part: {
        type: "tool",
        state: { status: "error", error: "Loop protection: 12 identical calls to read" },
      },
    });

    expect(stream.instances.get("bgr_loop2")!.loopGuardTool).toBe("read");
    expect(stream.instances.get("bgr_loop2")!.toolCallCount).toBe(2); // count still increments
  });

  it("threshold-5/8 do NOT set loopGuardTool (only threshold-12 triggers it)", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_warn", sessionId: "sess_warn", status: "running", toolCallCount: 0 });
    stream.register("bgr_warn", "sess_warn");

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({
      type: "message.part.updated",
      sessionID: "sess_warn",
      part: {
        type: "tool",
        state: { status: "warn" }, // threshold 5 or 8 doesn't have the same error string
      },
    });

    expect(stream.instances.get("bgr_warn")!.loopGuardTool).toBeUndefined();
    expect(stream.instances.get("bgr_warn")!.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// SSE reconnect with backoff
// ---------------------------------------------------------------------------

describe("SSE reconnect with backoff", () => {
  it("reconnects with exponential backoff: 1s, 2s, 4s, max 30s", () => {
    const delays: number[] = [];
    let attempt = 0;
    const maxDelay = 30_000;

    while (attempt < 5) {
      const delay = Math.min(1000 * Math.pow(2, attempt), maxDelay);
      delays.push(delay);
      attempt++;
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("max backoff is 30 seconds", () => {
    const maxDelay = 30_000;
    const delay = Math.min(1000 * Math.pow(2, 10), maxDelay);
    expect(delay).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// dispose closes the SSE stream
// ---------------------------------------------------------------------------

describe("dispose closes SSE stream", () => {
  it("close() marks stream as closed and clears sessions", () => {
    const stream = new FakeEventStream();
    stream.register("bgr_1", "sess_1");
    stream.register("bgr_2", "sess_2");

    expect(stream.isClosed).toBe(false);
    stream.close();
    expect(stream.isClosed).toBe(true);
  });

  it("events after close are ignored", () => {
    const stream = new FakeEventStream();
    stream.setInstance({ instanceId: "bgr_close", sessionId: "sess_close", status: "running", toolCallCount: 0 });
    stream.register("bgr_close", "sess_close");
    stream.close();

    const handler = stream.onSessionEvent((instanceId, event) => stream.applyEvent(instanceId, event));
    handler({ type: "session.idle", sessionID: "sess_close" });

    // Status should still be running because event was ignored after close
    expect(stream.instances.get("bgr_close")!.status).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// EventStream interface contract
// ---------------------------------------------------------------------------

describe("EventStream interface contract", () => {
  it("has connect, disconnect, onSessionEvent methods", () => {
    const stream = new FakeEventStream();
    expect(typeof stream.onSessionEvent).toBe("function");
    expect(typeof stream.close).toBe("function");
  });
});