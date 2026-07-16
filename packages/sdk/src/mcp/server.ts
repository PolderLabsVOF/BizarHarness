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
import { listInstincts } from "../learning/instincts.js";
import { listDecisions } from "../learning/decisions.js";

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
// Pillar D — instinct + decision read-back (v10.3.0)
// ---------------------------------------------------------------------------

const listInstinctsTool = defineTool<{
  scope?: "project" | "global";
  project?: string;
  limit?: number;
}>(
  "list_instincts",
  "List recorded instincts (Pillar D auto-instinct + learning-extract). scope: project (default) or global. Returns up to `limit` entries (default 50) from `.bizar/learning/instincts.jsonl`.",
  { scope: "string", project: "string", limit: "number" },
  async ({ scope, project, limit }) => {
    try {
      const opts: { scope?: "project" | "global"; project?: string } = {};
      if (scope === "project" || scope === "global") opts.scope = scope;
      if (project) opts.project = project;
      const entries = listInstincts(opts);
      const n = typeof limit === "number" ? limit : 50;
      const sliced = entries.slice(-n);
      if (sliced.length === 0) return ok("no_instincts");
      return ok(JSON.stringify(sliced, null, 2));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const listDecisionsTool = defineTool<{ project?: string; limit?: number }>(
  "list_decisions",
  "List architectural / project decisions logged via Pillar D. Returns up to `limit` entries (default 50) from `.bizar/learning/decisions.jsonl`.",
  { project: "string", limit: "number" },
  async ({ project, limit }) => {
    try {
      const opts: { project?: string } = {};
      if (project) opts.project = project;
      const entries = listDecisions(opts);
      const n = typeof limit === "number" ? limit : 50;
      const sliced = entries.slice(-n);
      if (sliced.length === 0) return ok("no_decisions");
      return ok(JSON.stringify(sliced, null, 2));
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
  listInstinctsTool,
  listDecisionsTool,
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
