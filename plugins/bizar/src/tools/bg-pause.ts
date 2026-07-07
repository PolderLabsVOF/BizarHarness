/**
 * plugins/bizar/src/tools/bg-pause.ts
 *
 * v5.x — `bizar_pause` tool. Sends SIGSTOP to a running background
 * agent's subprocess (POSIX only). The InstanceManager flips the
 * in-memory status to `"paused"` and persists the change.
 *
 * The companion tool `bizar_resume` ({@link ./bg-resume.ts}) reverses
 * the action via SIGCONT.
 *
 * Odin-only — same auth model as the rest of the bg tools.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_PAUSE_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, instanceId, status }` instead of
 *     `{ output: JSON.stringify(...) }`.
 *   - `ctx.agent` becomes `context.metadata.parentAgent` look-up.
 */
import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export const BIZAR_PAUSE_TOOL_NAME = "bizar_pause";

export interface BgPauseDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarPauseInput = z.infer<typeof bizarPauseSchema>;
export type BizarPauseOutput =
  | { ok: true; instanceId: string; status: string }
  | { ok: false; error: string; instanceId?: string };

const bizarPauseSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("Instance id returned by bizar_spawn_background."),
});

/**
 * Build the `bizar_pause` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the InstanceManager.
 */
export function createBgPauseTool(
  deps: BgPauseDeps,
): AgentTool<BizarPauseInput, BizarPauseOutput> {
  return createTool({
    name: BIZAR_PAUSE_TOOL_NAME,
    description:
      "Pause a running background agent by sending SIGSTOP to its subprocess. " +
      "Only Odin may pause. No-op on already-paused instances. " +
      "POSIX only — on Windows this returns an `unsupported_on_win32` error.",
    inputSchema: bizarPauseSchema.shape,
    execute: async (input, context) => {
      const parentAgent =
        (context.metadata as { parentAgent?: string } | undefined)?.parentAgent ?? null;
      if (parentAgent !== "odin") {
        return {
          ok: false as const,
          error:
            "Only Odin can pause background agents. Use bizar_status to inspect or ask Odin to pause.",
        };
      }
      try {
        const result = await deps.instanceManager.pause(input.instanceId);
        if (!result.ok) {
          return {
            ok: false as const,
            error: result.error || "pause failed",
            instanceId: input.instanceId,
          };
        }
        return {
          ok: true as const,
          instanceId: input.instanceId,
          status: "paused",
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: pause(${input.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          ok: false as const,
          error: `pause threw: ${err instanceof Error ? err.message : String(err)}`,
          instanceId: input.instanceId,
        };
      }
    },
  });
}
