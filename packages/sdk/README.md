# @polderlabs/bizar-sdk

Typed core primitives for Bizar Harness: agent registry, swarm topology, routing, bounded learning records, dangerous-pattern checks, federation, Byzantine consensus, and the Claude Code MCP server.

```ts
import { BIZAR_TOOLS, createBizarMcpServerConfig } from '@polderlabs/bizar-sdk/mcp';
```

The MCP surface contains nine local tools for plans, loops, graph queries, instincts, and decisions. It has no HTTP client and no note-vault API.
