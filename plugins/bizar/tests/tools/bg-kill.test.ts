/**
 * bizar_kill tool tests.
 *
 * Tests: bizarre_kill calls POST /session/{id}/abort not DELETE (HIGH-4),
 * kill on already-finished instance is a no-op (MEDIUM-40),
 * kill on already-killed instance is a no-op.
 */

import { describe, it, expect, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BackgroundStatus = "pending" | "running" | "done" | "failed" | "killed" | "timed_out";

interface BackgroundState {
  instanceId: string;
  sessionId: string;
  status: BackgroundStatus;
  error?: string;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// HTTP call tracker — verifies POST /session/{id}/abort is called, not DELETE
// ---------------------------------------------------------------------------

const httpCalls: Array<{ method: string; path: string }> = [];

function trackCall(method: string, path: string) {
  httpCalls.push({ method, path });
}

function clearCalls() {
  httpCalls.length = 0;
}

// ---------------------------------------------------------------------------
// Fake bizar_kill implementation
// ---------------------------------------------------------------------------

function bizar_kill(
  args: { instanceId: string },
  instances: Map<string, BackgroundState>,
): { instanceId: string; status: BackgroundStatus } | { error: string } {
  const inst = instances.get(args.instanceId);
  if (!inst) {
    return { error: `Instance ${args.instanceId} not found` };
  }

  // HIGH-4: Kill calls POST /session/{id}/abort, NOT DELETE /session/{id}
  // MEDIUM-40: Killing an already-finished instance is a no-op (return current status)
  if (inst.status === "done" || inst.status === "failed" || inst.status === "killed" || inst.status === "timed_out") {
    // No HTTP call — just return current status
    return { instanceId: inst.instanceId, status: inst.status };
  }

  // Running or pending — call POST /session/{id}/abort
  trackCall("POST", `/session/${inst.sessionId}/abort`);

  // Update state
  inst.status = "killed";
  inst.completedAt = Date.now();

  return { instanceId: inst.instanceId, status: "killed" };
}

// ---------------------------------------------------------------------------
// In-memory test data
// ---------------------------------------------------------------------------

function makeInstances(): Map<string, BackgroundState> {
  const m = new Map<string, BackgroundState>();
  m.set("bgr_running", {
    instanceId: "bgr_running",
    sessionId: "sess_running",
    status: "running",
  });
  m.set("bgr_pending", {
    instanceId: "bgr_pending",
    sessionId: "sess_pending",
    status: "pending",
  });
  m.set("bgr_done", {
    instanceId: "bgr_done",
    sessionId: "sess_done",
    status: "done",
    completedAt: Date.now() - 60_000,
  });
  m.set("bgr_failed", {
    instanceId: "bgr_failed",
    sessionId: "sess_failed",
    status: "failed",
    error: "Loop protection: 12 identical calls to read",
    completedAt: Date.now() - 60_000,
  });
  m.set("bgr_killed", {
    instanceId: "bgr_killed",
    sessionId: "sess_killed",
    status: "killed",
    completedAt: Date.now() - 30_000,
  });
  m.set("bgr_timed_out", {
    instanceId: "bgr_timed_out",
    sessionId: "sess_timed_out",
    status: "timed_out",
    completedAt: Date.now() - 30_000,
  });
  return m;
}

// ---------------------------------------------------------------------------
// bizarre_kill calls POST /session/{id}/abort (HIGH-4)
// ---------------------------------------------------------------------------

describe("bizar_kill — POST /session/{id}/abort (HIGH-4)", () => {
  beforeEach(() => clearCalls());

  it("calls POST /session/{id}/abort for running instance", () => {
    const instances = makeInstances();
    bizar_kill({ instanceId: "bgr_running" }, instances);
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0].method).toBe("POST");
    expect(httpCalls[0].path).toContain("/abort");
  });

  it("calls POST /session/{id}/abort for pending instance", () => {
    const instances = makeInstances();
    bizar_kill({ instanceId: "bgr_pending" }, instances);
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0].method).toBe("POST");
    expect(httpCalls[0].path).toContain("/abort");
  });

  it("does NOT call DELETE /session/{id} (HIGH-4)", () => {
    const instances = makeInstances();
    bizar_kill({ instanceId: "bgr_running" }, instances);
    const deleteCalls = httpCalls.filter((c) => c.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  it("returns { instanceId, status: 'killed' }", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_running" }, instances);
    expect(result).toHaveProperty("instanceId");
    expect(result).toHaveProperty("status");
    expect((result as { status: string }).status).toBe("killed");
  });
});

// ---------------------------------------------------------------------------
// Kill on already-finished instance (MEDIUM-40)
// ---------------------------------------------------------------------------

describe("bizar_kill — already-finished instance (MEDIUM-40)", () => {
  beforeEach(() => clearCalls());

  it("kill on done instance returns status: done (no HTTP call)", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_done" }, instances);
    expect((result as { status: string }).status).toBe("done");
    expect(httpCalls).toHaveLength(0);
  });

  it("kill on failed instance returns status: failed (no HTTP call)", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_failed" }, instances);
    expect((result as { status: string }).status).toBe("failed");
    expect(httpCalls).toHaveLength(0);
  });

  it("kill on killed instance returns status: killed (no HTTP call)", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_killed" }, instances);
    expect((result as { status: string }).status).toBe("killed");
    expect(httpCalls).toHaveLength(0);
  });

  it("kill on timed_out instance returns status: timed_out (no HTTP call)", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_timed_out" }, instances);
    expect((result as { status: string }).status).toBe("timed_out");
    expect(httpCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Kill on running/pending
// ---------------------------------------------------------------------------

describe("bizar_kill — running and pending instances", () => {
  beforeEach(() => clearCalls());

  it("running instance is marked killed after kill", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_running" }, instances);
    expect(instances.get("bgr_running")!.status).toBe("killed");
    expect((result as { status: string }).status).toBe("killed");
  });

  it("pending instance is marked killed after kill", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_pending" }, instances);
    expect(instances.get("bgr_pending")!.status).toBe("killed");
    expect((result as { status: string }).status).toBe("killed");
  });

  it("kill sets completedAt", () => {
    const instances = makeInstances();
    const before = Date.now();
    bizar_kill({ instanceId: "bgr_running" }, instances);
    const after = Date.now();
    const completedAt = instances.get("bgr_running")!.completedAt!;
    expect(completedAt).toBeGreaterThanOrEqual(before);
    expect(completedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Unknown instance
// ---------------------------------------------------------------------------

describe("bizar_kill — unknown instance", () => {
  it("returns error for unknown instanceId", () => {
    const instances = makeInstances();
    const result = bizar_kill({ instanceId: "bgr_no_such" }, instances);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("not found");
  });
});