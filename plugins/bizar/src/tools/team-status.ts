/**
 * team-status.ts
 *
 * `bizar_team_status` tool — get the current status of a Cline agent team.
 * Subscribes to team events and returns a snapshot of progress.
 *
 * v6.0.0 — Cline agent teams integration. The dashboard's kanban board
 * consumes these events to show team progress in real time.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import type { CoreSessionEvent } from "@cline/core";

import type { ClineRuntime } from "../clineruntime.js";
import type { Logger } from "../logger.js";

export const BIZAR_TEAM_STATUS_TOOL_NAME = "bizar_team_status";

export interface TeamStatusDeps {
  runtime: ClineRuntime;
  logger: Logger;
}

export type BizarTeamStatusInput = z.infer<typeof bizarTeamStatusSchema>;
export type BizarTeamStatusOutput =
  | { ok: true; sessionId: string; teamProgress: unknown }
  | { ok: false; error: string; message: string };

const bizarTeamStatusSchema = z.object({
  sessionId: z.string().min(1).describe("Team session ID returned by bizar_spawn_team."),
  timeoutMs: z.number().int().positive().optional().describe("Max time to wait for a progress event (default 1000ms)."),
});

/**
 * Subscribe to team events for a session and return the most recent
 * team_progress_projection event. If no progress event is available
 * within the timeout, returns what we have (or null).
 */
export function createTeamStatusTool(
  deps: TeamStatusDeps,
): AgentTool<BizarTeamStatusInput, BizarTeamStatusOutput> {
  return createTool({
    name: BIZAR_TEAM_STATUS_TOOL_NAME,
    description:
      "Get the current status of a Cline agent team. Returns the latest " +
      "team progress projection. Available to Odin and coordinating agents.",
    inputSchema: bizarTeamStatusSchema.shape,
    execute: async (input) => {
      const timeoutMs = input.timeoutMs ?? 1000;
      let lastProgress: unknown = null;
      let done = false;
      const handler = (event: CoreSessionEvent) => {
        const t = (event as { type?: string }).type;
        if (t === "team_progress_projection" || t === "team.lifecycle" || t === "team.progress" || t === "team.lifecycle.v1") {
          lastProgress = event;
          done = true;
        }
      };
      let unsubscribe: (() => void) | null = null;
      try {
        unsubscribe = deps.runtime.subscribe({ sessionId: input.sessionId }, handler);
        const start = Date.now();
        while (!done && Date.now() - start < timeoutMs) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: team-status subscribe failed: ${msg}`);
      } finally {
        try { unsubscribe?.(); } catch { /* ignore */ }
      }
      return { ok: true as const, sessionId: input.sessionId, teamProgress: lastProgress };
    },
  });
}
