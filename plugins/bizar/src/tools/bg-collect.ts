/**
 * bg-collect.ts
 *
 * `bizar_collect` tool (v0.4.2 spec §7.1, §4.4).
 *
 * Odin-only — only Odin may collect. Blocks until the instance reaches a
 * terminal state or `timeoutMs` elapses. On timeout, returns
 * `status: "running"` with the last known `resultPreview`.
 *
 * Returns:
 *   `{ instanceId, status, result, toolCallCount, durationMs, error? }`
 *
 * The `result` field is the concatenated text of all assistant messages
 * (TextPart only). If the instance ended with a threshold-12 loop-guard
 * error, the marker `[loop guard: 12 identical calls to <tool>]` is
 * prepended (MEDIUM-30).
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 60_000;

export interface BgCollectDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

/**
 * Build the `bizar_collect` tool.
 */
export function createBgCollectTool(deps: BgCollectDeps) {
  return tool({
    description:
      "Wait for a background instance to complete and return its result. " +
      "Only Odin may collect. Blocks until the instance reaches a terminal state or the timeout fires.",
    args: {
      instanceId: z
        .string()
        .min(1)
        .describe("Instance id returned by bizarre_spawn_background."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Collect-time timeout in ms (1s..30min, default 60s)."),
    },
    execute: async (rawArgs, ctx) => {
      // Odin-only (§6.3).
      if (ctx.agent !== "odin") {
        return {
          output: JSON.stringify({
            error:
              "Only Odin can collect background agent results. Use bizarre_status to inspect or ask Odin to collect.",
          }),
        };
      }
      const args = rawArgs as { instanceId: string; timeoutMs?: number };

      // Clamp timeoutMs (MEDIUM-33 / §7.3).
      const requested = args.timeoutMs ?? TIMEOUT_DEFAULT_MS;
      if (requested < TIMEOUT_MIN_MS || requested > TIMEOUT_MAX_MS) {
        return {
          output: JSON.stringify({
            error: `timeoutMs must be between ${TIMEOUT_MIN_MS} (1s) and ${TIMEOUT_MAX_MS} (30min). Got ${requested}.`,
          }),
        };
      }
      const timeoutMs = requested;

      try {
        const result = await deps.instanceManager.collect(args.instanceId, timeoutMs);
        return {
          output: JSON.stringify({
            instanceId: args.instanceId,
            status: result.status,
            result: result.result,
            toolCallCount: result.toolCallCount,
            durationMs: result.durationMs,
            ...(result.error !== undefined ? { error: result.error } : {}),
          }),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: collect(${args.instanceId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          output: JSON.stringify({
            error: `collect failed: ${err instanceof Error ? err.message : String(err)}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}
