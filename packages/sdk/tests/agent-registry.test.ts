/**
 * agent-registry.test.ts — unit tests for the in-process agent registry.
 *
 * F-032 — covers registerAgent, listAgents, terminateAgent, getAgent,
 * the heartbeat stub, the type allowlist, and the singleton-vs-class
 * contract.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BizarAgentRegistry,
  bizarAgentRegistry,
  AGENT_TYPES,
  isAllowedAgentType,
  type AgentRecord,
} from "../src/agent-registry.js";

describe("BizarAgentRegistry — class API", () => {
  let reg: BizarAgentRegistry;

  beforeEach(() => {
    reg = new BizarAgentRegistry();
  });

  test("registerAgent returns { agentId, status: 'active' } and a uuid-suffixed id", () => {
    const r = reg.registerAgent({ type: "coder" });
    expect(r.status).toBe("active");
    // crypto.randomUUID() format: agent-<8-4-4-4-12 hex>
    expect(r.agentId).toMatch(/^agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("each register call yields a unique id", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) {
      ids.add(reg.registerAgent({ type: "coder" }).agentId);
    }
    expect(ids.size).toBe(25);
  });

  test("getAgent returns the same record the register call produced", () => {
    const { agentId } = reg.registerAgent({ type: "researcher", name: "Ada" });
    const got: AgentRecord | undefined = reg.getAgent(agentId);
    expect(got).toBeDefined();
    expect(got?.type).toBe("researcher");
    expect(got?.name).toBe("Ada");
    expect(got?.status).toBe("active");
    expect(got?.taskCount).toBe(0);
    expect(typeof got?.createdAt).toBe("string");
    expect(got?.createdAt).toBe(got?.lastHeartbeatAt);
  });

  test("listAgents returns { agents, total } with default filters", () => {
    reg.registerAgent({ type: "coder" });
    reg.registerAgent({ type: "reviewer" });
    const out = reg.listAgents();
    expect(out.total).toBe(2);
    expect(out.agents).toHaveLength(2);
    expect(out.agents.every((a) => a.status === "active")).toBe(true);
  });

  test("listAgents filters by type", () => {
    reg.registerAgent({ type: "coder" });
    reg.registerAgent({ type: "coder" });
    reg.registerAgent({ type: "reviewer" });
    const coders = reg.listAgents({ type: "coder" });
    expect(coders.total).toBe(2);
    expect(coders.agents.every((a) => a.type === "coder")).toBe(true);
  });

  test("listAgents supports limit + offset", () => {
    for (let i = 0; i < 10; i++) reg.registerAgent({ type: "coder" });
    const page1 = reg.listAgents({ limit: 3, offset: 0 });
    const page2 = reg.listAgents({ limit: 3, offset: 3 });
    expect(page1.agents).toHaveLength(3);
    expect(page2.agents).toHaveLength(3);
    expect(new Set([...page1.agents, ...page2.agents].map((a) => a.agentId)).size).toBe(6);
  });

  test("terminateAgent flips status to terminated and stamps terminatedAt", () => {
    const { agentId } = reg.registerAgent({ type: "coder" });
    const r = reg.terminateAgent({ agentId, reason: "shutdown", graceful: true });
    expect(r.status).toBe("terminated");
    expect(r.agentId).toBe(agentId);
    expect(typeof r.terminatedAt).toBe("string");
    const record = reg.getAgent(agentId);
    expect(record?.status).toBe("terminated");
    expect(record?.terminationReason).toBe("shutdown");
    expect(record?.gracefulTermination).toBe(true);
    expect(record?.terminatedAt).toBe(r.terminatedAt);
  });

  test("listAgents({ status: 'terminated' }) only shows terminated", () => {
    const a = reg.registerAgent({ type: "coder" });
    reg.registerAgent({ type: "coder" });
    reg.terminateAgent({ agentId: a.agentId, reason: "x" });
    const out = reg.listAgents({ status: "terminated" });
    expect(out.total).toBe(1);
    expect(out.agents[0]?.agentId).toBe(a.agentId);
  });

  test("listAgents({ status: 'all' }) returns both", () => {
    const a = reg.registerAgent({ type: "coder" });
    reg.registerAgent({ type: "coder" });
    reg.terminateAgent({ agentId: a.agentId, reason: "x" });
    const out = reg.listAgents({ status: "all" });
    expect(out.total).toBe(2);
  });

  test("terminateAgent throws on unknown id", () => {
    expect(() => reg.terminateAgent({ agentId: "agent-nope", reason: "x" }))
      .toThrow(/not found/);
  });

  test("registerAgent throws on empty type", () => {
    expect(() => reg.registerAgent({ type: "" })).toThrow(/type/);
  });

  test("heartbeat refreshes lastHeartbeatAt for active agents", async () => {
    const { agentId } = reg.registerAgent({ type: "coder" });
    const before = reg.getAgent(agentId)?.lastHeartbeatAt;
    await new Promise((r) => setTimeout(r, 5));
    expect(reg.heartbeat(agentId)).toBe(true);
    const after = reg.getAgent(agentId)?.lastHeartbeatAt;
    expect(after).not.toBe(before);
    expect(after).toBeDefined();
  });

  test("heartbeat returns false for unknown or terminated agents", () => {
    expect(reg.heartbeat("agent-missing")).toBe(false);
    const { agentId } = reg.registerAgent({ type: "coder" });
    reg.terminateAgent({ agentId, reason: "x" });
    expect(reg.heartbeat(agentId)).toBe(false);
  });

  test("incrementTaskCount bumps taskCount and returns the new value", () => {
    const { agentId } = reg.registerAgent({ type: "coder" });
    expect(reg.incrementTaskCount(agentId)).toBe(1);
    expect(reg.incrementTaskCount(agentId, 4)).toBe(5);
    expect(reg.getAgent(agentId)?.taskCount).toBe(5);
  });

  test("reset() clears the registry", () => {
    reg.registerAgent({ type: "coder" });
    expect(reg.size()).toBe(1);
    reg.reset();
    expect(reg.size()).toBe(0);
  });
});

describe("BizarAgentRegistry — type allowlist", () => {
  let reg: BizarAgentRegistry;
  beforeEach(() => { reg = new BizarAgentRegistry(); });

  test("AGENT_TYPES contains the 9 Bizar typed agents", () => {
    expect(AGENT_TYPES).toEqual([
      "coder",
      "tester",
      "reviewer",
      "system-architect",
      "planner",
      "researcher",
      "performance-engineer",
      "security-auditor",
      "context-specialist",
    ]);
  });

  test("isAllowedAgentType returns true for known and false for unknown", () => {
    for (const t of AGENT_TYPES) expect(isAllowedAgentType(t)).toBe(true);
    expect(isAllowedAgentType("unknown")).toBe(false);
    expect(isAllowedAgentType("")).toBe(false);
    expect(isAllowedAgentType(undefined)).toBe(false);
    expect(isAllowedAgentType(42)).toBe(false);
  });

  test("registerAgent accepts each allowed type", () => {
    for (const t of AGENT_TYPES) {
      const r = reg.registerAgent({ type: t });
      expect(reg.getAgent(r.agentId)?.type).toBe(t);
    }
    expect(reg.size()).toBe(AGENT_TYPES.length);
  });

  test("registerAgent rejects unknown types with a descriptive message", () => {
    expect(() => reg.registerAgent({ type: "lawyer" as unknown as "coder" }))
      .toThrow(/must be one of/);
    expect(() => reg.registerAgent({ type: "random-string" as unknown as "coder" }))
      .toThrow(/got: random-string/);
  });
});

describe("BizarAgentRegistry — persistence", () => {
  let dir: string;
  let persistPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-registry-"));
    persistPath = join(dir, "agents.json");
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  test("a fresh registry with persistPath starts empty when file is missing", () => {
    const reg = new BizarAgentRegistry({ persistPath });
    expect(reg.size()).toBe(0);
  });

  test("mutations write a snapshot to disk after each call", () => {
    const reg = new BizarAgentRegistry({ persistPath });
    const { agentId } = reg.registerAgent({ type: "coder" });
    expect(existsSync(persistPath)).toBe(true);
    reg.terminateAgent({ agentId, reason: "x" });
    const stored = JSON.parse(require("node:fs").readFileSync(persistPath, "utf-8")) as { agents: AgentRecord[] };
    expect(stored.agents).toHaveLength(1);
    expect(stored.agents[0]?.status).toBe("terminated");
    expect(stored.agents[0]?.agentId).toBe(agentId);
  });

  test("a new registry reading the same path picks up persisted agents", () => {
    const reg1 = new BizarAgentRegistry({ persistPath });
    const { agentId } = reg1.registerAgent({ type: "reviewer", name: "R1" });
    expect(reg1.size()).toBe(1);

    const reg2 = new BizarAgentRegistry({ persistPath });
    expect(reg2.size()).toBe(1);
    const got = reg2.getAgent(agentId);
    expect(got?.type).toBe("reviewer");
    expect(got?.name).toBe("R1");
    expect(got?.status).toBe("active");
  });

  test("setPersistPath switches the persistence target at runtime", () => {
    const reg = new BizarAgentRegistry();
    reg.setPersistPath(persistPath);
    reg.registerAgent({ type: "planner" });
    expect(existsSync(persistPath)).toBe(true);

    const other = join(dir, "agents-other.json");
    reg.setPersistPath(other);
    reg.registerAgent({ type: "tester" });
    expect(existsSync(other)).toBe(true);
  });

  test("a corrupt persistence file does not crash the registry", () => {
    require("node:fs").writeFileSync(persistPath, "{not json", "utf-8");
    const reg = new BizarAgentRegistry({ persistPath });
    expect(reg.size()).toBe(0);
    reg.registerAgent({ type: "coder" });
    expect(reg.size()).toBe(1);
  });

  test("reset() wipes the persisted file when configured", () => {
    const reg = new BizarAgentRegistry({ persistPath });
    reg.registerAgent({ type: "coder" });
    expect(existsSync(persistPath)).toBe(true);
    reg.reset();
    const stored = JSON.parse(require("node:fs").readFileSync(persistPath, "utf-8")) as { agents: AgentRecord[] };
    expect(stored.agents).toEqual([]);
  });
});

describe("BizarAgentRegistry — singleton", () => {
  test("bizarAgentRegistry is an instance of BizarAgentRegistry", () => {
    expect(bizarAgentRegistry).toBeInstanceOf(BizarAgentRegistry);
  });

  test("register on singleton is visible via getAgent on the same singleton", () => {
    const r = bizarAgentRegistry.registerAgent({ type: "context-specialist" });
    expect(bizarAgentRegistry.getAgent(r.agentId)?.type).toBe("context-specialist");
    // cleanup so we don't pollute later tests
    bizarAgentRegistry.terminateAgent({ agentId: r.agentId, reason: "cleanup" });
  });

  test("singleton has a persistPath configured", () => {
    // The singleton writes to .harness/agents.json by default. We
    // verify the internal field is set without depending on the
    // exact path resolution at the CWD level.
    expect((bizarAgentRegistry as unknown as { persistPath?: string }).persistPath).toBeDefined();
  });
});
