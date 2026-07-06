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
 * Returns:
 *   `Array<{ instanceId, agent, status, startedAt, toolCallCount,
 *             promptPreview, resultPreview?, error?, parentAgent,
 *             parentInstanceId? }>`
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager, InstanceView } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgStatusDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

/**
 * Build the `bizar_status` tool. The plugin wires the result into
 * `Hooks.tool`. The `deps` closure carries the InstanceManager.
 */
export function createBgStatusTool(deps: BgStatusDeps) {
  return tool({
    description:
      "List background instances. Read-only; available to all agents. " +
      "Pass an instanceId to inspect one instance.",
    args: {
      instanceId: z
        .string()
        .optional()
        .describe("Optional instanceId. If omitted, all instances are returned."),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { instanceId?: string };
      try {
        if (args.instanceId) {
          const inst = await deps.instanceManager.get(args.instanceId);
          if (!inst) {
            return {
              output: JSON.stringify({ error: `instance not found`, instanceId: args.instanceId }),
            };
          }
          const view: InstanceView = toViewShape(inst);
          return { output: JSON.stringify([view]) };
        }
        const list = await deps.instanceManager.list();
        return { output: JSON.stringify(list) };
      } catch (err: unknown) {
        deps.logger.warn(
          `bizar: status failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {
          output: JSON.stringify({ error: `status failed: ${err instanceof Error ? err.message : String(err)}` }),
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
