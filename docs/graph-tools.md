# Knowledge Graph Tools (`bizar_graph_*`)

> Three new tools that expose the project knowledge graph
> (`.bizar/graph/graph.json`, built by `graphify`) to agents.
> Source: `plugins/bizar/src/tools/graph-query.ts`.

> **v6.3.0 note:** These tools use the Claude Code MCP tool
> registration shape via `@anthropic-ai/claude-agent-sdk`
> (formerly `@cline/sdk` in v6.2.x). The tool input/output
> contract is unchanged.

## TL;DR

Three tools, all read-only, all backed by
`loadGraph(worktree)` which reads `.bizar/graph/graph.json`:

| Tool | Purpose | Use case |
| --- | --- | --- |
| `bizar_graph_query` | substring search | "find all code nodes that import X" |
| `bizar_graph_path` | BFS shortest path | "how does module A connect to module B" |
| `bizar_graph_explain` | node summary | "what is module X and what does it depend on" |

## API

### `bizar_graph_query`

```ts
input: {
  query: string;          // substring to match against id/label/source_file
  file_type?: string;     // optional filter ("code", "doc", ...)
  limit?: number;         // max results (default 20, max 50)
}

output: {
  ok: true,
  count: number,
  nodes: GraphNode[],     // matched nodes
  totalNodes: number,     // total in graph
}
```

Example:
```ts
const r = await tool.execute({ query: "auth" }, tCtx);
// r.nodes = [{ id: "auth_middleware", label: "AuthMiddleware", ... }, ...]
```

### `bizar_graph_path`

```ts
input: {
  from: string;  // source node id or label substring
  to: string;    // target node id or label substring
}

output: {
  ok: true,
  from: string,            // resolved id
  to: string,              // resolved id
  path: string[],          // array of node ids (BFS shortest)
  nodes: GraphNode[],      // hydrated path nodes
  hops: number,            // path.length - 1
}
```

Resolution priority:

1. **Exact id match** (preferred)
2. **Exact label match**
3. **Substring match** (last resort)

### `bizar_graph_explain`

```ts
input: {
  node: string;            // id or label substring
  maxNeighbors?: number;   // default 10, max 20
}

output: {
  ok: true,
  node: GraphNode,
  neighbors: Array<{ node: GraphNode; relation?: string }>,
  neighborCount: number,
}
```

## Edge cases

- **No graph file:** all three tools return
  `{ ok: false, error: "no_graph", message: "Run graphify to build it" }`.
- **No path found:** `bizar_graph_path` returns
  `{ ok: false, error: "no_path", message: "..." }`.
- **Ambiguous substring:** `bizar_graph_path` resolves to the
  first match (exact id → exact label → substring).

## Tests

`plugins/bizar/tests/safety.test.ts` (3 unit tests) — covers
synthetic graphs with 3 nodes / 2 edges. The current
BizarHarness graph (814 nodes, 0 edges) is exercised by the
E2E test in `/tmp/bh-full-e2e.mjs`.

## Current BizarHarness graph

- 814 nodes (mostly code symbols + docs)
- 0 edges (`graphify` produced no edges for this codebase)
- Path queries return "no path" until edges are added
- Query queries work fine

## v6.1.0 roadmap

- **Cache the loaded graph.** v6.0.0 re-reads the JSON file on
  every tool call. With 100K+ nodes, this would be slow.
- **Show team progress on the kanban.** Tasks.tsx consumes
  Claude Code agent team progress events (formerly
  Cline's `team_progress_projection`) to visualize team work
  flowing across columns.
- **Dashboard `Harness` view integration.** Surface
  graph-query results in the existing Harness dashboard.

## References

- [DEC-010](decisions/DEC-010-knowledge-graph-tools.md) — the
  decision that introduced the tools
- `plugins/bizar/src/tools/graph-query.ts` (277 lines)
- `plugins/bizar/tests/safety.test.ts` (3 unit tests)
- OpenFang `crates/openfang-runtime/src/tool_runner.rs:2105-2140`
- `research/agent-harness-survey/final-reports/02-openfang.md`
  § Knowledge Graph
