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
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgReportProgressDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export function createBgReportProgressTool(deps: BgReportProgressDeps) {
  return tool({
    description:
      "Report progress on the current background instance. " +
      "Available to all agents. step/total are integers; message is a " +
      "free-form status hint shown next to the progress bar.",
    args: {
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
    },
    execute: async (rawArgs) => {
      const args = rawArgs as {
        instanceId: string;
        step: number;
        total: number;
        message?: string;
        indeterminate?: boolean;
      };
      try {
        const result = await deps.instanceManager.updateProgress(
          args.instanceId,
          args.step,
          args.total,
          args.message,
          Boolean(args.indeterminate),
        );
        if (!result.ok) {
          return {
            output: JSON.stringify({
              error: result.error || "progress_failed",
              instanceId: args.instanceId,
            }),
          };
        }
        return {
          output: JSON.stringify({
            instanceId: args.instanceId,
            progress: result.progress,
          }),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: report-progress(${args.instanceId}) threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          output: JSON.stringify({
            error: `report-progress threw: ${err instanceof Error ? err.message : String(err)}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}
