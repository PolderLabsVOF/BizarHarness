/**
 * bg-status.ts
 *
 * `bizar_status` tool (v0.4.2 spec §7.1).
 *
 * Read-only — available to ALL agents (Vör, Frigg, Quick, Odin) per
 * §6.3. Returns a snapshot of the in-memory instance list, optionally
 * filtered by `instanceId`. The result is the `InstanceView` shape
 * (subset of `BackgroundState`); see `background.ts` for the type.
 *
 * Cline SDK port (Phase 2):
 *   - Imports `createTool` and `AgentTool` from `@cline/sdk`.
 *   - Adds the required `name` field on every tool.
 *   - `args` (ZodRawShape) is wrapped in `z.object(...)` for `inputSchema`
 *     so Cline's runtime can resolve it.
 *   - `execute(input, context)` no longer takes a `rawArgs`-shaped bag
 *     with a side-channel context — `input` is the parsed object and
 *     `context` is Cline's `AgentToolContext`.
 *   - Return shape is the parsed value directly; Cline wraps it in
 *     `AgentToolResult.output` automatically.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { InstanceManager, InstanceView } from "../background.js";
import type { Logger } from "../logger.js";

export const BIZAR_STATUS_TOOL_NAME = "bizar_status";

export interface BgStatusDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export type BizarStatusInput = z.infer<typeof bizarStatusSchema>;
export type BizarStatusOutput =
  | { ok: true; instances: InstanceView[] }
  | { ok: false; error: string; instanceId?: string };

const bizarStatusSchema = z.object({
  instanceId: z
    .string()
    .optional()
    .describe("Optional instanceId. If omitted, all instances are returned."),
});

/**
 * Build the `bizar_status` tool. The plugin wires the result into
 * `api.registerTool()` from `AgentExtensionApi`. The `deps` closure
 * carries the InstanceManager.
 */
export function createBgStatusTool(
  deps: BgStatusDeps,
): AgentTool<BizarStatusInput, BizarStatusOutput> {
  return createTool({
    name: BIZAR_STATUS_TOOL_NAME,
    description:
      "List background instances. Read-only; available to all agents. " +
      "Pass an instanceId to inspect one instance.",
    inputSchema: bizarStatusSchema.shape,
    execute: async (input) => {
      try {
        if (input.instanceId) {
          const inst = await deps.instanceManager.get(input.instanceId);
          if (!inst) {
            return {
              ok: false as const,
              error: "instance_not_found",
              instanceId: input.instanceId,
            };
          }
          const view: InstanceView = toViewShape(inst);
          return { ok: true as const, instances: [view] };
        }
        const list = await deps.instanceManager.list();
        return { ok: true as const, instances: list };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: status failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

// --- Helpers --------------------------------------------------------------

function toViewShape(inst: import("../background-state.js").BackgroundState): InstanceView {
  const v: InstanceView = {
    instanceId: inst.instanceId,
    agent: inst.agent,
    status: inst.status,
    startedAt: inst.startedAt,
    toolCallCount: inst.toolCallCount,
    promptPreview: inst.promptPreview,
    parentAgent: inst.parentAgent,
    sessionId: inst.sessionId,
    // v0.3.0 — always surface lastEventAt so callers can compute the
    // current "freshness" of an instance (now - lastEventAt).
    lastEventAt: inst.lastEventAt,
  };
  if (inst.completedAt !== undefined) v.completedAt = inst.completedAt;
  if (inst.resultPreview !== undefined) v.resultPreview = inst.resultPreview;
  if (inst.error !== undefined) v.error = inst.error;
  if (inst.parentInstanceId !== undefined) v.parentInstanceId = inst.parentInstanceId;
  // v0.3.0 — only surface intervention metadata when at least one
  // intervention has actually been sent.
  const interventionCount = inst.interventionCount ?? 0;
  if (interventionCount > 0) {
    v.interventionCount = interventionCount;
    if (inst.interventionAt !== undefined) v.interventionAt = inst.interventionAt;
    if (inst.interventionReason !== undefined) v.interventionReason = inst.interventionReason;
  }
  // v5.x — extended dashboard surface.
  if (Array.isArray(inst.toolCalls) && inst.toolCalls.length > 0) {
    v.toolCalls = inst.toolCalls.slice();
  }
  if (typeof inst.progress === "number") v.progress = inst.progress;
  if (inst.progressMessage !== undefined) v.progressMessage = inst.progressMessage;
  if (inst.processId !== undefined) v.processId = inst.processId;
  if (inst.runnerState !== undefined) v.runnerState = inst.runnerState;
  if (Array.isArray(inst.tags) && inst.tags.length > 0) v.tags = inst.tags.slice();
  if (inst.pausedAt !== undefined) v.pausedAt = inst.pausedAt;
  return v;
}