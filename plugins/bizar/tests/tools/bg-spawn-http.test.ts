/**
 * bg-spawn-http.test.ts
 *
 * v5.5.1 — Tests that `bizar_spawn_background` delegates to the dashboard
 * via `POST /api/background` (instead of spawning `cline run`
 * subprocesses directly). The dashboard POST is mocked so we don't need
 * a live server.
 *
 * The "input-validation" surface (Odin-only check, model parsing,
 * timeoutMs clamping, delegation wrapper) is already covered by the
 * pre-existing bg-spawn.test.ts and bg-spawn-delegation.test.ts. This
 * test focuses on the NEW path: HTTP delegation.
 */

import { describe, it, expect } from "bun:test";

import {
  createBgSpawnTool,
  PRIMARY_AGENTS,
  buildDelegationPrompt,
  needsDelegationWrapper,
} from "../../src/tools/bg-spawn";

import type { Logger } from "../../src/logger";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  log() {},
};

function decode(result: unknown): any {
  // Cline SDK port (Phase 2): the tool now returns structured objects
  // directly instead of `{ output: JSON.stringify(...) }`. The agent
  // runtime wraps the returned value in AgentToolResult, but
  // `tool.execute()` (called directly in tests) hands the structured
  // object back as-is.
  if (typeof result === "string") return JSON.parse(result);
  if (result && typeof result === "object" && "output" in result) {
    const out = (result as { output: unknown }).output;
    if (typeof out === "string") return JSON.parse(out);
    return out;
  }
  return result;
}

/** Capture the dashboard POST so the test can assert its shape. */
function makeCapturingDashboard(returnValue: any) {
  const calls: Array<{ url: string; body: any }> = [];
  const post = async (
    url: string,
    init: { headers: Record<string, string>; body: string },
  ) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => returnValue,
    };
  };
  return { calls, post };
}

/** Minimal mock InstanceManager — just enough for add/get/update. */
function makeInstanceManager() {
  const instances = new Map<string, any>();
  return {
    add: async (draft: any) => {
      instances.set(draft.instanceId, { ...draft, status: "pending" });
      return { ...draft, status: "pending" };
    },
    get: async (id: string) => instances.get(id) ?? null,
    update: async (id: string, patch: any) => {
      const cur = instances.get(id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      instances.set(id, next);
    },
    _instances: instances,
  };
}

describe("bizar_spawn_background — HTTP delegation (v5.5.1)", () => {
  it("rejects non-Odin callers", async () => {
    const mgr = makeInstanceManager();
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp",
      logger: silentLogger,
    });
    const r = await tool.execute(
      { agent: "mimir", prompt: "hi" } as any,
      { metadata: { parentAgent: "frigg" } } as any,
    );
    expect(decode(r).error).toContain("Only Odin");
  });

  it("POSTs to /api/background on the dashboard with the right shape", async () => {
    const mgr = makeInstanceManager();
    const { calls, post } = makeCapturingDashboard({
      instanceId: "bgr_dash_xyz",
      sessionId: "ses_xyz",
      status: "running",
      liveSession: true,
    });
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp/worktree",
      logger: silentLogger,
      _dashboardPost: post,
    });
    const r = await tool.execute(
      {
        agent: "mimir",
        prompt: "research X",
        model: "minimax/minimax-m3",
        timeoutMs: 60_000,
      } as any,
      { metadata: { parentAgent: "odin" }, sessionID: "ses_parent" } as any,
    );
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toContain("/api/background");
    // URL should NOT include "/api/background/:id" — it's the create endpoint.
    expect(call.url).not.toMatch(/\/api\/background\/bgr_/);
    expect(call.body.agent).toBe("mimir");
    expect(call.body.worktree).toBe("/tmp/worktree");
    expect(call.body.timeoutMs).toBe(60_000);
    expect(call.body.model).toBe("minimax/minimax-m3");
    // For subagents, the prompt is the delegation wrapper.
    expect(call.body.prompt).toContain("Requested subagent: mimir");
    expect(call.body.prompt).toContain("research X");
    expect(call.body.tags).toContain("spawned-by:odin");
    const out = decode(r);
    expect(out.instanceId).toBeDefined();
    expect(out.dashboardInstanceId).toBe("bgr_dash_xyz");
    expect(out.sessionId).toBe("ses_xyz");
    expect(out.processId).toBeNull();
    expect(out.liveSession).toBe(true);
    expect(out.status).toBe("running");
  });

  it("does NOT wrap the prompt for primary agents", async () => {
    const mgr = makeInstanceManager();
    const { calls, post } = makeCapturingDashboard({
      instanceId: "bgr_odin_1",
      sessionId: "ses_1",
    });
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp",
      logger: silentLogger,
      _dashboardPost: post,
    });
    await tool.execute(
      { agent: "odin", prompt: "raw prompt here" } as any,
      { metadata: { parentAgent: "odin" }, sessionID: "ses_parent" } as any,
    );
    const call = calls[0]!;
    expect(call.body.agent).toBe("odin");
    expect(call.body.prompt).toBe("raw prompt here"); // no wrapper
  });

  it("returns a clear error when the dashboard POST fails", async () => {
    const mgr = makeInstanceManager();
    const post = async () => {
      throw new Error("ECONNREFUSED");
    };
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp",
      logger: silentLogger,
      _dashboardPost: post,
    });
    const r = await tool.execute(
      { agent: "mimir", prompt: "hi" } as any,
      { metadata: { parentAgent: "odin" }, sessionID: "ses_parent" } as any,
    );
    const out = decode(r);
    expect(out.error).toContain("ECONNREFUSED");
    expect(out.status).toBe("failed");
  });

  it("returns error for malformed model", async () => {
    const mgr = makeInstanceManager();
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp",
      logger: silentLogger,
    });
    const r = await tool.execute(
      { agent: "mimir", prompt: "hi", model: "no-slash" } as any,
      { metadata: { parentAgent: "odin" }, sessionID: "ses_parent" } as any,
    );
    expect(decode(r).error).toContain("providerID/modelID");
  });

  it("returns error for out-of-range timeoutMs", async () => {
    const mgr = makeInstanceManager();
    const tool = createBgSpawnTool({
      instanceManager: mgr as any,
      worktree: "/tmp",
      logger: silentLogger,
    });
    const r = await tool.execute(
      { agent: "mimir", prompt: "hi", timeoutMs: 100 } as any,
      { metadata: { parentAgent: "odin" }, sessionID: "ses_parent" } as any,
    );
    expect(decode(r).error).toContain("timeoutMs must be between");
  });
});

// Re-pins for the delegation helpers so a refactor of bg-spawn.ts keeps
// the suite green (these are also covered by bg-spawn-delegation.test.ts,
// but pin them here for fast-failure in the same suite).
describe("bizar_spawn_background — delegation helpers (re-pinned)", () => {
  it("PRIMARY_AGENTS is unchanged", () => {
    expect(PRIMARY_AGENTS.has("odin")).toBe(true);
    expect(PRIMARY_AGENTS.has("quick")).toBe(true);
    expect(PRIMARY_AGENTS.has("agent-browser")).toBe(true);
    expect(PRIMARY_AGENTS.has("mimir")).toBe(false);
  });
  it("needsDelegationWrapper mirrors PRIMARY_AGENTS", () => {
    expect(needsDelegationWrapper("odin")).toBe(false);
    expect(needsDelegationWrapper("mimir")).toBe(true);
  });
  it("buildDelegationPrompt names the requested subagent", () => {
    const p = buildDelegationPrompt("mimir", "research X");
    expect(p).toContain("Requested subagent: mimir");
  });
});