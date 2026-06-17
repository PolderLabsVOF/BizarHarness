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
  };
  if (inst.completedAt !== undefined) v.completedAt = inst.completedAt;
  if (inst.resultPreview !== undefined) v.resultPreview = inst.resultPreview;
  if (inst.error !== undefined) v.error = inst.error;
  if (inst.parentInstanceId !== undefined) v.parentInstanceId = inst.parentInstanceId;
  return v;
}
