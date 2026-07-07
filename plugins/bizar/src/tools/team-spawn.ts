/**
 * team-spawn.ts
 *
 * `bizar_spawn_team` tool — spawn a Cline agent team (multi-agent
 * collaboration). Uses ClineCore in-process with `enableAgentTeams: true`.
 *
 * A team is a set of agents that collaborate on a shared mission. The
 * lead agent coordinates; teammates execute sub-tasks. The team runs
 * until the mission is complete or the team is stopped.
 *
 * v6.0.0 — New tool for Cline agent teams integration. The runtime
 * config sets `enableAgentTeams: true` so the team coordinator + tools
 * (TeamSpawnTeammate, TeamRunTask, TeamSendMessage, etc.) are available.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import type { ClineRuntime, StartSessionOpts } from "../clineruntime.js";
import type { Logger } from "../logger.js";

export const BIZAR_SPAWN_TEAM_TOOL_NAME = "bizar_spawn_team";

export interface TeamSpawnDeps {
  runtime: ClineRuntime;
  logger: Logger;
}

export type BizarTeamSpawnInput = z.infer<typeof bizarTeamSpawnSchema>;
export type BizarTeamSpawnOutput =
  | { ok: true; sessionId: string; teamName: string; missionPreview: string }
  | { ok: false; error: string; message: string };

const bizarTeamSpawnSchema = z.object({
  teamName: z.string().min(1).describe("Name of the team (e.g. 'bizar-build-team')."),
  mission: z.string().min(1).describe("The mission/goal for the team. The lead agent will coordinate teammates to achieve this."),
  providerId: z.string().optional().describe("Provider ID (default 'anthropic')."),
  modelId: z.string().optional().describe("Model ID (default 'claude-sonnet-4-6')."),
  workspaceRoot: z.string().optional().describe("Workspace root (default worktree)."),
});

export function createTeamSpawnTool(
  deps: TeamSpawnDeps,
): AgentTool<BizarTeamSpawnInput, BizarTeamSpawnOutput> {
  return createTool({
    name: BIZAR_SPAWN_TEAM_TOOL_NAME,
    description:
      "Spawn a Cline agent team. The lead agent coordinates teammates " +
      "to complete the mission. Returns the team sessionId. Available to " +
      "Odin and coordinating agents.",
    inputSchema: bizarTeamSpawnSchema.shape,
    execute: async (input) => {
      const opts: StartSessionOpts = {
        providerId: input.providerId ?? "anthropic",
        modelId: input.modelId ?? "claude-sonnet-4-6",
        workspaceRoot: input.workspaceRoot ?? process.cwd(),
        systemPrompt: `You are the lead agent of the "${input.teamName}" team. Your mission:\n\n${input.mission}\n\nUse Cline's team tools to coordinate teammates: spawn teammates, run tasks, send messages, review outcomes, and finalize. Use the team progress event stream to track work.`,
        prompt: `Start the "${input.teamName}" team. Mission: ${input.mission}`,
        source: "bizar-team-spawn",
        sessionMetadata: { bizarTeam: input.teamName, bizarMission: input.mission.slice(0, 500) },
      };
      try {
        const sessionId = await deps.runtime.startSession(opts);
        deps.logger.info(`bizar: team spawned (teamName=${input.teamName}, sessionId=${sessionId})`);
        return { ok: true as const, sessionId, teamName: input.teamName, missionPreview: input.mission.slice(0, 200) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: team spawn failed: ${msg}`);
        return { ok: false as const, error: "spawn_failed", message: msg };
      }
    },
  });
}
