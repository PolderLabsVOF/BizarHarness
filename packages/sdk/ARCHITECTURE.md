# packages/sdk/ — Architecture

> TypeScript SDK for the Bizar Harness. Provides the Claude Code MCP
> server, memory vault, dangerous-pattern scanner, tool-call fingerprint,
> and shared helpers consumed by both the dashboard and the runtime.
> This is the only entry point into Bizar for Claude Code; the legacy
> Cline plugin runtime has been removed (v6.3.0).

## Top-level layout

```
packages/sdk/
├── src/
│   ├── index.ts                   # Public API surface (re-exports)
│   ├── mcp/
│   │   ├── server.ts              # createBizarMcpServer / BIZAR_TOOLS
│   │   └── bin.ts                 # stdio MCP server entry (bizar-mcp)
│   ├── memory/
│   │   └── index.ts               # Obsidian-compatible vault helpers
│   ├── dangerous-patterns.ts      # 36-pattern destructive-command scanner
│   └── fingerprint.ts             # Tool-call fingerprint (SHA256)
└── package.json
```

## Public contract

```ts
import {
  // Memory vault (Obsidian-compatible markdown)
  readNote, writeNote, listNotes, searchNotes,
  // Dangerous-pattern scanner
  checkDangerous, listDangerousPatterns,
  // Tool-call fingerprint
  fingerprint,
  // MCP server (Claude Code's only path into the SDK)
  createBizarMcpServer, BIZAR_TOOLS,
} from "@polderlabs/bizar-sdk";
```

## Key invariants

- This package is consumed **only** by the `bizar-mcp` stdio binary
  (registered in `~/.claude/settings.json`) and by `plugins/bizar`
  (back-compat shim that re-exports the SDK surface).
- Claude Code has no in-process plugin API; MCP servers are the
  sole integration path. Anything that previously required Cline's
  `AgentPlugin` is now expressed as MCP tools or skills.
- Memory vault is plain markdown with YAML frontmatter; the SDK
  provides typed read/write/list/search so the dashboard, hooks,
  and MCP tools all use the same backend.
- Discriminated error model for memory + dangerous-pattern results
  (`{ ok: true, data } | { ok: false, error }`).

## Versioning

- `@polderlabs/bizar-sdk` follows semver.
- Current: `0.4.0` (Claude Code-native; MCP-first).

## Verification

- `make check` — TS compile + vitest
- `make test` — vitest over the SDK
- `bun run packages/sdk/src/mcp/bin.ts` — smoke test the MCP server

## See also

- [docs/architecture.md](../../docs/architecture.md) — layer model
- [@polderlabs/bizar-sdk on npm](https://www.npmjs.com/package/@polderlabs/bizar-sdk)
- [docs/migration-guide.md](../../docs/migration-guide.md) — v6.3.0
  Claude Code migration