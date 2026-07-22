# DEC-010 — Knowledge graph query tools (bizar_graph_*)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @karen
**Related:** DEC-001

## Context

BizarHarness already has a project knowledge graph at
`.bizar/graph/graph.json` (built by `graphify`, 814 nodes in the
BizarHarness project). But the graph was **read-only** as far
as agents were concerned — they could `bizar graph query` via
the CLI, but there was no programmatic tool surface.

OpenFang exposes its knowledge graph via
`tool_knowledge_query` in
`crates/openfang-runtime/src/tool_runner.rs:2105-2140`.

## Decision

Add 3 tools to the plugin, all reading from
`.bizar/graph/graph.json`:

1. **`bizar_graph_query`** — substring search across node id,
   label, and source file. Returns up to 50 matching nodes.

2. **`bizar_graph_path`** — BFS shortest path between two
   nodes. Resolves from/to via exact id → exact label →
   substring (in priority order). Returns the path as an array
   of node ids + the resolved node details.

3. **`bizar_graph_explain`** — natural-language summary of a
   node with its immediate neighbors (in/out edges).

```ts
// plugins/bizar/src/tools/graph-query.ts
const graph = loadGraph(deps.worktree);  // reads .bizar/graph/graph.json
if (!graph) return { ok: false, error: "no_graph", message: "..." };

// For query: substring match
const matches = nodes.filter(n => nodeMatches(n, input.query));

// For path: BFS
const path = bfsPath(graph, fromNode.id, toNode.id);

// For explain: neighbors
const neighbors = edges
  .filter(e => e.source === target.id)
  .map(e => ({ node: nodes.find(n => n.id === e.target), relation: e.relation }));
```

## API

```ts
// Resolution priority:
//   1. Exact id match (preferred)
//   2. Exact label match
//   3. Substring match (last resort)
const resolveNode = (q: string): GraphNode | null => { ... };
```

## Consequences

### Positive

- Agents can query the project graph without leaving the
  plugin context.
- 3 new tools expose 814 existing nodes to agents.
- Path queries are useful for "how does module X relate to
  module Y" questions.

### Negative

- The graph is loaded on every tool call (no caching). For
  graphs with 100K+ nodes, this would be slow. v6.0.0 graphs
  are < 10K nodes; fine.
- The current BizarHarness graph has **0 edges**. Path queries
  return "no path" until edges are added by `graphify`.

### Neutral

- The 3 tools are always registered (no env var to disable).
  They're lightweight (read-only, no side effects).
- The dashboard's `Tasks.tsx` doesn't yet visualize the graph;
  that's a separate dashboard feature queued for v6.1.0.

## References

- `plugins/bizar/src/tools/graph-query.ts` (277 lines)
- `plugins/bizar/tests/safety.test.ts` — 3 unit tests
- OpenFang `crates/openfang-runtime/src/tool_runner.rs:2105-2140`
- `.bizar/graph/graph.json` — 814 nodes, 0 edges
- `research/agent-harness-survey/final-reports/02-openfang.md`
  § Knowledge Graph
