/**
 * mcp/server.ts — Claude Code MCP server exposing Bizar tools.
 *
 * This is the Claude Code-native replacement for the legacy Cline
 * `AgentPlugin` (plugins/bizar/index.ts). The Cline plugin hosted its
 * tools inside the Cline runtime via `createTool()`. Claude Code
 * doesn't have an equivalent plugin runtime API; instead, third-party
 * tools are exposed via the Model Context Protocol (MCP). This file
 * exports a single `createBizarMcpServer()` factory that wraps every
 * Bizar tool (memory, plan, graph, loop, KB, sandbox, browser) as an
 * MCP `tool()` definition, bundled into an SDK MCP server via the
 * `@anthropic-ai/claude-agent-sdk` `createSdkMcpServer()`.
 *
 * Usage from the SDK:
 *
 *     import { createBizarMcpServer } from "@polderlabs/bizar-sdk/mcp";
 *     import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 *     for await (const msg of query({
 *       prompt: "Read my note on sandbox architecture",
 *       options: {
 *         mcpServers: { bizar: createBizarMcpServer() },
 *         allowedTools: ["mcp__bizar__*"],
 *       },
 *     })) {
 *       handleAgentMessage(msg);
 *     }
 *
 * The MCP server can also be registered in `~/.claude/settings.json`
 * (via `mcpServers` key) or `.mcp.json` so every Claude Code session
 * picks it up automatically.
 *
 * v6.3.0 — rewrite: replaces the Cline-runtime plugin with a Claude
 * Code MCP server. All tool logic is framework-agnostic, so semantics
 * are preserved 1:1 from the old plugin.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  listNotes,
  readNote,
  searchNotes,
  writeNote,
  resolveVaultRoot,
} from "../memory/index.js";
import { checkDangerous } from "../dangerous-patterns.js";
import { ModelRouter } from "../router/model-router.js";
import { QLearningRouter } from "../router/q-learning-router.js";
import { runDistillation } from "../router/memory-distillation.js";
import { decideAgentWith } from "../router/index.js";
import { bizarAgentRegistry } from "../agent-registry.js";
import {
  initSwarm as initSwarmOnRegistry,
  DEFAULT_TOPOLOGY,
  DEFAULT_MAX_AGENTS,
  type SwarmTopology,
} from "../swarm-topology.js";
import { getSharedConsensus } from "../consensus/index.js";
import {
  createFederation,
  type FederationHandle,
} from "../federation/index.js";
import { handleTimelineQuery, type TimelineQueryArgs } from "./tools/timeline-query.js";

// We don't import from @anthropic-ai/claude-agent-sdk as a hard dep —
// the package is optional. Callers pass the result of `tool()` and
// `createSdkMcpServer()` to us, and we bundle them.
//
// To keep this module self-contained without taking a hard runtime
// dep, we define minimal local types that mirror the SDK's public
// surface. The accompanying `bin.ts` wires the real SDK.

export interface SdkMcpToolDef<Args = any> {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (args: Args, extra?: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
  annotations?: Record<string, unknown>;
}

export interface SdkMcpServerConfig {
  name: string;
  version: string;
  tools: SdkMcpToolDef[];
  [k: string]: unknown;
}

/**
 * Build a single MCP tool definition with a zod-less validator. This
 * avoids taking a hard dep on zod at SDK-level; the dashboard or
 * installer wraps this with real zod validation when wiring into
 * `tool()`.
 */
