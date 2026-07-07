/**
 * graph-query.ts — v6.0.0 knowledge graph query tool.
 *
 * Exposes `.bizar/graph/graph.json` (the project knowledge graph built
 * by `graphify`) to agents as a queryable tool surface.
 *
 * Patterns from:
 *   - Hermes Agent `tools/graph_query.py`
 *   - OpenFang `crates/openfang-runtime/src/tool_runner.rs:2105-2140`
 *     (the `tool_knowledge_query` reference)
 *
 * Three queries:
 *   - `bizar_graph_query`  — search for a node by label or substring
 *   - `bizar_graph_path`   — shortest path between two nodes
 *   - `bizar_graph_explain` — natural-language summary of a node
 *
 * The graph lives at `<worktree>/.bizar/graph/graph.json`. If the file
 * doesn't exist, the tool returns an empty result (graceful fallback).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";

export const BIZAR_GRAPH_QUERY_TOOL_NAME = "bizar_graph_query";
export const BIZAR_GRAPH_PATH_TOOL_NAME = "bizar_graph_path";
export const BIZAR_GRAPH_EXPLAIN_TOOL_NAME = "bizar_graph_explain";

export interface GraphQueryDeps {
  worktree: string;
  logger: Logger;
}

interface GraphNode {
  id: string;
  label?: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
  [k: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  relation?: string;
  [k: string]: unknown;
}

interface GraphData {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

const MAX_NODES = 50;
const MAX_NEIGHBORS = 20;

function loadGraph(worktree: string): GraphData | null {
  const path = join(worktree, ".bizar", "graph", "graph.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GraphData;
  } catch {
    return null;
  }
}

/** Case-insensitive substring match against node id + label. */
function nodeMatches(node: GraphNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.id.toLowerCase().includes(q)) return true;
  if (node.label && node.label.toLowerCase().includes(q)) return true;
  if (node.source_file && node.source_file.toLowerCase().includes(q)) return true;
  return false;
}

/** BFS to find the shortest path from source to target (undirected). */
function bfsPath(graph: GraphData, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adjacency = new Map<string, Set<string>>();
  for (const n of graph.nodes ?? []) {
    if (!adjacency.has(n.id)) adjacency.set(n.id, new Set());
  }
  for (const e of graph.edges ?? []) {
    adjacency.get(e.source)?.add(e.target);
    if (!graph.directed) adjacency.get(e.target)?.add(e.source);
  }
  const visited = new Set<string>([from]);
  const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    const neighbors = adjacency.get(node) ?? new Set();
    for (const nb of neighbors) {
      if (nb === to) return [...path, nb];
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push({ node: nb, path: [...path, nb] });
      }
    }
  }
  return null;
}

// ── query ────────────────────────────────────────────────────────────────
export type BizarGraphQueryInput = z.infer<typeof bizarGraphQuerySchema>;
export type BizarGraphQueryOutput =
  | { ok: true; count: number; nodes: GraphNode[]; totalNodes: number }
  | { ok: false; error: string; message: string };

const bizarGraphQuerySchema = z.object({
  query: z.string().min(1).describe("Substring to search for (matches node id, label, source file)."),
  file_type: z.string().optional().describe("Optional filter by file_type (e.g. 'code', 'doc')."),
  limit: z.number().int().positive().optional().describe("Max results to return (default 20, max 50)."),
});

export function createGraphQueryTool(
  deps: GraphQueryDeps,
): AgentTool<BizarGraphQueryInput, BizarGraphQueryOutput> {
  return createTool({
    name: BIZAR_GRAPH_QUERY_TOOL_NAME,
    description:
      "Query the project knowledge graph for nodes matching a substring. " +
      "Searches node id, label, and source file. Returns up to N matching nodes. " +
      "The graph is built by `graphify` and lives at .bizar/graph/graph.json.",
    inputSchema: bizarGraphQuerySchema.shape,
    execute: async (input) => {
      const graph = loadGraph(deps.worktree);
      if (!graph) {
        return { ok: false as const, error: "no_graph", message: "No knowledge graph found at .bizar/graph/graph.json. Run `graphify` to build it." };
      }
      const nodes = graph.nodes ?? [];
      const limit = Math.min(input.limit ?? 20, MAX_NODES);
      const fileType = input.file_type;
      const matches: GraphNode[] = [];
      for (const n of nodes) {
        if (fileType && n.file_type !== fileType) continue;
        if (nodeMatches(n, input.query)) {
          matches.push(n);
          if (matches.length >= limit) break;
        }
      }
      return { ok: true as const, count: matches.length, nodes: matches, totalNodes: nodes.length };
    },
  });
}

// ── path ─────────────────────────────────────────────────────────────────
export type BizarGraphPathInput = z.infer<typeof bizarGraphPathSchema>;
export type BizarGraphPathOutput =
  | { ok: true; from: string; to: string; path: string[]; nodes: GraphNode[]; hops: number }
  | { ok: false; error: string; message: string };

