/**
 * plugins/bizar/src/tools/loop-engineering.ts
 *
 * Tools for the /loop command. Each tool is a thin wrapper around
 * `loop-engineering.ts` which manages loop state on disk at ~/.bizar/loops/.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { Logger } from "../logger.js";
import {
  startLoop as leStartLoop,
  loadLoop,
  listLoops,
  stopLoop as leStopLoop,
  deleteLoop as leDeleteLoop,
  buildNextIteration,
  type LoopPattern,
} from "../loop-engineering.js";

export const BIZAR_LOOP_START_TOOL_NAME = "bizar_loop_start";
export const BIZAR_LOOP_STATUS_TOOL_NAME = "bizar_loop_status";
export const BIZAR_LOOP_STOP_TOOL_NAME = "bizar_loop_stop";
export const BIZAR_LOOP_LIST_TOOL_NAME = "bizar_loop_list";
export const BIZAR_LOOP_DELETE_TOOL_NAME = "bizar_loop_delete";

export interface LoopToolDeps {
  logger: Logger;
}

// ── Loop-start ────────────────────────────────────────────────────────
const loopStartSchema = z.object({
  pattern: z.enum(["ralph", "repl", "cron", "plan-execute"]),
  task: z.string(),
  interval: z.number().int().positive().optional(),
  maxIterations: z.number().int().positive().optional(),
  stopMarker: z.string().optional(),
  subtasks: z.array(z.string()).optional(),
});

export function createLoopStartTool(deps: LoopToolDeps): AgentTool {
  return createTool({
    name: BIZAR_LOOP_START_TOOL_NAME,
    description:
      "Start a continuous loop. Patterns: ralph (until [STOP] marker), " +
      "repl (interactive), cron (interval-based), plan-execute (iterate subtasks).",
    inputSchema: loopStartSchema.shape,
    execute: async (args) => {
      const input = loopStartSchema.parse(args);
      const { ok, loop } = leStartLoop({
        pattern: input.pattern as LoopPattern,
        task: input.task,
        context: {
          maxIterations: input.maxIterations ?? 10,
          intervalSeconds: input.interval,
          stopMarker: input.stopMarker,
          subtasks: input.subtasks,
        },
      });
      const next = buildNextIteration(loop);
      deps.logger.info?.(`[loop] started ${loop.id} (${loop.pattern})`);
      return {
        ok,
        loopId: loop.id,
        pattern: loop.pattern,
        task: loop.task,
        maxIterations: loop.context.maxIterations,
        nextPrompt: next.prompt,
        stopMarker: next.stopMarker,
      };
    },
  });
}

// ── Loop-status ───────────────────────────────────────────────────────
const loopStatusSchema = z.object({
  loopId: z.string(),
  verbose: z.boolean().optional(),
});

export function createLoopStatusTool(_deps: LoopToolDeps): AgentTool {
  return createTool({
    name: BIZAR_LOOP_STATUS_TOOL_NAME,
    description: "Show the status and iteration log of a loop.",
    inputSchema: loopStatusSchema.shape,
    execute: async (args) => {
      const input = loopStatusSchema.parse(args);
      const loop = loadLoop(input.loopId);
      if (!loop) return { ok: false, error: `loop not found: ${input.loopId}` };
      return {
        ok: true,
        loopId: loop.id,
        pattern: loop.pattern,
        task: loop.task,
        status: loop.status,
        iterationCount: loop.iterations.length,
        maxIterations: loop.context.maxIterations,
        createdAt: loop.createdAt,
        updatedAt: loop.updatedAt,
        iterations: input.verbose ? loop.iterations : loop.iterations.slice(-3),
      };
    },
  });
}

// ── Loop-stop ─────────────────────────────────────────────────────────
const loopStopSchema = z.object({
  loopId: z.string(),
  reason: z.string().optional(),
});

export function createLoopStopTool(_deps: LoopToolDeps): AgentTool {
  return createTool({
    name: BIZAR_LOOP_STOP_TOOL_NAME,
    description: "Stop a running loop.",
    inputSchema: loopStopSchema.shape,
    execute: async (args) => {
      const input = loopStopSchema.parse(args);
      const loop = leStopLoop(input.loopId, input.reason);
      if (!loop) return { ok: false, error: `loop not found: ${input.loopId}` };
      return { ok: true, loopId: loop.id, status: loop.status };
    },
  });
}

// ── Loop-list ─────────────────────────────────────────────────────────
const loopListSchema = z.object({
  status: z.enum(["running", "stopped", "done"]).optional(),
  pattern: z.enum(["ralph", "repl", "cron", "plan-execute"]).optional(),
  limit: z.number().int().positive().optional(),
});

export function createLoopListTool(_deps: LoopToolDeps): AgentTool {
  return createTool({
    name: BIZAR_LOOP_LIST_TOOL_NAME,
    description: "List all loops on disk.",
    inputSchema: loopListSchema.shape,
    execute: async (args) => {
      const input = loopListSchema.parse(args);
      const loops = listLoops({
        status: input.status as "running" | "stopped" | "done" | undefined,
        pattern: input.pattern as LoopPattern | undefined,
      });
      const sliced = input.limit ? loops.slice(0, input.limit) : loops;
      return {
        ok: true,
        count: sliced.length,
        loops: sliced.map((l) => ({
          id: l.id,
          pattern: l.pattern,
          task: l.task.slice(0, 80),
          status: l.status,
          iterationCount: l.iterations.length,
          createdAt: l.createdAt,
        })),
      };
    },
  });
}

// ── Loop-delete ───────────────────────────────────────────────────────
const loopDeleteSchema = z.object({ loopId: z.string() });

export function createLoopDeleteTool(_deps: LoopToolDeps): AgentTool {
  return createTool({
    name: BIZAR_LOOP_DELETE_TOOL_NAME,
    description: "Delete a loop from disk.",
    inputSchema: loopDeleteSchema.shape,
    execute: async (args) => {
      const input = loopDeleteSchema.parse(args);
      const ok = leDeleteLoop(input.loopId);
      if (!ok) return { ok: false, error: `loop not found: ${input.loopId}` };
      return { ok: true, loopId: input.loopId };
    },
  });
}

/**
 * Bundle all 5 loop tools for the plugin's setup() entry.
 */
export function createLoopTools(deps: LoopToolDeps): AgentTool[] {
  return [
    createLoopStartTool(deps),
    createLoopStatusTool(deps),
    createLoopStopTool(deps),
    createLoopListTool(deps),
    createLoopDeleteTool(deps),
  ];
}

// Re-export.
export { startLoop, loadLoop, listLoops, stopLoop, deleteLoop, buildNextIteration } from "../loop-engineering.js";