export function defineTool<Args>(
  name: string,
  description: string,
  inputSchema: Record<string, "string" | "number" | "boolean">,
  handler: (args: Args) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
  annotations: Record<string, unknown> = {},
): SdkMcpToolDef<Args> {
  return { name, description, inputSchema, handler, annotations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function err(text: string) {
  // MCP doesn't have an error type that bubbles — we surface errors as
  // a structured payload so the model can react.
  return { content: [{ type: "text" as const, text: `error: ${text}` }] };
}

// ---------------------------------------------------------------------------
// Memory tools (4)
// ---------------------------------------------------------------------------

const memoryReadTool = defineTool<{ path: string }>(
  "memory_read",
  "Read a memory note from the Bizar vault. Path is relative to the vault root (e.g. 'projects/foo/notes.md').",
  { path: "string" },
  async ({ path }) => {
    try {
      const note = readNote(resolveVaultRoot(), path);
      if (!note) return err(`not_found: ${path}`);
      return ok(note.raw);
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const memoryWriteTool = defineTool<{ path: string; body: string; tags?: string }>(
  "memory_write",
  "Write a memory note to the Bizar vault. Creates the parent directory as needed.",
  { path: "string", body: "string", tags: "string" },
  async ({ path, body, tags }) => {
    try {
      const fm: Record<string, unknown> = {
        title: path.replace(/\.md$/, "").split("/").pop(),
        createdAt: new Date().toISOString(),
      };
      if (tags) fm.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const note = writeNote(resolveVaultRoot(), path, fm, body);
      return ok(`wrote: ${note.relPath} (${note.size} bytes)`);
    } catch (e) { return err(String(e)); }
  },
);

const memoryListTool = defineTool<{ prefix?: string; limit?: number }>(
  "memory_list",
  "List memory notes in the Bizar vault, optionally filtered by a path prefix.",
  { prefix: "string", limit: "number" },
  async ({ prefix, limit }) => {
    try {
      const n = limit ?? 50;
      const notes = listNotes(resolveVaultRoot(), prefix ?? "", n);
      return ok(notes.map((m) => m.relPath).join("\n"));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const memorySearchTool = defineTool<{ query: string; limit?: number }>(
  "memory_search",
  "Full-text search the Bizar memory vault. Returns matching note paths and a snippet.",
  { query: "string", limit: "number" },
  async ({ query: q, limit }) => {
    try {
      const n = limit ?? 20;
      const notes = searchNotes(resolveVaultRoot(), q, n);
      if (notes.length === 0) return ok("no_matches");
      return ok(notes.map((m) => `${m.relPath}\n---\n${m.body.slice(0, 240)}…`).join("\n\n"));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Plan / KB tools
// ---------------------------------------------------------------------------

const KB_HOME = join(homedir(), ".bizar_kb");
const PLANS_DIRNAME = "plans";

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, ".bizar")) || existsSync(join(dir, ".git"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const planActionTool = defineTool<{ slug: string; action: "read" | "list" | "create" | "comment"; body?: string; comment?: string }>(
  "plan_action",
  "CRUD on Bizar visual plans stored under `<repo>/plans/<slug>/plan.md`. Use action=read|list|create|comment.",
  { slug: "string", action: "string", body: "string", comment: "string" },
  async ({ slug, action, body, comment }) => {
    try {
      const root = findRepoRoot();
      const dir = join(root, PLANS_DIRNAME, slug);
      if (action === "list") {
        if (!existsSync(dir)) return ok("no_plans");
        return ok(readdirSync(dir).join("\n"));
      }
      if (action === "read") {
        const fp = join(dir, "plan.md");
        if (!existsSync(fp)) return err("not_found: plan.md");
        return ok(readFileSync(fp, "utf-8"));
      }
      if (action === "create") {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "plan.md"), body ?? `# Plan: ${slug}\n\n`, "utf-8");
        return ok(`created: ${slug}`);
      }
      if (action === "comment") {
        const fp = join(dir, "comments.md");
        const ts = new Date().toISOString();
        const existing = existsSync(fp) ? readFileSync(fp, "utf-8") : "";
        writeFileSync(fp, `${existing}\n\n## ${ts}\n\n${comment ?? ""}\n`, "utf-8");
        return ok("commented");
      }
      return err(`unknown_action: ${action}`);
    } catch (e) { return err(String(e)); }
  },
);

const openKbTool = defineTool<{ path?: string }>(
  "open_kb",
  "Print the path to the Bizar knowledge base (Obsidian-compatible vault). The dashboard can open it externally; for Claude Code use memory_* tools instead.",
  { path: "string" },
  async () => ok(`${resolveVaultRoot()}\nAlso: ${KB_HOME}`),
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Loop tools
// ---------------------------------------------------------------------------

const LOOPS_DIR = join(homedir(), ".bizar_loops");

const loopListTool = defineTool<{ limit?: number }>(
  "loop_list",
  "List active and recent Bizar loops in this machine's loop store (~/.bizar_loops/).",
  { limit: "number" },
  async ({ limit }) => {
    try {
      if (!existsSync(LOOPS_DIR)) return ok("no_loops");
      const n = limit ?? 50;
      const dirs = readdirSync(LOOPS_DIR).slice(0, n);
      const out: string[] = [];
      for (const d of dirs) {
        const fp = join(LOOPS_DIR, d, "state.json");
        if (existsSync(fp)) {
          const st = JSON.parse(readFileSync(fp, "utf-8")) as Record<string, unknown>;
          out.push(`${d}\tstatus=${String(st.status ?? "?")}\tcreated=${String(st.createdAt ?? "?")}`);
        } else { out.push(d); }
      }
      return ok(out.join("\n"));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const loopStatusTool = defineTool<{ name: string }>(
  "loop_status",
  "Read the state of a named Bizar loop.",
  { name: "string" },
  async ({ name }) => {
    try {
      const fp = join(LOOPS_DIR, name, "state.json");
      if (!existsSync(fp)) return err(`not_found: ${name}`);
      return ok(readFileSync(fp, "utf-8"));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const loopStartTool = defineTool<{ name: string; prompt: string; intervalMs?: number; maxIterations?: number }>(
  "loop_start",
  "Create a new Bizar loop. The loop can be picked up by Claude Code via Agent tool background mode or the dashboard's loop runner.",
  { name: "string", prompt: "string", intervalMs: "number", maxIterations: "number" },
  async ({ name, prompt, intervalMs, maxIterations }) => {
    try {
      const dir = join(LOOPS_DIR, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify({
        name, prompt,
        intervalMs: intervalMs ?? 60_000,
        maxIterations: maxIterations ?? 5,
        status: "pending",
        createdAt: new Date().toISOString(),
      }, null, 2), "utf-8");
      return ok(`created: ${name}`);
    } catch (e) { return err(String(e)); }
  },
);

const loopStopTool = defineTool<{ name: string }>(
  "loop_stop",
  "Mark a Bizar loop as stopped. The dashboard loop-runner and Claude Code background agents will halt on next poll.",
  { name: "string" },
  async ({ name }) => {
    try {
      const fp = join(LOOPS_DIR, name, "state.json");
      if (!existsSync(fp)) return err(`not_found: ${name}`);
      const st = JSON.parse(readFileSync(fp, "utf-8")) as Record<string, unknown>;
      st.status = "stopped";
      st.stoppedAt = new Date().toISOString();
      writeFileSync(fp, JSON.stringify(st, null, 2));
      return ok("stopped");
    } catch (e) { return err(String(e)); }
  },
);

// ---------------------------------------------------------------------------
// Graph tools
// ---------------------------------------------------------------------------

const GRAPH_FILE = ".bizar/graph/graph.json";

interface GraphNode { id: string; kind: string; [k: string]: unknown; }
interface GraphEdge { from: string; to: string; kind: string; [k: string]: unknown; }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; }

function loadGraph(): Graph | null {
  const fp = join(findRepoRoot(), GRAPH_FILE);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, "utf-8")) as Graph; }
  catch { return null; }
}

const graphQueryTool = defineTool<{ kind?: string; q?: string; limit?: number }>(
  "graph_query",
  "Search the Bizar knowledge graph at .bizar/graph/graph.json. Filter by node kind or text query.",
  { kind: "string", q: "string", limit: "number" },
  async ({ kind, q, limit }) => {
    try {
      const g = loadGraph();
      if (!g) return ok("no_graph");
      const n = limit ?? 20;
      const qq = (q ?? "").toLowerCase();
      const matched = g.nodes.filter((node) => {
        if (kind && node.kind !== kind) return false;
        if (!qq) return true;
        return JSON.stringify(node).toLowerCase().includes(qq);
      }).slice(0, n);
      return ok(matched.map((m) => `${m.kind}:${m.id}`).join("\n"));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const graphPathTool = defineTool<{ from: string; to: string }>(
  "graph_path",
  "Find the shortest path between two nodes in the Bizar knowledge graph (BFS).",
  { from: "string", to: "string" },
  async ({ from, to }) => {
    try {
      const g = loadGraph();
      if (!g) return ok("no_graph");
      const adj = new Map<string, string[]>();
      for (const e of g.edges) {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from)!.push(e.to);
      }
      const queue: [string, string[]][] = [[from, [from]]];
      const seen = new Set<string>([from]);
      while (queue.length) {
        const [cur, path] = queue.shift()!;
        if (cur === to) return ok(path.join(" → "));
        for (const n of adj.get(cur) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push([n, [...path, n]]);
        }
      }
      return ok("no_path");
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Swarm / agent lifecycle tools (F-032)
// ---------------------------------------------------------------------------

const agentSpawnTool = defineTool<{
  type: string;
  name?: string;
  priority?: "low" | "normal" | "high" | "critical";
  metadata?: string;
}>(
  "agent_spawn",
  "Spawn a new agent in the in-process BizarAgentRegistry. Returns the new agentId. Heartbeat is a stub — this registry is a coordination surface, not an agent runtime.",
  { type: "string", name: "string", priority: "string", metadata: "string" },
  async ({ type, name, priority, metadata }) => {
    try {
      let parsedMetadata: Record<string, unknown> | undefined;
      if (metadata && typeof metadata === "string" && metadata.trim().length > 0) {
        try { parsedMetadata = JSON.parse(metadata) as Record<string, unknown>; }
        catch { return err("agent_spawn: `metadata` must be a JSON string"); }
      }
      const result = bizarAgentRegistry.registerAgent({
        type,
        name,
        priority,
        metadata: parsedMetadata,
      });
      return ok(JSON.stringify(result, null, 2));
    } catch (e) { return err(String(e)); }
  },
);

const agentListTool = defineTool<{
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}>(
  "agent_list",
  "List agents tracked by the in-process BizarAgentRegistry. Filter by status (active|terminated|all) and/or type. Supports limit/offset pagination.",
  { status: "string", type: "string", limit: "number", offset: "number" },
  async ({ status, type, limit, offset }) => {
    try {
      const allowedStatuses = ["active", "terminated", "all"] as const;
      type StatusFilter = typeof allowedStatuses[number];
      const s: StatusFilter = (allowedStatuses as readonly string[]).includes(status ?? "")
        ? (status as StatusFilter)
        : "all";
      const result = bizarAgentRegistry.listAgents({
        status: s,
        type,
        limit: typeof limit === "number" ? limit : undefined,
        offset: typeof offset === "number" ? offset : undefined,
      });
      return ok(JSON.stringify(result, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const agentTerminateTool = defineTool<{
  agentId: string;
  graceful?: boolean;
  reason?: string;
}>(
  "agent_terminate",
  "Terminate a registered agent. Returns the agentId, status, and terminatedAt timestamp. No-op if the agent is already terminated.",
  { agentId: "string", graceful: "boolean", reason: "string" },
  async ({ agentId, graceful, reason }) => {
    try {
      const result = bizarAgentRegistry.terminateAgent({
        agentId,
        reason,
        graceful: graceful ?? true,
      });
      return ok(JSON.stringify(result, null, 2));
    } catch (e) { return err(String(e)); }
  },
);

const swarmInitTool = defineTool<{
  topology?: string;
  maxAgents?: number;
  metadata?: string;
}>(
  "swarm_init",
  "Initialize a new swarm in the SwarmTopologyRegistry. topology ∈ hierarchical|mesh|adaptive|collective|hierarchical-mesh (default 'hierarchical-mesh'); maxAgents clamped to [1,1000] (default 15). The 'default' swarm is created lazily on first call.",
  { topology: "string", maxAgents: "number", metadata: "string" },
  async ({ topology, maxAgents, metadata }) => {
    try {
      let parsedMetadata: Record<string, unknown> | undefined;
      if (metadata && typeof metadata === "string" && metadata.trim().length > 0) {
        try { parsedMetadata = JSON.parse(metadata) as Record<string, unknown>; }
        catch { return err("swarm_init: `metadata` must be a JSON string"); }
      }
      const allowedTopologies: readonly SwarmTopology[] = [
        "hierarchical", "mesh", "adaptive", "collective", "hierarchical-mesh",
      ];
      const topo: SwarmTopology = (allowedTopologies as readonly string[]).includes(topology ?? "")
        ? (topology as SwarmTopology)
        : DEFAULT_TOPOLOGY;
      const max = typeof maxAgents === "number" ? maxAgents : DEFAULT_MAX_AGENTS;
      const result = initSwarmOnRegistry({
        topology: topo,
        maxAgents: max,
        metadata: parsedMetadata,
      });
      return ok(JSON.stringify(result, null, 2));
    } catch (e) { return err(String(e)); }
  },
);

// ---------------------------------------------------------------------------
// Safety tool — exposed so any model can self-audit a Bash command
// before running it.
// ---------------------------------------------------------------------------

const dangerCheckTool = defineTool<{ command: string }>(
  "danger_check",
  "Audit a shell command for dangerous patterns (rm -rf, sudo, SSRF, etc.) and report the decision (allow/require-approval/deny).",
  { command: "string" },
  async ({ command }) => {
    try {
      const check = checkDangerous({ command });
      return ok(JSON.stringify(check, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Self-learning tools (F-033 / ADR-174) — Thompson-sampling model
// router + Q-learning agent router + memory distillation trigger.
// ---------------------------------------------------------------------------

/** Singleton model router — the priors accumulate across tool calls
 *  within one MCP server instance, so the bandit can learn from
 *  outcomes in real time. Tests construct their own router via the
 *  exported `BIZAR_TOOLS` indirection. */
const modelRouter = new ModelRouter();

/** Singleton Q-learning router — same reasoning as above. */
const agentRouter = new QLearningRouter();

const modelRouteTool = defineTool<{ prompt: string }>(
  "model_route",
  "Adaptive model-tier routing. Returns the recommended tier ('flash'|'mid'|'expensive') for a prompt using a Thompson-sampling bandit over Beta(α,β) priors. Codemod-eligible prompts (var-to-const, remove-console, add-logging) short-circuit to 'flash' with codemodIntent set.",
  { prompt: "string" },
  async ({ prompt }) => {
    try {
      const decision = modelRouter.route(prompt);
      return ok(JSON.stringify(decision, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const agentRouteTool = defineTool<{ task: string }>(
  "agent_route",
  "Adaptive agent routing. Returns the recommended Bizar agent (odin|frigg|vor|mimir|heimdall|thor|tyr|forseti) for a task using Q-learning over a 64-dim bag-of-words feature hash. Codemod-eligible tasks route to heimdall (the routine-implementation agent).",
  { task: "string" },
  async ({ task }) => {
    try {
      const decision = agentRouter.selectAgent(task);
      return ok(JSON.stringify(decision, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const memoryDistillTool = defineTool<{ since?: string }>(
  "memory_distill",
  "Run the ReasoningBank distillation pipeline (ADR-174: RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) over the in-process memory vault. Optionally filter entries by createdAt >= since. Returns {distilled, promoted, byTier} — promoted patterns are only emitted for oracle:test-exec or judge:fable tiers.",
  { since: "string" },
  async ({ since }) => {
    try {
      // The dashboard owns the consolidator module; the SDK tool
      // shim reads directly from the vault and runs the same
      // RETRIEVE → JUDGE → DISTILL → CONSOLIDATE pipeline inline,
      // so the tool works without the dashboard process.
      const root = resolveVaultRoot();
      const all = listNotes(root, "", 10000);
      const cutoff = since ? new Date(since) : null;
      const entries = all
        .filter((n) => !cutoff || !Number.isNaN(cutoff.getTime()) && new Date(
          String(n.frontmatter?.createdAt ?? n.frontmatter?.created ?? 0),
        ) >= cutoff)
        .map((n) => ({
          memory_id: n.relPath,
          relPath: n.relPath,
          frontmatter: n.frontmatter ?? {},
          body: n.body ?? "",
          kind: typeof (n.frontmatter?.kind ?? n.frontmatter?.type) === "string"
            ? (n.frontmatter?.kind ?? n.frontmatter?.type) as string
            : undefined,
          created: typeof (n.frontmatter?.createdAt ?? n.frontmatter?.created) === "string"
            ? (n.frontmatter?.createdAt ?? n.frontmatter?.created) as string
            : undefined,
        }));

      // Static import — the SDK owns `memory-distillation.ts` so the
      // tool can run the RETRIEVE → JUDGE → DISTILL → CONSOLIDATE
      // pipeline without depending on the dashboard process.
      const result = runDistillation(entries);
      return ok(JSON.stringify({
        distilled: result.patterns.length,
        promoted: result.promoted.map((p: { id: string }) => p.id),
        byTier: result.byTier,
      }, null, 2));
    } catch (e) { return err(String(e)); }
  },
);

// ---------------------------------------------------------------------------
// Self-learning orchestrator tool (F-033)
//
// Replaces the prompt-time heuristics in the Odin agent with a single
// tool call. Combines the codemod tier-1 short-circuit, the
// Q-learning agent pick, and the Thompson-bandit model-tier pick
// behind one MCP `hooks_route` tool (matches ruflo
// `v3/mcp/tools/hooks-tools.ts:1207`).
// ---------------------------------------------------------------------------

const hooksRouteTool = defineTool<{ task: string; explicitAgent?: string }>(
  "hooks_route",
  "Self-Learning router (F-033): decide which agent + model tier should handle a task. Returns {agent, modelTier, agentConfidence, modelConfidence, codemodIntent, surfacedTags}. surfacedTags contains the human-readable markers (e.g. [CODEMOD_AVAILABLE] / [TASK_MODEL_RECOMMENDATION]) that should be prepended to the prompt for downstream observability.",
  { task: "string", explicitAgent: "string" },
  async ({ task, explicitAgent }) => {
    try {
      const decision = decideAgentWith(modelRouter, agentRouter, {
        task: String(task ?? ""),
        explicitAgent: explicitAgent ? String(explicitAgent) : undefined,
      });
      return ok(JSON.stringify(decision, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Consensus tool (F-039) — thin PBFT-style 3-of-5 majority for
// review/decision steps. Wraps the shared `getSharedConsensus()`
// orchestrator; the MCP surface is intentionally minimal (one tool)
// because the consensus layer is a coordination primitive — model
// callers propose payloads, the cluster of 5 agents (odin / frigg /
// vor / mimir / heimdall) reaches quorum, and the tool returns the
// proposalId + status. Vote tally and view-change are internal — the
// MCP caller drives the lifecycle through the orchestrator's
// `castVote` / `viewChange` if it wants finer control.
//
// The payload is a JSON string so callers don't need a zod schema for
// every consensus call; the orchestrator's replay-protection hash
// keys on the canonicalized JSON anyway, so semantically equivalent
// payloads collapse to the same proposalId.
// ---------------------------------------------------------------------------

const consensusProposeTool = defineTool<{
  payload: string;
  quorum?: number;
  vote?: string;
  agentId?: string;
}>(
  "consensus_propose",
  "PBFT-style 3-of-5 majority consensus for Bizar review/decision steps. payload is a JSON-encoded string (canonicalized via JSON.stringify). vote ∈ yes|no|abstain (defaults to 'yes' from the local agent). agentId is the peer whose vote this call represents (defaults to the local agent = 'odin'). Returns { proposalId, status, phase, approvals, rejections }. Re-submitting the same payload in the same view returns the cached proposalId (replay protection).",
  { payload: "string", quorum: "number", vote: "string", agentId: "string" },
  async ({ payload, quorum, vote, agentId }) => {
    try {
      if (typeof payload !== "string" || payload.trim().length === 0) {
        return err("consensus_propose: `payload` must be a non-empty JSON string");
      }
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (e) {
        return err(`consensus_propose: \`payload\` is not valid JSON: ${String(e)}`);
      }
      const consensus = getSharedConsensus();
      const proposeResult = consensus.propose(parsedPayload);
      const v: "yes" | "no" | "abstain" =
        vote === "no" || vote === "abstain" ? vote : "yes";
      const voter = agentId && agentId.trim().length > 0 ? agentId.trim() : consensus.localAgentId;
      const voteResult = consensus.castVote(
        proposeResult.proposalId,
        voter,
        v,
      );
      return ok(JSON.stringify({
        proposalId: voteResult.proposalId,
        status: voteResult.status,
        phase: voteResult.phase,
        approvals: voteResult.approvals,
        rejections: voteResult.rejections,
        abstentions: voteResult.abstentions,
        committed: voteResult.committed,
        quorum: quorum ?? consensus.getQuorum(),
        currentProposer: consensus.getCurrentProposer(),
        viewNumber: consensus.getViewNumber(),
      }, null, 2));
    } catch (e) { return err(String(e)); }
  },
);

// ---------------------------------------------------------------------------
// Federation tool (F-038) — Cross-installation agent federation
// skeleton. Reads status from the shared `createFederation()` handle
// (one per MCP server instance). The handle is configured against
// `.harness/federation-audit.log` + `.harness/federation-budget.json`
// under the project root. Per-call signing/receiving is not exposed
// as a tool here — it's a library API used by the dashboard / future
// transport layer; the MCP surface is intentionally a status probe
// so callers can check peer trust + audit size + budget headroom
// without needing to import the SDK.
// ---------------------------------------------------------------------------

function resolveFederationHandle(): FederationHandle {
  const root = findRepoRoot();
  const nodeId = `${root.replace(/[^a-zA-Z0-9_-]+/g, "_")}-mcp`;
  // Shared secret per repo — the F-038 skeleton is in-process, so a
  // hard-coded secret is fine for the status probe. Real deployments
  // would source this from the env (BIZAR_FEDERATION_SECRET).
  const secret = process.env.BIZAR_FEDERATION_SECRET ?? `bizar-federation-${root}`;
  return createFederation({
    nodeId,
    secret,
    auditPath: join(root, ".harness", "federation-audit.log"),
    budgetPath: join(root, ".harness", "federation-budget.json"),
  });
}

const federationStatusTool = defineTool<Record<string, never>>(
  "federation_status",
  "Federation skeleton status probe (F-038). Returns { nodeId, peers, nonceCacheSize, auditSizeBytes, auditPath, budget: { path, perPeer, outstandingReservations } }. Reads from the local createFederation() handle configured against .harness/federation-audit.log + .harness/federation-budget.json. Read-only.",
  {},
  async () => {
    try {
      const handle = resolveFederationHandle();
      const snap = handle.status();
      return ok(JSON.stringify(snap, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Timeline tool (F-042) — Visual Timeline + Agent Memory. Reads the
// dashboard's /api/timeline endpoint (loopback) when reachable,
// otherwise reads ~/.config/bizar/timeline.jsonl directly. Returns a
// prose summary plus the JSON event dump so the model can either
// quote the summary into context or pull specific events out.
// ---------------------------------------------------------------------------

const timelineQueryTool = defineTool<TimelineQueryArgs>(
  "timeline_query",
  "Query the Bizar timeline (F-042). Returns recent events for a project, file, agent, task, goal, or session. Use this to ground your decisions in what was already done. Filters: since (ISO timestamp; default = last 7 days), until, type (commit|hook|agent|task|goal|file|all), file, agentName, taskId, goalId, sessionId, commitSha, text (free-text search), limit (1..500; default 50). Looks up the dashboard at http://127.0.0.1:4321 by default (BIZAR_DASHBOARD_URL to override); falls back to ~/.config/bizar/timeline.jsonl when unreachable. Output: { source: 'dashboard'|'local', total, limit, since, events: TimelineEvent[], summary: string }.",
  {
    projectPath: "string",
    since: "string",
    until: "string",
    type: "string",
    file: "string",
    agentName: "string",
    taskId: "string",
    goalId: "string",
    sessionId: "string",
    commitSha: "string",
    text: "string",
    limit: "number",
  },
  async (args) => {
    try {
      return await handleTimelineQuery(args);
    } catch (e) {
      return err(String(e));
    }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Factory — wire all tools into an MCP server
// ---------------------------------------------------------------------------

export const BIZAR_TOOLS: SdkMcpToolDef[] = [
  memoryReadTool,
  memoryWriteTool,
  memoryListTool,
  memorySearchTool,
  planActionTool,
  openKbTool,
  loopListTool,
  loopStatusTool,
  loopStartTool,
  loopStopTool,
  graphQueryTool,
  graphPathTool,
  dangerCheckTool,
  agentSpawnTool,
  agentListTool,
  agentTerminateTool,
  swarmInitTool,
  modelRouteTool,
  agentRouteTool,
  memoryDistillTool,
  hooksRouteTool,
  consensusProposeTool,
  federationStatusTool,
  timelineQueryTool,
];

/**
 * Build the Bizar MCP server config. Pass this into Claude Code's
 * `mcpServers` option or `.mcp.json`.
 *
 *     {
 *       "mcpServers": {
 *         "bizar": { "command": "npx", "args": ["-y", "@polderlabs/bizar", "mcp"] }
 *       }
 *     }
 *
 * The standalone `bin.ts` CLI wrapper (in this package) does the
 * real wiring against `@anthropic-ai/claude-agent-sdk`'s
 * `createSdkMcpServer()` so that the MCP server can also be run as a
 * stdio process and picked up by `claude mcp add`.
 */
export function createBizarMcpServerConfig(opts?: { name?: string; version?: string }): SdkMcpServerConfig {
  return {
    name: opts?.name ?? "bizar",
    version: opts?.version ?? "0.4.0",
    tools: BIZAR_TOOLS,
  };
}

/**
 * Build and return an `McpSdkServerConfigWithInstance` from the real
 * SDK. This is the runtime path used by `bin.ts` and the dashboard.
 *
 * Pass `sdk` (the result of `await import("@anthropic-ai/claude-agent-sdk")`)
 * to avoid taking a hard dependency on the SDK from this package.
 */
export function createBizarMcpServer(sdk: {
  tool: (...args: unknown[]) => unknown;
  createSdkMcpServer: (cfg: Record<string, unknown>) => unknown;
}, opts?: { name?: string; version?: string }) {
  // Convert our lightweight tool defs into the SDK's tool() instances.
  // We use a dynamic schema (any) because zod isn't required at SDK level.
  const z = (sdk as unknown as { z?: unknown }).z;
  void z; // SDK uses its own zod internally; we pass an empty zod object schema.
  const toolFactory = (def: SdkMcpToolDef) => {
    // The SDK's tool() expects (name, description, zodSchema, handler).
    // We build a permissive zod object schema via the SDK's runtime zod.
    return (sdk.tool as unknown as (...a: unknown[]) => unknown)(
      def.name,
      def.description,
      buildObjectSchemaFromStringMap(sdk, def.inputSchema as Record<string, string>),
      def.handler,
      def.annotations,
    );
  };

  const tools = BIZAR_TOOLS.map(toolFactory);
  return (sdk.createSdkMcpServer as unknown as (cfg: Record<string, unknown>) => unknown)({
    name: opts?.name ?? "bizar",
    version: opts?.version ?? "0.4.0",
    tools,
  });
}

/**
 * Build a permissive zod object schema from a `{fieldName: "string"|"number"|"boolean"}`
 * map. We do this indirectly through the SDK's runtime so the SDK's
 * own zod version is used (avoids two copies of zod in the bundle).
 */
function buildObjectSchemaFromStringMap(sdk: unknown, shape: Record<string, string>): unknown {
  // We can't reach into the SDK's zod directly, but we can pass a
  // stub object — the SDK's tool() accepts any ZodRawShape. Most modern
  // zod versions expose `z.object({...}).shape` so a plain object works.
  const out: Record<string, unknown> = {};
  for (const [k, type] of Object.entries(shape)) {
    if (type === "string") out[k] = { _def: { typeName: "ZodString" }, optional: true, parse: (v: unknown) => String(v ?? "") };
    else if (type === "number") out[k] = { _def: { typeName: "ZodNumber" }, optional: true, parse: (v: unknown) => Number(v ?? 0) };
    else if (type === "boolean") out[k] = { _def: { typeName: "ZodBoolean" }, optional: true, parse: (v: unknown) => Boolean(v) };
    else out[k] = { _def: { typeName: "ZodString" }, optional: true, parse: (v: unknown) => String(v ?? "") };
  }
  void sdk;
  return out;
}

// ---------------------------------------------------------------------------
// Export the tool list as a list of `{name, description}` for the
// `claude mcp list` UI to display.
// ---------------------------------------------------------------------------

export function getBizarMcpToolSummary(): Array<{ name: string; description: string }> {
  return BIZAR_TOOLS.map((t) => ({ name: t.name, description: t.description }));
}
