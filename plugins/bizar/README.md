# @polderlabs/bizar-plugin

> **Back-compat shim for the Claude Code-native Bizar.**
> New code should depend on
> [`@polderlabs/bizar-sdk`](../packages/sdk/) directly.

This package is a thin re-export of `@polderlabs/bizar-sdk`. It
exists so that any code still importing from
`@polderlabs/bizar-plugin` (the historical Cline-plugin name)
or from `plugins/bizar/index.ts` keeps resolving.

## What ships in this package

| File | Purpose |
| --- | --- |
| `package.json` | Declares `@polderlabs/bizar-sdk` as a dependency + `@anthropic-ai/claude-agent-sdk` as an optional peer dep. |
| `index.ts` | Re-exports the SDK public surface: memory vault, dangerous-pattern scanner, fingerprint, MCP server factory, consensus, federation, swarm topology, agent registry. |
| `tsconfig.json` | Mirrors the SDK build config (ES2022, strict, ESNext modules). |
| `LICENSE` | Apache-2.0. |

No Cline-era source (`src/clineruntime.ts`, `src/hooks/`,
`src/tools/*`) remains in this package. That code was removed
in v6.5.0 (F-037) once the v6.3.0 Claude Code migration
stabilized.

## What you should import instead

```ts
// Preferred — Claude Code MCP server is the only tool surface now.
import { createBizarMcpServer, BIZAR_TOOLS } from "@polderlabs/bizar-sdk";
import { readNote, writeNote, searchNotes } from "@polderlabs/bizar-sdk/memory";
import { checkDangerous } from "@polderlabs/bizar-sdk/dangerous-patterns";

// Still works — back-compat alias for the shim package name.
import { createBizarMcpServer } from "@polderlabs/bizar-plugin";
```

Claude Code itself never loads this package. The host loads
the MCP server binary at `packages/sdk/src/mcp/bin.ts` via
`.claude/mcp.json`. See
[`docs/migration-guide.md`](../docs/migration-guide.md) for the
v6.3.0 → v6.5.0 history.

## License

Apache-2.0. See [LICENSE](./LICENSE).
