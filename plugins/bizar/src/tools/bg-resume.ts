/**
 * plugins/bizar/src/tools/bg-resume.ts
 *
 * v5.x — `bizar_resume` tool. Sends SIGCONT to a paused background
 * agent's subprocess. Companion to {@link ./bg-pause.ts}.
 *
 * Odin-only.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_RESUME_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, instanceId, status }` instead of
 *     `{ output: JSON.stringify(...) }`.
 *   - `ctx.agent` becomes `context.metadata.parentAgent` look-up.
 */
import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export const BIZAR_RESUME_TOOL_NAME = "bizar_resume";

export interface BgResumeDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarResumeInput = z.infer<typeof bizarResumeSchema>;
export type BizarResumeOutput =
  | { ok: true; instanceId: string; status: string }
  | { ok: false; error: string; instanceId?: string };

const bizarResumeSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("Instance id returned by bizar_spawn_background."),
});

/**
 * Build the `bizar_resume` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the InstanceManager.
 */
export function createBgResumeTool(
  deps: BgResumeDeps,
): AgentTool<BizarResumeInput, BizarResumeOutput> {
  return createTool({
    name: BIZAR_RESUME_TOOL_NAME,
    description:
      "Resume a paused background agent by sending SIGCONT to its subprocess. " +
      "Only Odin may resume. No-op on already-running instances. POSIX only.",
    inputSchema: bizarResumeSchema.shape,
    execute: async (input, context) => {
      const parentAgent =
        (context.metadata as { parentAgent?: string } | undefined)?.parentAgent ?? null;
      if (parentAgent !== "odin") {
        return {
          ok: false as const,
          error:
            "Only Odin can resume background agents. Use bizar_status to inspect or ask Odin to resume.",
        };
      }
      try {
        const result = await deps.instanceManager.resume(input.instanceId);
        if (!result.ok) {
          return {
            ok: false as const,
            error: result.error || "resume failed",
            instanceId: input.instanceId,
          };
        }
        return {
          ok: true as const,
          instanceId: input.instanceId,
          status: "running",
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: resume(${input.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          ok: false as const,
          error: `resume threw: ${err instanceof Error ? err.message : String(err)}`,
          instanceId: input.instanceId,
        };
      }
    },
  });
}
