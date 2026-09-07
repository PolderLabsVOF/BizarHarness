/**
 * mcp/server.ts — Claude Code MCP server exposing Bizar tools.
 *
 * Claude Code loads these third-party tools through the Model Context
 * Protocol (MCP). This file
 * exports a single `createBizarMcpServer()` factory that wraps every
 * Bizar tool (plans, loops, graph, and learning) as an
 * MCP `tool()` definition, bundled into an SDK MCP server via the
 * `@anthropic-ai/claude-agent-sdk` `createSdkMcpServer()`.
 *
 * Usage from the SDK:
 *
 *     import { createBizarMcpServer } from "@polderlabs/bizar-sdk/mcp";
 *     import { query } from "@anthropic-ai/claude-agent-sdk";
 *
 *     for await (const msg of query({
 *       prompt: "Find the graph path to the sandbox command",
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
 * The retained registry covers planning, bounded loops, graph queries,
 * and compact learning summaries.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import { listInstincts } from "../learning/instincts.js";
import { listDecisions } from "../learning/decisions.js";
import {
  computeAmbiguity,
  type AmbiguityInput,
  type AmbiguityKind,
} from "../ambiguity/score.js";
import { validateBizplanHandoff, type BizplanHandoff } from "../handoff/bizplan.js";
import { DEEP_INTERVIEW_SCHEMA_VERSION } from "../specs/deep-interview.js";

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
 * avoids taking a hard dep on zod at SDK-level; the installer wraps this with real zod validation when wiring into
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

// Spawn the local `bizar` CLI with --json. Thin wrappers for the 5 agent-
// facing surfaces (task, workflow, control, audit, model list) so subagents
// can call them through MCP instead of shelling out. 30s ceiling keeps the
// MCP request from hanging on a stuck subprocess.
function runBizar(args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
  const r = spawnSync("bizar", [...args, "--json"], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return { ok: false, error: `bizar ${args.join(" ")} exited ${r.status}: ${r.stderr || r.stdout}` };
  return { ok: true, stdout: r.stdout };
}
function readJsonSafe<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

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
// Plan tools
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Loop tools
// ---------------------------------------------------------------------------

const BIZAR_HOME = process.env.BIZAR_HOME
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "bizar");
const LOOPS_DIR = process.env.BIZAR_LOOPS_DIR || join(BIZAR_HOME, "loops");

const loopListTool = defineTool<{ limit?: number }>(
  "loop_list",
  "List active and recent Bizar loops in the configured Bizar runtime store.",
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
  "Create a new Bizar loop for a Claude Code background agent to pick up.",
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
  "Mark a Bizar loop as stopped. Claude Code background agents halt on their next poll.",
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
// Agent-facing CLI wrappers (F-146) — thin local CLI shells.
// ---------------------------------------------------------------------------

function resolveOpenKanLauncher(): { command: string; prefix: string[] } | null {
  const home = process.env.HOME || homedir();
  const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const configuredHome = process.env.BIZAR_OPENKAN_HOME?.trim();
  const bizarHome = process.env.BIZAR_HOME?.trim() || join(configHome, "bizar");
  const homes = [
    configuredHome,
    join(bizarHome, "openkan"),
    join(configHome, "bizar", "openkan"),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  const configuredBin = process.env.BIZAR_OPENKAN_OK_BIN?.trim();
  const candidates = [
    configuredBin,
    ...homes.flatMap((root) => [
      join(root, "node_modules", "@polderlabs", "openkan", "bin", "ok.mjs"),
      join(root, "node_modules", "@polderlabs", "openkan", "bin", "ok.ts"),
      join(root, "bin", "ok.mjs"),
      join(root, "bin", "ok.ts"),
    ]),
  ].filter((value): value is string => value !== undefined && existsSync(value));
  const launcher = candidates[0];
  if (launcher) {
    return {
      command: process.execPath,
      prefix: launcher.endsWith(".ts") ? ["--experimental-strip-types", launcher] : [launcher],
    };
  }

  const delimiter = process.platform === "win32" ? ";" : ":";
  for (const directory of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const name of process.platform === "win32" ? ["ok.exe", "ok.cmd", "ok"] : ["ok"]) {
      const path = join(directory, name);
      if (existsSync(path)) return { command: path, prefix: [] };
    }
  }
  return null;
}

function runOpenKan(args: string[]): { ok: true; stdout: string } | { ok: false; error: string } {
  const launcher = resolveOpenKanLauncher();
  if (!launcher) return { ok: false, error: "OpenKan native CLI is not installed; run `bizar openkan install` once" };
  const r = spawnSync(launcher.command, [...launcher.prefix, ...args, "--json"], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: process.cwd(),
    env: process.env,
  });
  if (r.status !== 0) return { ok: false, error: `ok ${args.join(" ")} exited ${r.status}: ${r.stderr || r.stdout}` };
  return { ok: true, stdout: r.stdout };
}

// Forward action + arbitrary key/value args to native OpenKan `ok task`.
// Native actions: add, list, show, update, claim, heartbeat, complete,
// cancel, release. Legacy create/ready names are normalized below so the
// public MCP tool remains compatible without routing task state through Bizar.
const bizarTaskTool = defineTool<Record<string, string>>(
  "bizar_task",
  "OpenKan-native task tool. Runs `ok task <action> --json`; actions: add, list, show, update, claim, heartbeat, complete, cancel, release. Legacy create maps to add and ready maps to list --status pending. Pass other CLI flags (e.g. --title, --scope, --depends-on, --owner, --workspace, --lease-ms, --evidence, --reason) as string fields.",
  { action: "string" },
  async (args) => {
    try {
      const { action, ...rest } = args;
      if (!action) return err("missing action");
      const normalizedAction = action === "create" ? "add" : action;
      const flat: string[] = [normalizedAction];
      if (action === "ready" && !Object.hasOwn(rest, "status")) flat.push("--status", "pending");
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined || v === null || v === "") continue;
        flat.push(`--${k}`, String(v));
      }
      const r = runOpenKan(["task", ...flat]);
      if (!r.ok) return err(r.error);
      const parsed = readJsonSafe<unknown>(r.stdout);
      return ok(parsed !== null ? JSON.stringify(parsed) : r.stdout);
    } catch (e) { return err(String(e)); }
  },
);

// Forward action + args to `bizar workflow <action> --json`.
// Valid actions: start, status, resume, advance, fail, cancel.
const bizarWorkflowTool = defineTool<Record<string, string>>(
  "bizar_workflow",
  "Wrapper around `bizar workflow <action> --json`. Actions: start, status, resume, advance, fail, cancel. Pass CLI flags (e.g. --goal, --profile, --session, --run, --revision, --stage, --evidence, --reason) as string fields.",
  { action: "string" },
  async (args) => {
    try {
      const { action, ...rest } = args;
      if (!action) return err("missing action");
      const flat: string[] = [action];
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined || v === null || v === "") continue;
        flat.push(`--${k}`, String(v));
      }
      const r = runBizar(["workflow", ...flat]);
      if (!r.ok) return err(r.error);
      const parsed = readJsonSafe<unknown>(r.stdout);
      return ok(parsed !== null ? JSON.stringify(parsed) : r.stdout);
    } catch (e) { return err(String(e)); }
  },
);

// Forward action + args to `bizar control <action> --json`.
// Valid actions: snapshot, agents, tasks, sessions, messages, message.
const bizarControlTool = defineTool<Record<string, string>>(
  "bizar_control",
  "Wrapper around `bizar control <action> --json`. Actions: snapshot, agents, tasks, sessions, messages, message. Pass CLI flags (e.g. --agent, --session, --text, --from) as string fields.",
  { action: "string" },
  async (args) => {
    try {
      const { action, ...rest } = args;
      if (!action) return err("missing action");
      const flat: string[] = [action];
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined || v === null || v === "") continue;
        flat.push(`--${k}`, String(v));
      }
      const r = runBizar(["control", ...flat]);
      if (!r.ok) return err(r.error);
      const parsed = readJsonSafe<unknown>(r.stdout);
      return ok(parsed !== null ? JSON.stringify(parsed) : r.stdout);
    } catch (e) { return err(String(e)); }
  },
);

// `bizar audit --json` — single-shot wrapper, no action routing needed.
const bizarAuditTool = defineTool<Record<string, string>>(
  "bizar_audit",
  "Wrapper around `bizar audit --json`. Emits the structured audit report (issues, warnings, score) without human-formatted output.",
  {},
  async () => {
    try {
      const r = runBizar(["audit"]);
      if (!r.ok) return err(r.error);
      const parsed = readJsonSafe<unknown>(r.stdout);
      if (parsed !== null) return ok(JSON.stringify(parsed));
      // CLI did not honour --json; surface a structured error so callers
      // know the binary is on an older revision than this wrapper expects.
      return err(`bizar audit did not emit JSON; first chars: ${r.stdout.slice(0, 80)}`);
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// F-202 Phase 1 — OMX adoption scaffolding tools.
//
// These tools expose the new SDK primitives (ambiguity math, deep-
// interview spec status, ultragoal state, and the bizplan handoff
// contract) over MCP so downstream phases (2–5) can plug into a
// stable surface. They are read-only / forward-only and never
// mutate user-visible state on their own; persistence is delegated
// to the SDK + CLI primitives they wrap.
// ---------------------------------------------------------------------------

const ambiguityScoreTool = defineTool<{ input: string; kind?: string }>(
  "ambiguity_score",
  "Compute the weighted ambiguity score for a JSON-encoded clarity dimensions object. Pass `input` as a JSON object literal with dimension keys matching the chosen `kind` (`greenfield` or `brownfield`); values must be finite numbers in [0, 1]. Returns `{ score, breakdown, schemaVersion, kind }`.",
  { input: "string", kind: "string" },
  async ({ input, kind }) => {
    try {
      const parsed = JSON.parse(input) as AmbiguityInput;
      const resolvedKind: AmbiguityKind = kind === "brownfield" ? "brownfield" : "greenfield";
      const result = computeAmbiguity(parsed, resolvedKind);
      return ok(JSON.stringify({
        score: result.score,
        breakdown: result.breakdown,
        schemaVersion: result.schemaVersion,
        kind: result.kind,
      }));
    } catch (e) { return err(`ambiguity_score: ${e instanceof Error ? e.message : String(e)}`); }
  },
  { readOnlyHint: true },
);

// `deep_interview_status` — Phase 2 will replace the body with a real
// artifact lookup; the shape contract is locked here so downstream
// callers can build against the schema today. For Phase 1, the tool
// validates the slug and reports "no_spec" so it is observable from
// any session without fabricating fake artifacts.
const deepInterviewStatusTool = defineTool<{ slug: string }>(
  "deep_interview_status",
  `Look up a deep-interview spec by slug. Phase 1 returns the validation echo (\`{ spec: null, schemaVersion: "${DEEP_INTERVIEW_SCHEMA_VERSION}" }\`) when no spec artifact has been recorded yet; Phase 2 will hydrate the \`spec\` field from the persistent artifact at \`docs/specs/deep-interview-<slug>.md\`.`,
  { slug: "string" },
  async ({ slug }) => {
    try {
      if (typeof slug !== "string" || slug.trim().length === 0) {
        return err("deep_interview_status: slug must be a non-empty string");
      }
      return ok(JSON.stringify({
        spec: null,
        schemaVersion: DEEP_INTERVIEW_SCHEMA_VERSION,
      }));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const ultragoalStatusTool = defineTool<{ id: string }>(
  "ultragoal_status",
  "Look up the persistent ultragoal state for `id`. Phase 1 returns `{ state: null }` until the CLI command lands in Phase 4; the surface is reserved.",
  { id: "string" },
  async ({ id }) => {
    try {
      if (typeof id !== "string" || id.trim().length === 0) {
        return err("ultragoal_status: id must be a non-empty string");
      }
      return ok(JSON.stringify({ state: null }));
    } catch (e) { return err(String(e)); }
  },
  { readOnlyHint: true },
);

const ultragoalSteerTool = defineTool<{ id: string; action: string; payload: string }>(
  "ultragoal_steer",
  "Apply a steer action (`add_subgoal` or `split_subgoal`) to an ultragoal. Pass `payload` as a JSON object literal describing the change. Phase 1 reserves the surface; the response is `{ ok: true, deferred: true }` until the CLI lands in Phase 4.",
  { id: "string", action: "string", payload: "string" },
  async ({ id, action, payload }) => {
    try {
      if (typeof id !== "string" || id.trim().length === 0) {
        return err("ultragoal_steer: id must be a non-empty string");
      }
      if (action !== "add_subgoal" && action !== "split_subgoal") {
        return err(`ultragoal_steer: unknown action "${action}"`);
      }
      if (typeof payload !== "string") {
        return err("ultragoal_steer: payload must be a JSON string");
      }
      // Phase 1 reserves the surface; Phase 4 wires the real mutation.
      return ok(JSON.stringify({ ok: true, deferred: true }));
    } catch (e) { return err(String(e)); }
  },
);

const bizplanHandoffValidateTool = defineTool<{ input: string }>(
  "bizplan_handoff_validate",
  "Validate a Bizplan handoff payload. Pass `input` as a JSON object literal matching `BizplanHandoff`. Returns `{ ok: true }` or `{ ok: false, missing: [...] }` so callers can fix all required fields at once.",
  { input: "string" },
  async ({ input }) => {
    try {
      const parsed = JSON.parse(input) as BizplanHandoff;
      const result = validateBizplanHandoff(parsed);
      return ok(JSON.stringify(result));
    } catch (e) { return err(`bizplan_handoff_validate: ${e instanceof Error ? e.message : String(e)}`); }
  },
  { readOnlyHint: true },
);

// ---------------------------------------------------------------------------
// Factory — wire all tools into an MCP server
// ---------------------------------------------------------------------------

export const BIZAR_TOOLS: SdkMcpToolDef[] = [
  planActionTool,
  loopListTool,
  loopStatusTool,
  loopStartTool,
  loopStopTool,
  graphQueryTool,
  graphPathTool,
  listInstinctsTool,
  listDecisionsTool,
  // F-146 — agent-facing CLI wrappers
  bizarTaskTool,
  bizarWorkflowTool,
  bizarControlTool,
  bizarAuditTool,
  // F-202 Phase 1 — OMX adoption scaffolding tools.
  ambiguityScoreTool,
  deepInterviewStatusTool,
  ultragoalStatusTool,
  ultragoalSteerTool,
  bizplanHandoffValidateTool,
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
 * SDK. This is the runtime path used by `bin.ts`.
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
