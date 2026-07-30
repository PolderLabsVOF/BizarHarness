# Knowledge graph MCP tools

Bizar retains two read-only graph tools backed by a project-local
`.bizar/graph/graph.json` file:

| Tool | Purpose |
| --- | --- |
| `mcp__bizar__graph_query` | Substring search over graph nodes |
| `mcp__bizar__graph_path` | Shortest path between resolved nodes |

They are implemented in `packages/sdk/src/mcp/server.ts` and exercised by
`packages/sdk/tests/mcp-tools.test.ts`. If the graph file is absent or
invalid, the tools return a bounded error; they do not start a service or
contact a remote note store.

The graph is code-structure context, not the removed Bizar note-vault
system. No note creation, semantic note search, Obsidian integration, or
cross-session general memory API remains.
