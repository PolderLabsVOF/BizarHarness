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
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_COLLECT_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...)` over the same fields as before.
 *   - Returns structured `{ ok, instanceId, status, ... }` instead of
 *     `{ output: JSON.stringify(...) }`.
 *   - `ctx.agent` becomes `context.metadata.parentAgent` look-up.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 60_000;

export const BIZAR_COLLECT_TOOL_NAME = "bizar_collect";

export interface BgCollectDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarCollectInput = z.infer<typeof bizarCollectSchema>;
export type BizarCollectOutput =
  | {
      ok: true;
      instanceId: string;
      status: string;
      result: string;
      toolCallCount: number;
      durationMs: number;
      error?: string;
    }
  | { ok: false; error: string; instanceId?: string };

const bizarCollectSchema = z.object({
  instanceId: z
    .string()
    .min(1)
    .describe("Instance id returned by bizar_spawn_background."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Collect-time timeout in ms (1s..30min, default 60s)."),
});

/**
 * Build the `bizar_collect` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the InstanceManager.
 */
export function createBgCollectTool(
  deps: BgCollectDeps,
): AgentTool<BizarCollectInput, BizarCollectOutput> {
  return createTool({
    name: BIZAR_COLLECT_TOOL_NAME,
    description:
      "Wait for a background instance to complete and return its result. " +
      "Only Odin may collect. Blocks until the instance reaches a terminal state or the timeout fires.",
    inputSchema: bizarCollectSchema.shape,
    execute: async (input, context) => {
      // Odin-only (§6.3).
      const parentAgent =
        (context.metadata as { parentAgent?: string } | undefined)?.parentAgent ?? null;
      if (parentAgent !== "odin") {
        return {
          ok: false as const,
          error:
            "Only Odin can collect background agent results. Use bizar_status to inspect or ask Odin to collect.",
        };
      }

      // Clamp timeoutMs (MEDIUM-33 / §7.3).
      const requested = input.timeoutMs ?? TIMEOUT_DEFAULT_MS;
      if (requested < TIMEOUT_MIN_MS || requested > TIMEOUT_MAX_MS) {
        return {
          ok: false as const,
          error: `timeoutMs must be between ${TIMEOUT_MIN_MS} (1s) and ${TIMEOUT_MAX_MS} (30min). Got ${requested}.`,
        };
      }
      const timeoutMs = requested;

      try {
        const result = await deps.instanceManager.collect(input.instanceId, timeoutMs);
        return {
          ok: true as const,
          instanceId: input.instanceId,
          status: result.status,
          result: result.result,
          toolCallCount: result.toolCallCount,
          durationMs: result.durationMs,
          ...(result.error !== undefined ? { error: result.error } : {}),
        };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: collect(${input.instanceId}) failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return {
          ok: false as const,
          error: `collect failed: ${err instanceof Error ? err.message : String(err)}`,
          instanceId: input.instanceId,
        };
      }
    },
  });
}