const bizarGraphPathSchema = z.object({
  from: z.string().min(1).describe("Source node id or label substring."),
  to: z.string().min(1).describe("Target node id or label substring."),
});

export function createGraphPathTool(
  deps: GraphQueryDeps,
): AgentTool<BizarGraphPathInput, BizarGraphPathOutput> {
  return createTool({
    name: BIZAR_GRAPH_PATH_TOOL_NAME,
    description:
      "Find the shortest path between two nodes in the project knowledge graph. " +
      "Accepts substrings for from/to (resolves to the first matching node). " +
      "Returns the path as an array of node ids and the resolved node details.",
    inputSchema: bizarGraphPathSchema.shape,
    execute: async (input) => {
      const graph = loadGraph(deps.worktree);
      if (!graph) {
        return { ok: false as const, error: "no_graph", message: "No knowledge graph found at .bizar/graph/graph.json. Run `graphify` to build it." };
      }
      const nodes = graph.nodes ?? [];
      // Resolve from/to to first matching node id
      const resolveNode = (q: string): GraphNode | null => {
        // 1. Exact id match (preferred)
        for (const n of nodes) if (n.id === q) return n;
        // 2. Exact label match
        for (const n of nodes) if (n.label === q) return n;
        // 3. Substring match (last resort)
        for (const n of nodes) if (nodeMatches(n, q)) return n;
        return null;
      };
      const fromNode = resolveNode(input.from);
      const toNode = resolveNode(input.to);
      if (!fromNode) {
        return { ok: false as const, error: "from_not_found", message: `No node matches '${input.from}'` };
      }
      if (!toNode) {
        return { ok: false as const, error: "to_not_found", message: `No node matches '${input.to}'` };
      }
      const path = bfsPath(graph, fromNode.id, toNode.id);
      if (!path) {
        return { ok: false as const, error: "no_path", message: `No path from '${fromNode.id}' to '${toNode.id}' (graph may have no edges between them)` };
      }
      // Hydrate the path with node details
      const idToNode = new Map(nodes.map((n) => [n.id, n]));
      const pathNodes: GraphNode[] = [];
      for (const id of path) {
        const n = idToNode.get(id);
        if (n) pathNodes.push(n);
      }
      return {
        ok: true as const,
        from: fromNode.id,
        to: toNode.id,
        path,
        nodes: pathNodes,
        hops: path.length - 1,
      };
    },
  });
}

// ── explain ──────────────────────────────────────────────────────────────
export type BizarGraphExplainInput = z.infer<typeof bizarGraphExplainSchema>;
export type BizarGraphExplainOutput =
  | {
      ok: true;
      node: GraphNode;
      neighbors: Array<{ node: GraphNode; relation?: string }>;
      neighborCount: number;
    }
  | { ok: false; error: string; message: string };

const bizarGraphExplainSchema = z.object({
  node: z.string().min(1).describe("Node id or label substring to explain."),
  maxNeighbors: z.number().int().positive().optional().describe("Max neighbors to show (default 10, max 20)."),
});

export function createGraphExplainTool(
  deps: GraphQueryDeps,
): AgentTool<BizarGraphExplainInput, BizarGraphExplainOutput> {
  return createTool({
    name: BIZAR_GRAPH_EXPLAIN_TOOL_NAME,
    description:
      "Explain a node in the project knowledge graph — what it is, where " +
      "it's defined, and its immediate neighbors (in/out edges). Accepts " +
      "substring matching for the node id or label.",
    inputSchema: bizarGraphExplainSchema.shape,
    execute: async (input) => {
      const graph = loadGraph(deps.worktree);
      if (!graph) {
        return { ok: false as const, error: "no_graph", message: "No knowledge graph found at .bizar/graph/graph.json. Run `graphify` to build it." };
      }
      const nodes = graph.nodes ?? [];
      const target = nodes.find((n) => n.id === input.node || n.label === input.node)
        ?? nodes.find((n) => nodeMatches(n, input.node));
      if (!target) {
        return { ok: false as const, error: "not_found", message: `No node matches '${input.node}'` };
      }
      const max = Math.min(input.maxNeighbors ?? 10, MAX_NEIGHBORS);
      const neighbors: Array<{ node: GraphNode; relation?: string }> = [];
      for (const e of graph.edges ?? []) {
        if (e.source === target.id) {
          const n = nodes.find((x) => x.id === e.target);
          if (n) neighbors.push({ node: n, relation: e.relation });
        } else if (!graph.directed && e.target === target.id) {
          const n = nodes.find((x) => x.id === e.source);
          if (n) neighbors.push({ node: n, relation: e.relation });
        }
        if (neighbors.length >= max) break;
      }
      return {
        ok: true as const,
        node: target,
        neighbors,
        neighborCount: neighbors.length,
      };
    },
  });
}
