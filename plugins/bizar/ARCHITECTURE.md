# plugins/bizar/ — Back-compat shim

> **v6.3.0+ — Claude Code-native shim.** This directory no longer
> hosts the Bizar plugin source. The full rewrite landed in
> v6.3.0; the actual SDK + MCP server + tool definitions now live
> in [`packages/sdk/`](../packages/sdk/).

This package exists for one reason: back-compat for users who
import from `@polderlabs/bizar-plugin` (the historical Cline plugin
npm name) or from the `plugins/bizar/index.ts` path. The package
publishes a thin re-export so legacy import sites keep resolving.

```
plugins/bizar/                                # this directory (back-compat shim)
├── index.ts                                  # Re-exports from @polderlabs/bizar-sdk
├── package.json                              # Declares deps + peer deps
├── tsconfig.json                             # Build config (matches SDK)
├── README.md                                 # User-facing shim doc
├── ARCHITECTURE.md                           # (this file)
├── CONSTRAINTS.md                            # Constraints that apply to the shim
└── LICENSE                                   # Apache-2.0
```

## What's actually in `@polderlabs/bizar-sdk`

The real engine is at
[`packages/sdk/src/`](../packages/sdk/src/) and exports, via
`packages/sdk/src/index.ts`:

- **Memory vault** (`memory/`) — Obsidian-compatible markdown notes.
- **Dangerous-pattern scanner** (`dangerous-patterns.ts`) — 36 safety patterns.
- **Tool-call fingerprint** (`fingerprint.ts`) — stable hash for loop-guard.
- **MCP server** (`mcp/server.ts`) — Claude Code MCP server exposing
  `BIZAR_TOOLS` (23 tools across memory / plan / loops / graph /
  agent swarm / router / consensus / federation).
- **Swarm topology** (`swarm-topology.ts`) — F-032 swarm primitives.
- **Agent registry** (`agent-registry.ts`) — subagent lifecycle MCP tools.
- **Consensus** (`consensus/`) — F-039 Byzantine fault-tolerant
  voting.
- **Federation** (`federation/`) — F-038 cross-installation agent
  envelopes with HMAC + nonce + PII + trust + policy + audit + budget.

## Why keep the plugin package at all?

- **Back-compat for legacy imports.** Scripts and dashboards that
  still `import { ... } from "@polderlabs/bizar-plugin"` (or from
  the old `./plugins/bizar/index.ts` entry) keep working.
- **Marketplace listings.** The `@polderlabs/bizar-plugin` npm
  package name continues to exist so marketplace references
  don't 404, but the package ships no source beyond the shim
  re-export.

Claude Code itself **never loads** this package. It registers the
MCP server via `.claude/mcp.json` → which resolves to the
`bin.ts` binary in `packages/sdk/src/mcp/bin.ts`.

## Verification

- `make check` — TS compile + tests (the shim is in the TS roots
  via the root `tsconfig.json` include globs).
- `make test` — unit tests live in `packages/sdk/tests/` and `cli/`,
  not here.
- `make e2e` — exercises the real MCP server and tool
  registrations.

## See also

- [`packages/sdk/ARCHITECTURE.md`](../packages/sdk/ARCHITECTURE.md)
  — the real engine layer.
- [`docs/architecture.md`](../docs/architecture.md) — layer model.
- [`docs/migration-guide.md`](../docs/migration-guide.md) — F-037
  entry describes why this directory became a shim.
