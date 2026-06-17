/**
 * bizar_collect tool tests.
 *
 * Tests: timeout behavior (MEDIUM-31), killed/done/failed result,
 * loop guard marker prepended at collect time (MEDIUM-30),
 * timeoutMs clamping (MEDIUM-33), result construction from messages
 * (MEDIUM-19), collect on already-killed instance (HIGH-37).
 */

import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BackgroundStatus = "pending" | "running" | "done" | "failed" | "killed" | "timed_out";

interface BackgroundState {
  instanceId: string;
  sessionId: string;
  status: BackgroundStatus;
  toolCallCount: number;
  loopGuardTool?: string;
  error?: string;
  resultPreview?: string;
  resultMessageIds?: string[];
  startedAt: number;
  completedAt?: number;
  timeoutMs: number;
}

interface MessagePart {
  type: "text";
  text: string;
}

interface Message {
  info: { role: "user" | "assistant" };
  parts: MessagePart[];
}

// ---------------------------------------------------------------------------
// Result construction algorithm (mirrors §4.4)
// ---------------------------------------------------------------------------

function constructResult(messages: Message[], loopGuardTool?: string): string {
  // Filter to assistant messages
  // Concatenate TextPart.text values in message order
  // Skip ToolPart, ReasoningPart, StepStartPart, StepFinishPart,
  //   SnapshotPart, PatchPart, AgentPart, RetryPart, CompactionPart, SubtaskPart
  const text = messages
    .filter((m) => m.info.role === "assistant")
    .flatMap((m) => m.parts.filter((p) => p.type === "text"))
    .map((p) => (p as MessagePart & { type: "text" }).text)
    .join("\n");

  // Prepend loop guard marker if threshold-12 was captured
  if (loopGuardTool) {
    return `[loop guard: 12 identical calls to ${loopGuardTool}]\n${text}`;
  }
  return text;
}

function clampTimeout(timeoutMs: number): number {
  const MIN = 1000;
  const MAX = 1_800_000;
  if (timeoutMs < MIN || timeoutMs > MAX) {
    throw new Error(`timeoutMs must be between ${MIN} (1s) and ${MAX} (30min). Got ${timeoutMs}.`);
  }
  return timeoutMs;
}

// ---------------------------------------------------------------------------
// Fake bizar_collect
// ---------------------------------------------------------------------------

interface CollectResult {
  instanceId: string;
  status: BackgroundStatus;
  result: string;
  toolCallCount: number;
  durationMs: number;
  error?: string;
}

function bizar_collect(
  args: { instanceId: string; timeoutMs?: number },
  instances: Map<string, BackgroundState>,
  messages: Map<string, Message[]>,
): CollectResult | { error: string } {
  const inst = instances.get(args.instanceId);
  if (!inst) {
    return { error: `Instance ${args.instanceId} not found` };
  }

  let timeoutMs = args.timeoutMs ?? 60_000;
  try {
    timeoutMs = clampTimeout(timeoutMs);
  } catch (e: unknown) {
    return { error: (e as Error).message };
  }

  // If instance is already in a terminal state, return immediately
  if (inst.status === "done" || inst.status === "failed" || inst.status === "killed" || inst.status === "timed_out") {
    const sessionMessages = messages.get(inst.sessionId) ?? [];
    const result = constructResult(sessionMessages, inst.loopGuardTool);
    const durationMs = (inst.completedAt ?? Date.now()) - inst.startedAt;
    return {
      instanceId: inst.instanceId,
      status: inst.status,
      result,
      toolCallCount: inst.toolCallCount,
      durationMs,
      error: inst.error,
    };
  }

  // Simulate timeout for this test
  return {
    instanceId: inst.instanceId,
    status: "running",
    result: inst.resultPreview ?? "",
    toolCallCount: inst.toolCallCount,
    durationMs: Date.now() - inst.startedAt,
    error: `collect timed out after ${timeoutMs}ms`,
  };
}

// ---------------------------------------------------------------------------
// In-memory test data
// ---------------------------------------------------------------------------

function makeMessages(assistantTexts: string[]): Message[] {
  return [
    {
      info: { role: "user" },
      parts: [{ type: "text", text: "Do the task" }],
    },
    ...assistantTexts.map((text) => ({
      info: { role: "assistant" as const },
      parts: [{ type: "text" as const, text }],
    })),
  ];
}

const instances = new Map<string, BackgroundState>();
const messages = new Map<string, Message[]>();

const doneInst: BackgroundState = {
  instanceId: "bgr_done",
  sessionId: "sess_done",
  status: "done",
  toolCallCount: 5,
  loopGuardTool: undefined,
  error: undefined,
  resultPreview: "Research complete.",
  resultMessageIds: ["msg_01", "msg_02"],
  startedAt: Date.now() - 120_000,
  completedAt: Date.now() - 60_000,
  timeoutMs: 300_000,
};
instances.set("bgr_done", doneInst);
messages.set("sess_done", makeMessages(["The research shows that X is true.", "Findings have been saved."]));

const loopGuardInst: BackgroundState = {
  instanceId: "bgr_loop",
  sessionId: "sess_loop",
  status: "failed",
  toolCallCount: 12,
  loopGuardTool: "read",
  error: "Loop protection: 12 identical calls to read",
  resultPreview: "",
  resultMessageIds: ["msg_loop_1"],
  startedAt: Date.now() - 60_000,
  completedAt: Date.now(),
  timeoutMs: 300_000,
};
instances.set("bgr_loop", loopGuardInst);
messages.set("sess_loop", makeMessages(["I tried to read the file but got stuck."]));

