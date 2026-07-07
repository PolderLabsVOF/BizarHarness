/**
 * plugins/bizar/src/tools/bg-report-progress.ts
 *
 * v5.x — `bizar_report_progress` tool. Lets a running background agent
 * push a structured progress update (step/total/message) into the
 * instance state. The dashboard reads `progress` and renders a
 * progress bar; `progressMessage` shows the free-form status line.
 *
 * Available to ALL agents (the body of a bg agent calls it; not just
 * Odin). The `bizar_*` prefix is reserved; the auth filter is "all",
 * matching the "tools all agents can call" pattern of
 * `bizar_status`.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_REPORT_PROGRESS_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, instanceId, progress }` instead of
 *     `{ output: JSON.stringify(...) }`.
 */
import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export const BIZAR_REPORT_PROGRESS_TOOL_NAME = "bizar_report_progress";

export interface BgReportProgressDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarReportProgressInput = z.infer<typeof bizarReportProgressSchema>;
export type BizarReportProgressOutput =
  | { ok: true; instanceId: string; progress: number | undefined }
  | { ok: false; error: string; instanceId: string };

const bizarReportProgressSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("Instance id (the one returned by bizar_spawn_background)."),
  step: z
    .number()
    .int()
    .min(0)
    .describe("Current step (>=0)."),
  total: z
    .number()
    .int()
    .positive()
    .describe("Total step count (>0)."),
  message: z
    .string()
    .optional()
    .describe("Optional human-readable status."),
  indeterminate: z
    .boolean()
    .optional()
    .default(false)
    .describe("Set true to show an indeterminate (unknown) progress."),
});

/**
 * Build the `bizar_report_progress` tool. The plugin wires the result
 * into `api.registerTool()` from `AgentExtensionApi`. The `deps`
 * closure carries the InstanceManager.
 */
export function createBgReportProgressTool(
  deps: BgReportProgressDeps,
): AgentTool<BizarReportProgressInput, BizarReportProgressOutput> {
  return createTool({
    name: BIZAR_REPORT_PROGRESS_TOOL_NAME,
    description:
      "Report progress on the current background instance. " +
      "Available to all agents. step/total are integers; message is a " +
      "free-form status hint shown next to the progress bar.",
    inputSchema: bizarReportProgressSchema.shape,
    execute: async (input) => {
      try {
        const result = await deps.instanceManager.updateProgress(
          input.instanceId,
          input.step,
          input.total,
          input.message,
          Boolean(input.indeterminate),
        );
        if (!result.ok) {
          return {
            ok: false as const,
            error: result.error || "progress_failed",
            instanceId: input.instanceId,
          };
        }
        return {
          ok: true as const,
          instanceId: input.instanceId,
          progress: result.progress,
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: report-progress(${input.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          ok: false as const,
          error: `report-progress threw: ${err instanceof Error ? err.message : String(err)}`,
          instanceId: input.instanceId,
        };
      }
    },
  });
}
