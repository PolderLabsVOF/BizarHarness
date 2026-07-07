/**
 * bg-kill.ts
 *
 * `bizar_kill` tool (v0.4.2 spec §1.5, §7.1, HIGH-4, MEDIUM-40).
 *
 * Odin-only — only Odin may kill background instances.
 *
 * Calls `POST /session/{id}/abort` (NOT `DELETE /session/{id}`). The
 * session record is preserved in cline for history; the running
 * loop is stopped.
 *
 * After abort, the next event for that session is `EventSessionIdle`
 * or `EventSessionError`. The plugin's event handler updates the
 * instance status; `bizar_kill` itself also stamps `status: "killed"`
 * synchronously so the caller gets immediate feedback.
 *
 * No-op on already-terminal instances (returns the current status).
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgKillDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export function createBgKillTool(deps: BgKillDeps) {
  return tool({
    description:
      "Kill a running background instance via POST /session/{id}/abort. " +
      "Only Odin may kill. No-op on already-terminal instances.",
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
              "Only Odin can kill background agents. Use bizar_status to inspect or ask Odin to kill.",
          }),
        };
      }
      const args = rawArgs as { instanceId: string };
      const inst = await deps.instanceManager.get(args.instanceId);
      if (!inst) {
        return {
          output: JSON.stringify({
            error: `instance not found`,
            instanceId: args.instanceId,
          }),
        };
      }
      try {
        await deps.instanceManager.kill(args.instanceId);
        // After kill, the in-memory state should be "killed". Re-read so
        // the caller sees the final status.
        const after = await deps.instanceManager.get(args.instanceId);
        return {
          output: JSON.stringify({
            instanceId: args.instanceId,
            status: after?.status ?? "killed",
          }),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: kill(${args.instanceId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          output: JSON.stringify({
            error: `kill failed: ${err instanceof Error ? err.message : String(err)}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}
