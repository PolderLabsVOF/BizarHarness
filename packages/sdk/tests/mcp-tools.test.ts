/**
 * mcp-tools.test.ts — exercises the 4 new MCP tools (F-032) by calling
 * each tool's `handler` directly and asserting the return shape.
 *
 * The tools live in `packages/sdk/src/mcp/server.ts`; we import the
 * compiled `BIZAR_TOOLS` array and walk it to find each tool by name.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { BIZAR_TOOLS, type SdkMcpToolDef } from "../src/mcp/server.js";
import { bizarAgentRegistry } from "../src/agent-registry.js";
import { swarmTopologyRegistry } from "../src/swarm-topology.js";

function findTool(name: string): SdkMcpToolDef {
  const t = BIZAR_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

async function call(toolName: string, args: unknown): Promise<unknown> {
  const tool = findTool(toolName);
  const res = await tool.handler(args, {});
  // Standard MCP shape: { content: [{ type: 'text', text: '...' }] }
  if (!Array.isArray(res.content) || res.content.length !== 1) {
    throw new Error(`unexpected response shape from ${toolName}`);
  }
  const block = res.content[0];
  if (block.type !== "text") throw new Error(`unexpected block type: ${block.type}`);
  try { return JSON.parse(block.text); }
  catch { return block.text; }
}

describe("MCP tools — F-032 swarm/agent lifecycle", () => {
  beforeEach(() => {
    // Each test starts from a clean slate so list assertions are deterministic.
    bizarAgentRegistry.reset();
    swarmTopologyRegistry.reset();
  });

  test("BIZAR_TOOLS includes the 4 new tools (total ≥ 17)", () => {
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    expect(names.has("agent_spawn")).toBe(true);
    expect(names.has("agent_list")).toBe(true);
    expect(names.has("agent_terminate")).toBe(true);
    expect(names.has("swarm_init")).toBe(true);
    expect(BIZAR_TOOLS.length).toBeGreaterThanOrEqual(17);
  });

  test("each new tool has the expected inputSchema", () => {
    const spawn = findTool("agent_spawn");
    expect(spawn.inputSchema).toMatchObject({
      type: "string", name: "string", priority: "string", metadata: "string",
    });

    const list = findTool("agent_list");
    expect(list.inputSchema).toMatchObject({
      status: "string", type: "string", limit: "number", offset: "number",
    });

    const term = findTool("agent_terminate");
    expect(term.inputSchema).toMatchObject({
      agentId: "string", graceful: "boolean", reason: "string",
    });

    const swarm = findTool("swarm_init");
    expect(swarm.inputSchema).toMatchObject({
      topology: "string", maxAgents: "number", metadata: "string",
    });
  });

  test("agent_spawn returns { agentId, status }", async () => {
    const r = await call("agent_spawn", { type: "coder", name: "ada" });
    expect(r).toMatchObject({ status: "active" });
    expect((r as { agentId: string }).agentId).toMatch(/^agent-/);
  });

  test("agent_spawn parses metadata JSON when supplied", async () => {
    const r = await call("agent_spawn", {
      type: "coder",
      metadata: JSON.stringify({ region: "us", priority: "high" }),
    });
    const id = (r as { agentId: string }).agentId;
    const got = bizarAgentRegistry.getAgent(id);
    expect(got?.metadata).toEqual({ region: "us", priority: "high" });
  });

  test("agent_spawn returns a structured error when metadata is not valid JSON", async () => {
    const tool = findTool("agent_spawn");
    const res = await tool.handler({ type: "coder", metadata: "not-json" }, {});
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^error:/);
    expect(text).toMatch(/JSON/);
  });

  test("agent_spawn rejects types outside the AGENT_TYPES allowlist", async () => {
    const tool = findTool("agent_spawn");
    const res = await tool.handler({ type: "lawyer" }, {});
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^error:/);
    expect(text).toMatch(/must be one of/);
  });

  test("agent_list returns active agents by default", async () => {
    await call("agent_spawn", { type: "coder" });
    await call("agent_spawn", { type: "reviewer" });
    const r = await call("agent_list", {});
    expect(r).toMatchObject({ total: 2 });
    expect((r as { agents: unknown[] }).agents).toHaveLength(2);
  });

  test("agent_list filters by status", async () => {
    const a = await call("agent_spawn", { type: "coder" }) as { agentId: string };
    await call("agent_spawn", { type: "coder" });
    await call("agent_terminate", { agentId: a.agentId, reason: "test" });
    const terminated = await call("agent_list", { status: "terminated" });
    expect(terminated).toMatchObject({ total: 1 });
    const active = await call("agent_list", { status: "active" });
    expect(active).toMatchObject({ total: 1 });
  });

  test("agent_list defaults status to 'all' for unrecognized values", async () => {
    await call("agent_spawn", { type: "coder" });
    const r = await call("agent_list", { status: "bogus" });
    expect(r).toMatchObject({ total: 1 });
  });

  test("agent_terminate returns { agentId, status, terminatedAt }", async () => {
    const spawned = await call("agent_spawn", { type: "coder" }) as { agentId: string };
    const r = await call("agent_terminate", { agentId: spawned.agentId, reason: "done" });
    expect(r).toMatchObject({
      agentId: spawned.agentId,
      status: "terminated",
    });
    expect(typeof (r as { terminatedAt: string }).terminatedAt).toBe("string");
  });

  test("agent_terminate surfaces a structured error for unknown agent", async () => {
    const tool = findTool("agent_terminate");
    const res = await tool.handler({ agentId: "agent-nope" }, {});
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^error:/);
    expect(text).toMatch(/not found/);
  });

  test("swarm_init creates a swarm with defaults", async () => {
    const r = await call("swarm_init", {}) as {
      swarmId: string; topology: string; maxAgents: number; createdAt: string;
    };
    expect(r.swarmId).toMatch(/^swarm-\d+$/);
    expect(r.topology).toBe("hierarchical-mesh");
    expect(r.maxAgents).toBe(15);
    expect(typeof r.createdAt).toBe("string");
  });

  test("swarm_init respects topology and maxAgents", async () => {
    const r = await call("swarm_init", {
      topology: "mesh",
      maxAgents: 42,
      metadata: JSON.stringify({ owner: "F-032" }),
    }) as { topology: string; maxAgents: number; metadata?: Record<string, unknown> };
    expect(r.topology).toBe("mesh");
    expect(r.maxAgents).toBe(42);
    expect(r.metadata).toEqual({ owner: "F-032" });
  });

  test("swarm_init clamps maxAgents to [1, 1000]", async () => {
    const lo = await call("swarm_init", { maxAgents: 0 }) as { maxAgents: number };
    const hi = await call("swarm_init", { maxAgents: 99999 }) as { maxAgents: number };
    expect(lo.maxAgents).toBe(1);
    expect(hi.maxAgents).toBe(1000);
  });

  test("swarm_init returns an error for invalid JSON metadata", async () => {
    const tool = findTool("swarm_init");
    const res = await tool.handler({ metadata: "{not-json" }, {});
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^error:/);
    expect(text).toMatch(/JSON/);
  });

  test("end-to-end: spawn → list → terminate → list shows 1 active + 1 terminated", async () => {
    const spawned = await call("agent_spawn", { type: "coder", name: "ada" }) as {
      agentId: string;
    };

    const allAfterSpawn = await call("agent_list", { status: "all" }) as {
      total: number; agents: { agentId: string; status: string }[];
    };
    expect(allAfterSpawn.total).toBe(1);
    expect(allAfterSpawn.agents[0]?.status).toBe("active");
    expect(allAfterSpawn.agents[0]?.agentId).toBe(spawned.agentId);

    await call("agent_terminate", { agentId: spawned.agentId, reason: "smoke" });

    const allAfterTerm = await call("agent_list", { status: "all" }) as {
      total: number; agents: { status: string }[];
    };
    expect(allAfterTerm.total).toBe(1);
    expect(allAfterTerm.agents[0]?.status).toBe("terminated");

    // Sanity: the registry returns the same record (proves state lives in BizarAgentRegistry).
    expect(bizarAgentRegistry.getAgent(spawned.agentId)?.status).toBe("terminated");
  });
});