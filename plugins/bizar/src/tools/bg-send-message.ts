/**
 * plugins/bizar/src/tools/bg-send-message.ts
 *
 * v5.x — `bizar_send_message` tool. Mid-flight redirect for a
 * background agent — "steer" the running instance with a new
 * instruction.
 *
 * ────────────────────────────────────────────────────────────────
 * v0.8.0 DESIGN NOTE — why this tool is a structured no-op
 * ────────────────────────────────────────────────────────────────
 * In the opencode 1.17 `serve` HTTP API (used by bg-spawn up to v0.7)
 * you could `POST /session/{id}/prompt` to send a follow-up message
 * to a running session — the loop would pick it up mid-run and start
 * a new turn. That's the "real" steer path.
 *
 * In v0.8.0 the plugin switched to `opencode run`, which is a
 * one-shot CLI: it accepts the prompt on the command line, runs the
 * agent loop to completion, and exits. There is no documented HTTP /
 * IPC channel for sending a follow-up user message mid-run. The
 * subprocess doesn't expose one and we don't own the opencode source.
 *
 * Two paths to a workable steer:
 *
 *   1. **Switch back to HTTP server mode** — every bg agent would
 *      start its own `opencode serve` + a server-side streaming
 *      prompt. Heavyweight (extra processes, double the memory) and
 *      a 1-2 sprint piece of work.
 *
 *   2. **Kill + restart with appended prompt** — graceful shutdown
 *      of the current subprocess, spin up a new one whose prompt is
 *      `(original) + "\n\n[STEERED " + ISO timestamp + "]\n" + msg`.
 *      Cheaper; matches the user's mental model of "send new
 *      instruction"; implemented in the dashboard at
 *      `POST /api/background/:id/steer`.
 *
 * We document the constraint here. The tool itself returns the
 * concrete error and the recommended path so the agent can either
 * (a) ask Odin to use the dashboard steer endpoint or (b) call
 * `bizar_kill` + `bizar_spawn_background` with a combined prompt as
 * a backup.
 *
 * In a future v0.9.x this tool will be promoted to the real
 * implementation once opencode run supports mid-flight prompting.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";

export interface BgSendMessageDeps {
  instanceManager: InstanceManager;
  logger: Logger;
}

export function createBgSendMessageTool(deps: BgSendMessageDeps) {
  return tool({
    description:
      "Send a follow-up message to a running background agent. " +
      "v0.8.0 LIMITATION: opencode run is a one-shot CLI and does not " +
      "support mid-flight prompting. This tool returns an `unavailable_in_subprocess_mode` " +
      "error and points the caller to the dashboard's steer endpoint, " +
      "which performs kill+restart-with-appended-prompt.",
    args: {
      instanceId: z
        .string()
        .min(1)
        .describe("Instance id returned by bizar_spawn_background."),
      message: z
        .string()
        .min(1)
        .describe("The follow-up instruction to send."),
    },
    execute: async (rawArgs, ctx) => {
      const args = rawArgs as { instanceId: string; message: string };
      // Verify the instance exists so we don't silently accept bogus ids.
      const inst = await deps.instanceManager.get(args.instanceId);
      if (!inst) {
        return {
          output: JSON.stringify({
            error: "instance_not_found",
            instanceId: args.instanceId,
          }),
        };
      }
      deps.logger.debug(
        `bizar: sendMessage(${args.instanceId}) — mid-flight steer unavailable in v0.8.0 subprocess mode`,
      );
      void ctx;
      return {
        output: JSON.stringify({
          error: "unavailable_in_subprocess_mode",
          message:
            "v0.8.0 bg agents run as `opencode run` subprocesses and cannot accept a follow-up prompt mid-flight. " +
            "Use the dashboard's `POST /api/background/<id>/steer` (Steer button on instance detail) which performs " +
            "kill+restart with the new instruction appended to the original prompt. " +
            "Or, if running headlessly, you can call `bizar_kill` followed by `bizar_spawn_background` " +
            "with a combined prompt yourself.",
          instanceId: args.instanceId,
          dashboardHint: `POST /api/background/${args.instanceId}/steer`,
        }),
      };
    },
  });
}
