/**
 * agent-registry.ts — in-process agent lifecycle registry (BizarAgentRegistry).
 *
 * F-032 — ported from ruflo `v3/@claude-flow/swarm/src/coordination/agent-registry.ts`
 * (lines 33, 127, 159, 268, 286). Bizar does not ship a full agent runtime;
 * the registry is a stateful, in-memory record of agent metadata that the MCP
 * tools can read/write. The Claude Code Agent SDK is the actual orchestrator;
 * this registry is a thin coordination surface for `agent_spawn`,
 * `agent_list`, and `agent_terminate`.
 *
 * No subprocess, no event bus. Heartbeat is a no-op stub that updates a
 * timestamp so downstream observers can poll liveness.
 *
 * Persistence is opt-in: pass `{ persistPath }` to the constructor (or
 * to the `bizarAgentRegistry` singleton via its mutator) and the registry
 * writes a JSON snapshot to disk after every mutation. This keeps the
 * in-process test path pure while letting the MCP singleton survive a
 * Claude Code session restart.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AgentStatus = "active" | "terminated";

/**
 * Bizar's typed-agent allowlist. Mirrors the six typed agents in
 * `config/agents/` (coder / tester / reviewer / system-architect /
 * planner / researcher) plus three ruflo-derived typed routes
 * (performance-engineer / security-auditor / memory-specialist).
 * `registerAgent` rejects anything outside this set so the MCP tools
 * surface a typed vocabulary callers can rely on.
 */
export const AGENT_TYPES = [
  "coder",
  "tester",
  "reviewer",
  "system-architect",
  "planner",
  "researcher",
  "performance-engineer",
  "security-auditor",
  "memory-specialist",
] as const;

export type AllowedAgentType = (typeof AGENT_TYPES)[number];

export function isAllowedAgentType(t: unknown): t is AllowedAgentType {
  return typeof t === "string" && (AGENT_TYPES as readonly string[]).includes(t);
}

export interface AgentRecord {
  agentId: string;
  type: AllowedAgentType;
  name?: string;
  status: AgentStatus;
  priority?: "low" | "normal" | "high" | "critical";
  metadata?: Record<string, unknown>;
  taskCount: number;
  createdAt: string;
  lastHeartbeatAt: string;
  terminatedAt?: string;
  terminationReason?: string;
  gracefulTermination?: boolean;
}

export interface RegisterAgentInput {
  type: string;
  name?: string;
  priority?: "low" | "normal" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentResult {
  agentId: string;
  status: AgentStatus;
}

export interface ListAgentsInput {
  status?: AgentStatus | "all";
  type?: string;
  limit?: number;
  offset?: number;
}

export interface ListAgentsResult {
  agents: AgentRecord[];
  total: number;
}

export interface TerminateAgentInput {
  agentId: string;
  reason?: string;
  graceful?: boolean;
}

export interface TerminateAgentResult {
  agentId: string;
  status: AgentStatus;
  terminatedAt: string;
}

export interface BizarAgentRegistryOpts {
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
  agents: AgentRecord[];
}

export class BizarAgentRegistry {
  private readonly agents: Map<string, AgentRecord> = new Map();
  private readonly seenIds: Set<string> = new Set();
  private persistPath?: string;

  constructor(opts: BizarAgentRegistryOpts = {}) {
    this.persistPath = opts.persistPath;
    if (this.persistPath) this.loadFromDisk();
  }

  /**
   * Configure (or clear) the persistence path after construction.
   * The next mutation will write a snapshot to the new location.
   */
  setPersistPath(path: string | undefined): void {
    this.persistPath = path;
    if (path) this.loadFromDisk();
  }

  /**
   * Generate a unique agent id of the form `agent-<uuid>`. Uses
   * `crypto.randomUUID()` so the IDs are stable across processes
   * and there is no retry loop on collision (UUID v4 has a 122-bit
   * random payload).
   */
  private nextAgentId(): string {
    const id = `agent-${randomUUID()}`;
    this.seenIds.add(id);
    return id;
  }

