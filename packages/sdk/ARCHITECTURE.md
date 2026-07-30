# SDK architecture

`src/index.ts` exports the stable core modules. `src/mcp/server.ts` adapts nine local handlers into Agent SDK MCP definitions without taking a hard Agent SDK dependency. `src/mcp/bin.ts` is the stdio executable. Router and learning modules support bounded autonomous adaptation; federation and consensus remain library primitives rather than always-on services.

The SDK must stay independent of UI, local web services, and project installer code.
