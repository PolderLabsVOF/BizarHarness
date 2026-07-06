/**
 * plugins/bizar/src/tools/bg-resume.ts
 *
 * v5.x — `bizar_resume` tool. Sends SIGCONT to a paused background
 * agent's subprocess. Companion to {@link ./bg-pause.ts}.
 *
 * Odin-only.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgResumeDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export function createBgResumeTool(deps: BgResumeDeps) {
  return tool({
    description:
      "Resume a paused background agent by sending SIGCONT to its subprocess. " +
      "Only Odin may resume. No-op on already-running instances. POSIX only.",
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
              "Only Odin can resume background agents. Use bizar_status to inspect or ask Odin to resume.",
          }),
        };
      }
      const args = rawArgs as { instanceId: string };
      try {
        const result = await deps.instanceManager.resume(args.instanceId);
        if (!result.ok) {
          return {
            output: JSON.stringify({
              error: result.error || "resume failed",
              instanceId: args.instanceId,
            }),
          };
        }
        return {
          output: JSON.stringify({
            instanceId: args.instanceId,
            status: "running",
          }),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: resume(${args.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          output: JSON.stringify({
            error: `resume threw: ${err instanceof Error ? err.message : String(err)}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}
