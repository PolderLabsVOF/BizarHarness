/**
 * swarm-topology.ts — in-process swarm coordination topology registry.
 *
 * F-032 — ported from ruflo `v3/mcp/tools/swarm-tools.ts` `swarm/init`
 * (line 389). Tracks swarm definitions and the agents assigned to them.
 * No event bus — purely a registry the MCP tools can read/write.
 *
 * The `default` swarm is created lazily on first `initSwarm` call so
 * consumers always have at least one swarm to inspect.
 *
 * Persistence is opt-in: pass `{ persistPath }` to the constructor (or
 * to the `swarmTopologyRegistry` singleton via its mutator) and the
 * registry writes a JSON snapshot to disk after every mutation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SwarmTopology =
  | "hierarchical"
  | "mesh"
  | "adaptive"
  | "collective"
  | "hierarchical-mesh";

export const SWARM_TOPOLOGIES: readonly SwarmTopology[] = [
  "hierarchical",
  "mesh",
  "adaptive",
  "collective",
  "hierarchical-mesh",
] as const;

export const DEFAULT_TOPOLOGY: SwarmTopology = "hierarchical-mesh";
export const DEFAULT_MAX_AGENTS = 15;
export const MIN_MAX_AGENTS = 1;
export const MAX_MAX_AGENTS = 1000;
export const DEFAULT_SWARM_ID = "default";

export interface SwarmRecord {
  swarmId: string;
  topology: SwarmTopology;
  maxAgents: number;
  metadata?: Record<string, unknown>;
  agentIds: string[];
  createdAt: string;
  decommissionedAt?: string;
}

export interface InitSwarmInput {
  swarmId?: string;
  topology?: SwarmTopology;
  maxAgents?: number;
  metadata?: Record<string, unknown>;
}

export interface InitSwarmResult {
  swarmId: string;
  topology: SwarmTopology;
  maxAgents: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SwarmTopologyRegistryOpts {
  /**
   * When set, the registry loads from this file on construction (if it
   * exists) and writes a JSON snapshot after every mutation. The parent
   * directory is created on demand. Path resolution is the caller's
   * responsibility — the registry treats the value as final.
   */
  persistPath?: string;
}

interface PersistShape {
  version: 1;
  swarms: SwarmRecord[];
}

function clampMaxAgents(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_AGENTS;
  if (v < MIN_MAX_AGENTS) return MIN_MAX_AGENTS;
  if (v > MAX_MAX_AGENTS) return MAX_MAX_AGENTS;
  return v;
}

function normalizeTopology(t: unknown): SwarmTopology {
  if (typeof t === "string" && (SWARM_TOPOLOGIES as readonly string[]).includes(t)) {
    return t as SwarmTopology;
  }
  return DEFAULT_TOPOLOGY;
}

export class SwarmTopologyRegistry {
  private readonly swarms: Map<string, SwarmRecord> = new Map();
  private defaultSeeded = false;
  private persistPath?: string;

  constructor(opts: SwarmTopologyRegistryOpts = {}) {
    this.persistPath = opts.persistPath;
    if (this.persistPath) this.loadFromDisk();
  }

  /**
   * Configure (or clear) the persistence path after construction.
   */
  setPersistPath(path: string | undefined): void {
    this.persistPath = path;
    if (path) this.loadFromDisk();
  }

  private nextSwarmId(): string {
    let i = 1;
    while (this.swarms.has(`swarm-${i}`)) i++;
    return `swarm-${i}`;
  }

  private ensureDefault(): void {
    if (this.defaultSeeded) return;
    this.defaultSeeded = true;
    if (!this.swarms.has(DEFAULT_SWARM_ID)) {
      const createdAt = new Date().toISOString();
      this.swarms.set(DEFAULT_SWARM_ID, {
        swarmId: DEFAULT_SWARM_ID,
        topology: DEFAULT_TOPOLOGY,
        maxAgents: DEFAULT_MAX_AGENTS,
        agentIds: [],
        createdAt,
      });
    }
  }