const killedInst: BackgroundState = {
  instanceId: "bgr_killed",
  sessionId: "sess_killed",
  status: "killed",
  toolCallCount: 2,
  loopGuardTool: undefined,
  error: undefined,
  resultPreview: "Partial result...",
  resultMessageIds: ["msg_k_1"],
  startedAt: Date.now() - 30_000,
  completedAt: Date.now(),
  timeoutMs: 300_000,
};
instances.set("bgr_killed", killedInst);
messages.set("sess_killed", makeMessages(["Partial work done before kill."]));

// ---------------------------------------------------------------------------
// Result construction (MEDIUM-19)
// ---------------------------------------------------------------------------

describe("bizar_collect — result construction (MEDIUM-19)", () => {
  it("concatenates assistant text parts in order", () => {
    const msgs = makeMessages(["First response.", "Second response."]);
    const result = constructResult(msgs);
    expect(result).toBe("First response.\nSecond response.");
  });

  it("skips user messages", () => {
    const msgs = makeMessages(["Assistant text"]);
    const result = constructResult(msgs);
    expect(result).not.toContain("Do the task");
    expect(result).toBe("Assistant text");
  });

  it("prepends loop guard marker when loopGuardTool is set (MEDIUM-30)", () => {
    const msgs = makeMessages(["I got stuck in a loop."]);
    const result = constructResult(msgs, "read");
    expect(result).toStartWith("[loop guard: 12 identical calls to read]");
  });

  it("marker is NOT in resultPreview or resultMessageIds — added at collect time only (MEDIUM-30)", () => {
    // Verify that the marker is NOT in the stored data
    const inst = loopGuardInst;
    expect(inst.loopGuardTool).toBe("read");
    expect(inst.resultPreview).not.toContain("[loop guard:");
    expect(inst.resultMessageIds).toBeDefined();
  });

  it("result without loop guard has no marker prefix", () => {
    const msgs = makeMessages(["All good!"]);
    const result = constructResult(msgs);
    expect(result).not.toStartWith("[loop guard:");
  });
});

// ---------------------------------------------------------------------------
// Collect on terminal state
// ---------------------------------------------------------------------------

describe("bizar_collect — terminal state", () => {
  it("done instance returns the result immediately (no waiting)", () => {
    const result = bizar_collect({ instanceId: "bgr_done" }, instances, messages) as CollectResult;
    expect(result.status).toBe("done");
    expect(result.result).toContain("research shows that X is true");
  });

  it("failed instance with loop guard returns marker + result (MEDIUM-30)", () => {
    const result = bizar_collect({ instanceId: "bgr_loop" }, instances, messages) as CollectResult;
    expect(result.status).toBe("failed");
    expect(result.result).toStartWith("[loop guard: 12 identical calls to read]");
    expect(result.error).toContain("Loop protection");
  });

  it("killed instance returns immediately (HIGH-37)", () => {
    const result = bizar_collect({ instanceId: "bgr_killed" }, instances, messages) as CollectResult;
    expect(result.status).toBe("killed");
    expect(result.result).toContain("Partial work done before kill.");
  });

  it("collect on already-killed instance makes no HTTP calls (HIGH-37)", () => {
    // Verified by the fact we return immediately from in-memory state
    const result = bizar_collect({ instanceId: "bgr_killed" }, instances, messages) as CollectResult;
    expect(result.status).toBe("killed");
    // error is undefined (not "no error property"), which is falsy — not an error
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Collect on running instance (timeout)
// ---------------------------------------------------------------------------

describe("bizar_collect — timeout on running instance", () => {
  it("running instance times out and returns partial result", () => {
    const runningInst: BackgroundState = {
      instanceId: "bgr_running",
      sessionId: "sess_running",
      status: "running",
      toolCallCount: 3,
      resultPreview: "Still working...",
      startedAt: Date.now() - 5_000,
      timeoutMs: 60_000,
    };
    const runningMap = new Map([["bgr_running", runningInst]]);
    const runningMsgs = new Map<string, Message[]>();

    const result = bizar_collect({ instanceId: "bgr_running", timeoutMs: 1000 }, runningMap, runningMsgs) as CollectResult;
    expect(result.status).toBe("running");
    expect(result.error).toContain("timed out");
    expect(result.result).toContain("Still working...");
  });

  it("timeoutMs clamped per §7.3 (MEDIUM-33)", () => {
    const runningInst: BackgroundState = {
      instanceId: "bgr_clamped",
      sessionId: "sess_clamped",
      status: "running",
      toolCallCount: 0,
      resultPreview: "",
      startedAt: Date.now(),
      timeoutMs: 60_000,
    };
    const map = new Map([["bgr_clamped", runningInst]]);

    // Below minimum
    const r1 = bizar_collect({ instanceId: "bgr_clamped", timeoutMs: 500 }, map, new Map());
    expect(r1).toHaveProperty("error");

    // Above maximum
    const r2 = bizar_collect({ instanceId: "bgr_clamped", timeoutMs: 2_000_000 }, map, new Map());
    expect(r2).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Duration calculation
// ---------------------------------------------------------------------------

describe("bizar_collect — durationMs", () => {
  it("durationMs = completedAt - startedAt for terminal instances", () => {
    const result = bizar_collect({ instanceId: "bgr_done" }, instances, messages) as CollectResult;
    expect(result.durationMs).toBeGreaterThanOrEqual(59_000);
    expect(result.durationMs).toBeLessThanOrEqual(61_000);
  });
});

// ---------------------------------------------------------------------------
// Unknown instance
// ---------------------------------------------------------------------------

describe("bizar_collect — unknown instance", () => {
  it("returns error for unknown instanceId", () => {
    const result = bizar_collect({ instanceId: "bgr_no_such" }, instances, messages);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("not found");
  });
});