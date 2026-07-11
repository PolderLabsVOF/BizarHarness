/**
 * swarm-topology.test.ts — unit tests for the swarm topology registry.
 *
 * F-032 — covers initSwarm, maxAgents clamping, topology enum, the
 * lazy default swarm, recordAgentInSwarm, decommissionSwarm, and
 * optional JSON persistence.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SwarmTopologyRegistry,
  swarmTopologyRegistry,
  initSwarm,
  getSwarm,
  listSwarms,
  recordAgentInSwarm,
  decommissionSwarm,
  SWARM_TOPOLOGIES,
  DEFAULT_TOPOLOGY,
  DEFAULT_MAX_AGENTS,
  DEFAULT_SWARM_ID,
  type SwarmTopology,
} from "../src/swarm-topology.js";

describe("SwarmTopologyRegistry — class API", () => {
  let reg: SwarmTopologyRegistry;

  beforeEach(() => {
    reg = new SwarmTopologyRegistry();
  });

  test("initSwarm creates a swarm with defaults when no args", () => {
    const r = reg.initSwarm();
    expect(r.topology).toBe(DEFAULT_TOPOLOGY);
    expect(r.maxAgents).toBe(DEFAULT_MAX_AGENTS);
    expect(r.swarmId).toMatch(/^swarm-\d+$/);
    expect(typeof r.createdAt).toBe("string");
  });

  test("initSwarm accepts a custom swarmId", () => {
    const r = reg.initSwarm({ swarmId: "alpha" });
    expect(r.swarmId).toBe("alpha");
    expect(reg.getSwarm("alpha")).toBeDefined();
  });

  test("initSwarm rejects duplicate swarmId", () => {
    reg.initSwarm({ swarmId: "dup" });
    expect(() => reg.initSwarm({ swarmId: "dup" })).toThrow(/already exists/);
  });

  test("topology enum is enforced — falls back to default for unknown", () => {
    const r = reg.initSwarm({ topology: "unknown" as unknown as SwarmTopology });
    expect(r.topology).toBe(DEFAULT_TOPOLOGY);
  });

  test("each valid topology is accepted", () => {
    for (const topo of SWARM_TOPOLOGIES) {
      const r = reg.initSwarm({ topology: topo });
      expect(r.topology).toBe(topo);
    }
  });

  test("maxAgents is clamped to [1, 1000]", () => {
    const lo = reg.initSwarm({ maxAgents: -5 });
    expect(lo.maxAgents).toBe(1);
    const hi = reg.initSwarm({ maxAgents: 9999 });
    expect(hi.maxAgents).toBe(1000);
    const mid = reg.initSwarm({ maxAgents: 50 });
    expect(mid.maxAgents).toBe(50);
  });

  test("maxAgents defaults to 15", () => {
    const r = reg.initSwarm();
    expect(r.maxAgents).toBe(15);
  });

  test("non-numeric maxAgents falls back to default", () => {
    const r = reg.initSwarm({ maxAgents: NaN });
    expect(r.maxAgents).toBe(15);
    const r2 = reg.initSwarm({ maxAgents: "50" as unknown as number });
    expect(r2.maxAgents).toBe(15);
  });

  test("metadata is round-tripped", () => {
    const r = reg.initSwarm({ metadata: { owner: "F-032", region: "us" } });
    expect(reg.getSwarm(r.swarmId)?.metadata).toEqual({ owner: "F-032", region: "us" });
  });

  test("the 'default' swarm is seeded lazily on first initSwarm call", () => {
    expect(reg.getSwarm(DEFAULT_SWARM_ID)).toBeUndefined();
    reg.initSwarm({ swarmId: "after" });
    const def = reg.getSwarm(DEFAULT_SWARM_ID);
    expect(def).toBeDefined();
    expect(def?.topology).toBe(DEFAULT_TOPOLOGY);
    expect(def?.maxAgents).toBe(DEFAULT_MAX_AGENTS);
  });

  test("listSwarms includes the default swarm after first initSwarm", () => {
    reg.initSwarm({ swarmId: "x" });
    const all = reg.listSwarms();
    expect(all.map((s) => s.swarmId).sort()).toEqual([DEFAULT_SWARM_ID, "x"].sort());
  });

  test("getSwarm on missing id returns undefined", () => {
    expect(reg.getSwarm("nope")).toBeUndefined();
  });

  test("recordAgentInSwarm appends agentIds and dedupes", () => {
    const r = reg.initSwarm({ swarmId: "team", maxAgents: 3 });
    recordAgentInSwarmOn(reg, "team", "a1");
    recordAgentInSwarmOn(reg, "team", "a2");
    recordAgentInSwarmOn(reg, "team", "a1"); // dedupe
    const swarm = reg.getSwarm("team");
    expect(swarm?.agentIds).toEqual(["a1", "a2"]);
  });

  test("recordAgentInSwarm refuses beyond maxAgents", () => {
    const r = reg.initSwarm({ swarmId: "small", maxAgents: 2 });
    recordAgentInSwarmOn(reg, "small", "a1");
    recordAgentInSwarmOn(reg, "small", "a2");
    expect(() => recordAgentInSwarmOn(reg, "small", "a3")).toThrow(/maxAgents/);
  });

  test("recordAgentInSwarm throws on missing swarm", () => {
    expect(() => recordAgentInSwarmOn(reg, "ghost", "a1")).toThrow(/not found/);
  });

  test("decommissionSwarm marks the swarm and refuses further recordAgentInSwarm", () => {
    reg.initSwarm({ swarmId: "doomed" });
    reg.decommissionSwarm("doomed");
    expect(reg.getSwarm("doomed")?.decommissionedAt).toBeDefined();
    expect(() => recordAgentInSwarmOn(reg, "doomed", "a1")).toThrow(/decommissioned/);
  });

  test("decommissionSwarm refuses the default swarm", () => {
    reg.initSwarm({ swarmId: "trigger" });
    expect(() => reg.decommissionSwarm(DEFAULT_SWARM_ID)).toThrow(/default/);
  });

  test("decommissionSwarm throws on missing swarm", () => {
    expect(() => reg.decommissionSwarm("ghost")).toThrow(/not found/);
  });

  test("reset() drops everything including the lazy default seed flag", () => {
    reg.initSwarm({ swarmId: "x" });
    expect(reg.listSwarms().length).toBeGreaterThan(0);
    reg.reset();
    expect(reg.listSwarms().length).toBe(0);
    expect(reg.getSwarm(DEFAULT_SWARM_ID)).toBeUndefined();
  });
});

// Helper — bypass module-level helper to operate on a per-test registry.
function recordAgentInSwarmOn(
  reg: SwarmTopologyRegistry,
  swarmId: string,
  agentId: string,
) {
  return reg.recordAgentInSwarm(swarmId, agentId);
}

describe("SwarmTopologyRegistry — module-level helpers", () => {
  test("initSwarm helper shares state with swarmTopologyRegistry", () => {
    const r = initSwarm({ swarmId: "shared" });
    expect(swarmTopologyRegistry.getSwarm(r.swarmId)).toBeDefined();
    expect(getSwarm(r.swarmId)?.swarmId).toBe("shared");
    expect(listSwarms().some((s) => s.swarmId === "shared")).toBe(true);
    // cleanup
    swarmTopologyRegistry.decommissionSwarm("shared");
  });

  test("recordAgentInSwarm helper reflects in swarmTopologyRegistry", () => {
    const r = initSwarm({ swarmId: "record-helper" });
    recordAgentInSwarm(r.swarmId, "agent-x");
    expect(swarmTopologyRegistry.getSwarm(r.swarmId)?.agentIds).toContain("agent-x");
    swarmTopologyRegistry.decommissionSwarm(r.swarmId);
  });

  test("decommissionSwarm helper reflects in swarmTopologyRegistry", () => {
    const r = initSwarm({ swarmId: "decomm-helper" });
    decommissionSwarm(r.swarmId);
    expect(swarmTopologyRegistry.getSwarm(r.swarmId)?.decommissionedAt).toBeDefined();
  });
});

describe("SwarmTopologyRegistry — persistence", () => {
  let dir: string;
  let persistPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swarm-topology-"));
    persistPath = join(dir, "topology.json");
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  test("a fresh registry with persistPath starts empty when file is missing", () => {
    const reg = new SwarmTopologyRegistry({ persistPath });
    expect(reg.listSwarms()).toEqual([]);
  });

  test("initSwarm writes a snapshot to disk after each call", () => {
    const reg = new SwarmTopologyRegistry({ persistPath });
    reg.initSwarm({ swarmId: "alpha", topology: "mesh" });
    expect(existsSync(persistPath)).toBe(true);
    const stored = JSON.parse(readFileSync(persistPath, "utf-8")) as {
      swarms: Array<{ swarmId: string; topology: string }>;
    };
    expect(stored.swarms.some((s) => s.swarmId === "alpha" && s.topology === "mesh")).toBe(true);
  });

  test("a new registry reading the same path picks up persisted swarms", () => {
    const reg1 = new SwarmTopologyRegistry({ persistPath });
    reg1.initSwarm({ swarmId: "persisted", topology: "adaptive", maxAgents: 25 });
    expect(reg1.listSwarms().some((s) => s.swarmId === "persisted")).toBe(true);

    const reg2 = new SwarmTopologyRegistry({ persistPath });
    const got = reg2.getSwarm("persisted");
    expect(got?.topology).toBe("adaptive");
    expect(got?.maxAgents).toBe(25);
  });

  test("setPersistPath switches the persistence target at runtime", () => {
    const reg = new SwarmTopologyRegistry();
    reg.setPersistPath(persistPath);
    reg.initSwarm({ swarmId: "first" });
    expect(existsSync(persistPath)).toBe(true);

    const other = join(dir, "topology-other.json");
    reg.setPersistPath(other);
    reg.initSwarm({ swarmId: "second" });
    expect(existsSync(other)).toBe(true);
  });

  test("a corrupt persistence file does not crash the registry", () => {
    require("node:fs").writeFileSync(persistPath, "{not json", "utf-8");
    const reg = new SwarmTopologyRegistry({ persistPath });
    expect(reg.listSwarms()).toEqual([]);
    reg.initSwarm({ swarmId: "recovered" });
    expect(reg.getSwarm("recovered")).toBeDefined();
  });

  test("decommissionSwarm writes decommissionedAt to the persisted file", () => {
    const reg = new SwarmTopologyRegistry({ persistPath });
    reg.initSwarm({ swarmId: "doomed" });
    reg.decommissionSwarm("doomed");
    const stored = JSON.parse(readFileSync(persistPath, "utf-8")) as {
      swarms: Array<{ swarmId: string; decommissionedAt?: string }>;
    };
    const row = stored.swarms.find((s) => s.swarmId === "doomed");
    expect(row?.decommissionedAt).toBeDefined();
  });
});