  initSwarm(input: InitSwarmInput = {}): InitSwarmResult {
    this.ensureDefault();

    let swarmId = input.swarmId?.trim();
    if (!swarmId) swarmId = this.nextSwarmId();
    if (this.swarms.has(swarmId)) {
      throw new Error(`initSwarm: swarm already exists: ${swarmId}`);
    }

    const topology = normalizeTopology(input.topology);
    const maxAgents = clampMaxAgents(input.maxAgents);
    const createdAt = new Date().toISOString();
    const record: SwarmRecord = {
      swarmId,
      topology,
      maxAgents,
      metadata: input.metadata,
      agentIds: [],
      createdAt,
    };
    this.swarms.set(swarmId, record);
    this.persist();
    return { swarmId, topology, maxAgents, createdAt, metadata: input.metadata };
  }

  getSwarm(swarmId: string): SwarmRecord | undefined {
    return this.swarms.get(swarmId);
  }

  listSwarms(): SwarmRecord[] {
    return Array.from(this.swarms.values());
  }

  recordAgentInSwarm(swarmId: string, agentId: string): SwarmRecord {
    const record = this.swarms.get(swarmId);
    if (!record) {
      throw new Error(`recordAgentInSwarm: swarm not found: ${swarmId}`);
    }
    if (record.decommissionedAt) {
      throw new Error(`recordAgentInSwarm: swarm is decommissioned: ${swarmId}`);
    }
    if (record.agentIds.length >= record.maxAgents && !record.agentIds.includes(agentId)) {
      throw new Error(
        `recordAgentInSwarm: swarm ${swarmId} is at maxAgents (${record.maxAgents})`,
      );
    }
    if (!record.agentIds.includes(agentId)) {
      record.agentIds.push(agentId);
    }
    this.persist();
    return record;
  }

  decommissionSwarm(swarmId: string): SwarmRecord {
    if (swarmId === DEFAULT_SWARM_ID) {
      throw new Error("decommissionSwarm: cannot decommission the default swarm");
    }
    const record = this.swarms.get(swarmId);
    if (!record) {
      throw new Error(`decommissionSwarm: swarm not found: ${swarmId}`);
    }
    if (record.decommissionedAt) return record;
    record.decommissionedAt = new Date().toISOString();
    this.persist();
    return record;
  }

  /**
   * Test/dev helper: drop everything.
   */
  reset(): void {
    this.swarms.clear();
    this.defaultSeeded = false;
    if (this.persistPath && existsSync(this.persistPath)) {
      try { writeFileSync(this.persistPath, JSON.stringify({ version: 1, swarms: [] }, null, 2), "utf-8"); }
      catch { /* best-effort */ }
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Partial<PersistShape>;
      if (Array.isArray(data.swarms)) {
        for (const s of data.swarms) {
          if (!s || typeof s.swarmId !== "string") continue;
          this.swarms.set(s.swarmId, s);
          if (s.swarmId === DEFAULT_SWARM_ID) this.defaultSeeded = true;
        }
      }
    } catch {
      // Corrupt or partial file — start fresh.
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data: PersistShape = {
        version: 1,
        swarms: Array.from(this.swarms.values()),
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Persistence is best-effort.
    }
  }
}

/**
 * Process-wide singleton used by MCP tools. Persistence defaults to
 * `.harness/topology.json` in the current working directory.
 */
const _sharedRegistry = new SwarmTopologyRegistry({
  persistPath: ".harness/topology.json",
});

export function initSwarm(input: InitSwarmInput = {}): InitSwarmResult {
  return _sharedRegistry.initSwarm(input);
}

export function getSwarm(swarmId: string): SwarmRecord | undefined {
  return _sharedRegistry.getSwarm(swarmId);
}

export function listSwarms(): SwarmRecord[] {
  return _sharedRegistry.listSwarms();
}

export function recordAgentInSwarm(swarmId: string, agentId: string): SwarmRecord {
  return _sharedRegistry.recordAgentInSwarm(swarmId, agentId);
}

export function decommissionSwarm(swarmId: string): SwarmRecord {
  return _sharedRegistry.decommissionSwarm(swarmId);
}

/**
 * Process-wide singleton used by MCP tools. Tests should construct
 * their own `new SwarmTopologyRegistry()` to get an isolated, non-
 * persistent instance.
 */
export const swarmTopologyRegistry = _sharedRegistry;
