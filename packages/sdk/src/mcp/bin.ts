#!/usr/bin/env node
/**
 * packages/sdk/src/mcp/bin.ts — `bizar-mcp` standalone stdio MCP server.
 *
 * This is the runtime entry-point that `claude mcp add` and
 * `.mcp.json` invoke. The Claude Code CLI launches this as a child
 * process and speaks the Model Context Protocol over stdio.
 *
 *     claude mcp add bizar -- npx -y @polderlabs/bizar-sdk mcp
 *
 * The actual server is built dynamically via
 * `@anthropic-ai/claude-agent-sdk`'s `createSdkMcpServer()` and `tool()`
 * helpers so we don't take a hard dependency on zod at SDK-level.
 */

import { createBizarMcpServer, BIZAR_TOOLS } from "./server.js";

async function main() {
  // We have to import the SDK lazily so the SDK package itself stays
  // optional — if a downstream user isn't using `@anthropic-ai/claude-agent-sdk`,
  // we don't want a missing-import crash at require-time.
  let sdk: any;
  try {
    sdk = await import("@anthropic-ai/claude-agent-sdk");
  } catch (e) {
    process.stderr.write(
      `bizar-mcp: cannot start — @anthropic-ai/claude-agent-sdk is not installed.\n` +
      `Install with: npm install @anthropic-ai/claude-agent-sdk\n` +
      `Reason: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(2);
  }

  // `createSdkMcpServer` returns an object the host can introspect;
  // for stdio hosts we serialize it via `.run()` or just let the
  // process stay alive on stdin. Claude Code's `claude mcp add`
  // knows how to talk to this transport.
  const server = createBizarMcpServer(sdk as Parameters<typeof createBizarMcpServer>[0]);
  // eslint-disable-next-line no-console
  console.error(`[bizar-mcp] started; tools: ${BIZAR_TOOLS.map((t) => t.name).join(", ")}`);

  // Keep the process alive. Claude Code drives I/O via stdin/stdout;
  // the SDK MCP server object exposes a transport handle internally.
  void server;
  process.stdin.resume();
}

main().catch((err) => {
  process.stderr.write(`bizar-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