  registerAgent(input: RegisterAgentInput): RegisterAgentResult {
    if (!input || typeof input.type !== "string" || input.type.trim().length === 0) {
      throw new Error("registerAgent: `type` is required and must be a non-empty string");
    }
    if (!isAllowedAgentType(input.type)) {
      throw new Error(
        `registerAgent: \`type\` must be one of ${AGENT_TYPES.join(", ")}; got: ${input.type}`,
      );
    }
    const agentId = this.nextAgentId();
    const now = new Date().toISOString();
    const record: AgentRecord = {
      agentId,
      type: input.type,
      name: input.name,
      status: "active",
      priority: input.priority,
      metadata: input.metadata,
      taskCount: 0,
      createdAt: now,
      lastHeartbeatAt: now,
    };
    this.agents.set(agentId, record);
    this.persist();
    return { agentId, status: record.status };
  }

  listAgents(input: ListAgentsInput = {}): ListAgentsResult {
    const status = input.status ?? "all";
    const type = input.type;
    let filtered = Array.from(this.agents.values()).filter((a) => {
      if (status !== "all" && a.status !== status) return false;
      if (type && a.type !== type) return false;
      return true;
    });
    const total = filtered.length;
    const offset = Math.max(0, input.offset ?? 0);
    const limit = input.limit !== undefined ? Math.max(0, Math.min(1000, input.limit)) : 100;
    filtered = filtered.slice(offset, offset + limit);
    return { agents: filtered, total };
  }

  terminateAgent(input: TerminateAgentInput): TerminateAgentResult {
    if (!input || typeof input.agentId !== "string") {
      throw new Error("terminateAgent: `agentId` is required");
    }
    const record = this.agents.get(input.agentId);
    if (!record) {
      throw new Error(`terminateAgent: agent not found: ${input.agentId}`);
    }
    const terminatedAt = new Date().toISOString();
    record.status = "terminated";
    record.terminatedAt = terminatedAt;
    record.terminationReason = input.reason;
    record.gracefulTermination = input.graceful ?? true;
    record.lastHeartbeatAt = terminatedAt;
    this.persist();
    return { agentId: record.agentId, status: record.status, terminatedAt };
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this.agents.get(agentId);
  }

  /**
   * No-op heartbeat stub. Updates `lastHeartbeatAt` so callers can poll
   * liveness. Returns true if the agent was found.
   */
  heartbeat(agentId: string): boolean {
    const record = this.agents.get(agentId);
    if (!record) return false;
    if (record.status === "terminated") return false;
    record.lastHeartbeatAt = new Date().toISOString();
    this.persist();
    return true;
  }

  /**
   * Bump the per-agent task counter (used by orchestration callers).
   */
  incrementTaskCount(agentId: string, by = 1): number {
    const record = this.agents.get(agentId);
    if (!record) return 0;
    record.taskCount += by;
    this.persist();
    return record.taskCount;
  }

  /**
   * Test/dev helper: drop everything. Not exposed via MCP.
   */
  reset(): void {
    this.agents.clear();
    this.seenIds.clear();
    // Persistence: a reset should also wipe the file when configured,
    // so the next loadFromDisk starts clean.
    if (this.persistPath && existsSync(this.persistPath)) {
      try { writeFileSync(this.persistPath, JSON.stringify({ version: 1, agents: [] }, null, 2), "utf-8"); }
      catch { /* best-effort */ }
    }
  }

  /**
   * Total agents currently tracked (any status).
   */
  size(): number {
    return this.agents.size;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const data = JSON.parse(raw) as Partial<PersistShape>;
      if (Array.isArray(data.agents)) {
        for (const a of data.agents) {
          if (!a || typeof a.agentId !== "string") continue;
          this.agents.set(a.agentId, a);
          this.seenIds.add(a.agentId);
        }
      }
    } catch {
      // Corrupt or partial file — start fresh. A stale snapshot is
      // never worse than refusing to boot.
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data: PersistShape = {
        version: 1,
        agents: Array.from(this.agents.values()),
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Persistence is best-effort. The registry remains correct
      // in memory even if the disk write fails.
    }
  }
}

/**
 * Process-wide singleton used by MCP tools. Persistence defaults to
 * `.harness/agents.json` in the current working directory so the
 * registry survives a Claude Code session restart on the same machine.
 * Tests should construct their own `new BizarAgentRegistry()` to get
 * an isolated, non-persistent instance.
 */
export const bizarAgentRegistry = new BizarAgentRegistry({
  persistPath: ".harness/agents.json",
});
