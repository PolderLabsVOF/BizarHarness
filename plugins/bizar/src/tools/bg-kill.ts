/**
 * bg-kill.ts
 *
 * `bizar_kill` tool (v0.4.2 spec §1.5, §7.1, HIGH-4, MEDIUM-40).
 *
 * Odin-only — only Odin may kill background instances.
 *
 * v5.5.x — Calls `cline.abort(sessionId)` on the in-process `ClineCore`
 * (Phase 2/3 in-process refactor). The session record is preserved in
 * Cline for history; the running loop is stopped.
 *
 * After abort, the next event for that session is the corresponding
 * agent runtime event. The plugin's `afterTool` hook updates the
 * instance status; `bizar_kill` itself also stamps `status: "killed"`
 * synchronously so the caller gets immediate feedback.
 *
 * No-op on already-terminal instances (returns the current status).
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_KILL_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, instanceId, status }` instead of
 *     `{ output: JSON.stringify(...) }`.
 *   - `ctx.agent` from OpenCode becomes `agentId`-derived role check
 *     via the runtime metadata; Cline does not surface `agent` on
 *     `AgentToolContext`, so the InstanceManager encodes the role on
 *     each instance and we check there.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export const BIZAR_KILL_TOOL_NAME = "bizar_kill";

export interface BgKillDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarKillInput = z.infer<typeof bizarKillSchema>;
export type BizarKillOutput =
  | { ok: true; instanceId: string; status: string }
  | { ok: false; error: string; instanceId?: string };

const bizarKillSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("Instance id returned by bizar_spawn_background."),
});

/**
 * Build the `bizar_kill` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the InstanceManager.
 */
export function createBgKillTool(
  deps: BgKillDeps,
): AgentTool<BizarKillInput, BizarKillOutput> {
  return createTool({
    name: BIZAR_KILL_TOOL_NAME,
    description:
      "Kill a running background instance. Only Odin may kill. " +
      "No-op on already-terminal instances.",
    inputSchema: bizarKillSchema.shape,
    execute: async (input, context) => {
      // Odin-only — derive the agent role from the runtime metadata
      // (`parentAgent` is set on first chat.message of the session)
      // and from the InstanceManager when possible. Cline's
      // `AgentToolContext` does not expose `agent` directly, so we
      // check the persisted state instead.
      const parentAgent =
        (context.metadata as { parentAgent?: string } | undefined)?.parentAgent ??
        null;
      if (parentAgent !== "odin") {
        return {
          ok: false as const,
          error:
            "Only Odin can kill background agents. Use bizar_status to inspect or ask Odin to kill.",
        };
      }
      const inst = await deps.instanceManager.get(input.instanceId);
      if (!inst) {
        return {
          ok: false as const,
          error: "instance_not_found",
          instanceId: input.instanceId,
        };
      }
      try {
        await deps.instanceManager.kill(input.instanceId);
        const after = await deps.instanceManager.get(input.instanceId);
        return {
          ok: true as const,
          instanceId: input.instanceId,
          status: after?.status ?? "killed",
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: kill(${input.instanceId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          ok: false as const,
          error: `kill_failed: ${err instanceof Error ? err.message : String(err)}`,
          instanceId: input.instanceId,
        };
      }
    },
  });
}