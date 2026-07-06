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
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgPauseDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export function createBgPauseTool(deps: BgPauseDeps) {
  return tool({
    description:
      "Pause a running background agent by sending SIGSTOP to its subprocess. " +
      "Only Odin may pause. No-op on already-paused instances. " +
      "POSIX only — on Windows this returns an `unsupported_on_win32` error.",
    args: {
      instanceId: z
        .string()
        .min(1)
        .describe("Instance id returned by bizar_spawn_background."),
    },
    execute: async (rawArgs, ctx) => {
      if (ctx.agent !== "odin") {
        return {
          output: JSON.stringify({
            error:
              "Only Odin can pause background agents. Use bizar_status to inspect or ask Odin to pause.",
          }),
        };
      }
      const args = rawArgs as { instanceId: string };
      try {
        const result = await deps.instanceManager.pause(args.instanceId);
        if (!result.ok) {
          return {
            output: JSON.stringify({
              error: result.error || "pause failed",
              instanceId: args.instanceId,
            }),
          };
        }
        return {
          output: JSON.stringify({
            instanceId: args.instanceId,
            status: "paused",
          }),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: pause(${args.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          output: JSON.stringify({
            error: `pause threw: ${err instanceof Error ? err.message : String(err)}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}
