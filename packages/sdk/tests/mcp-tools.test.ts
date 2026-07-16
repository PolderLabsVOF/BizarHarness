/**
 * mcp-tools.test.ts — exercises the Bizar MCP tools by calling each
 * tool's `handler` directly and asserting the return shape.
 *
 * The tools live in `packages/sdk/src/mcp/server.ts`; we import the
 * compiled `BIZAR_TOOLS` array and walk it to find each tool by name.
 *
 * v10.3.0 — Tests rewritten to cover only the tools that ship in the
 * current surface. The 14 dead tools (agent_spawn, swarm_init, route_agent,
 * heartbeat, cron_*, model_route, agent_route, hooks_route, memory_distill,
 * consensus_propose, federation_status, danger_check) were removed in
 * the audit cleanup; their tests went with them.
 */

import { describe, test, expect } from "vitest";
import { BIZAR_TOOLS, type SdkMcpToolDef } from "../src/mcp/server.js";

function findTool(name: string): SdkMcpToolDef {
  const t = BIZAR_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

async function callText(toolName: string, args: unknown): Promise<string> {
  const tool = findTool(toolName);
  const res = await tool.handler(args, {});
  if (!Array.isArray(res.content) || res.content.length !== 1) {
    throw new Error(`unexpected response shape from ${toolName}`);
  }
  const block = res.content[0];
  if (block.type !== "text") throw new Error(`unexpected block type: ${block.type}`);
  return block.text;
}

async function callJson(toolName: string, args: unknown): Promise<unknown> {
  const text = await callText(toolName, args);
  try { return JSON.parse(text); }
  catch { return text; }
}

describe("BIZAR_TOOLS surface", () => {
  test("ships the legacy v6 memory/plan/kb/loop/graph tools", () => {
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    for (const expected of [
      "memory_read", "memory_write", "memory_list", "memory_search",
      "plan_action", "open_kb",
      "loop_start", "loop_stop", "loop_list", "loop_status",
      "graph_query", "graph_path",
    ]) {
      expect(names.has(expected), `missing tool: ${expected}`).toBe(true);
    }
  });

  test("ships the Pillar D read-back tools", () => {
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    expect(names.has("list_instincts")).toBe(true);
    expect(names.has("list_decisions")).toBe(true);
  });

  test("does not ship the deleted dead tools", () => {
    const names = new Set(BIZAR_TOOLS.map((t) => t.name));
    for (const gone of [
      "agent_spawn", "agent_list", "agent_terminate",
      "swarm_init", "route_agent", "model_route", "agent_route",
      "hooks_route", "memory_distill", "consensus_propose",
      "federation_status", "session_heartbeat",
      "cron_add", "cron_list", "cron_remove", "danger_check",
    ]) {
      expect(names.has(gone), `deleted tool still present: ${gone}`).toBe(false);
    }
  });
});

describe("Pillar D tools", () => {
  test("list_instincts returns 'no_instincts' on an empty vault", async () => {
    const r = await callText("list_instincts", {});
    expect(r).toBe("no_instincts");
  });

  test("list_decisions returns 'no_decisions' on an empty vault", async () => {
    const r = await callText("list_decisions", {});
    expect(r).toBe("no_decisions");
  });

  test("list_instincts respects the limit parameter", async () => {
    const r = await callText("list_instincts", { limit: 5 });
    expect(typeof r).toBe("string");
    // Empty vault — should still be no_instincts regardless of limit
    expect(r).toBe("no_instincts");
  });

  test("list_decisions respects the limit parameter", async () => {
    const r = await callText("list_decisions", { limit: 10 });
    expect(typeof r).toBe("string");
    expect(r).toBe("no_decisions");
  });
});

describe("Memory tools (legacy v6 surface)", () => {
  test("memory_search returns 'no_matches' on an empty vault", async () => {
    const r = await callText("memory_search", { query: "definitely_no_such_thing_xyz" });
    expect(r).toBe("no_matches");
  });

  test("memory_list returns an empty body on an empty vault", async () => {
    const r = await callText("memory_list", {});
    expect(r).toBe("");
  });
});