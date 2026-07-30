# DEC-010 — Read-only code graph tools

**Status:** Accepted and revised 2026-07-30

## Decision

Retain `graph_query` and `graph_path` as bounded read-only MCP tools in
`packages/sdk/src/mcp/server.ts`. They read a project-local
`.bizar/graph/graph.json` and return structured results or an explicit
missing/invalid graph error.

These tools describe code structure. They are not part of the removed
general note-vault system and expose no note write, note search,
Obsidian, LightRAG, or remote service behavior.

## Verification

`packages/sdk/tests/mcp-tools.test.ts` pins the tool registry and graph
behavior. `scripts/verify-removed-surfaces.mjs` prevents the removed
note-vault concepts from returning.
