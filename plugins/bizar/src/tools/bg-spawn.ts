/**
 * plugins/bizar/src/tools/bg-spawn.ts
 *
 * v0.8.0 — `bizar_spawn_background` tool, refactored to spawn one
 * `opencode run` subprocess per agent (instead of POSTing to a
 * passive `opencode serve` HTTP API). See opencode-runner.ts for the
 * spawning implementation; see ../opencode-runner.ts for the
 * rationale and the wire format we parse.
 *
 * Spec §1, §6.3, §7.1.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import { generateInstanceId, generateMessageId } from "../background.js";
import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";
import { spawnAgent } from "../opencode-runner.js";
import { resolve as pathResolve } from "node:path";
import { homedir } from "node:os";

/** Spec §7.3: `timeoutMs` clamped to [1000, 1800000] (1s..30min). */
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 300_000;

/** Mirrors plugins/bizar/src/http-client.ts ModelOverride. */
export interface ModelOverride {
  providerID: string;
  modelID: string;
}

/**
 * Parse "providerID/modelID" into a ModelOverride. Returns null when
 * the input is empty (use the agent's default) or malformed.
 */
function parseModel(raw: string | undefined): ModelOverride | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const idx = trimmed.indexOf("/");
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  const providerID = trimmed.slice(0, idx).trim();
  const modelID = trimmed.slice(idx + 1).trim();
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

export interface BgSpawnDeps {
  instanceManager: InstanceManager;
  worktree: string;
  logger: Logger;
}

/**
 * Compute the LogWriter's actual log path for a given instanceId.
 * The plugin's `LogWriter` (../report.ts:147) writes to
 * `${logDir}/${sessionId}.log` where `logDir` defaults to
 * `~/.cache/bizar/logs` (overridable via the `BIZAR_LOG_DIR` env
 * var). The instanceId is what we know at spawn time — the opencode
 * sessionId is generated later by the subprocess and we don't
 * pre-allocate it. We therefore use the instanceId as the log file
 * name and let the runner append to it.
 */
function buildLogPath(instanceId: string): string {
  const logDir = process.env.BIZAR_LOG_DIR || pathResolve(homedir(), ".cache", "bizar", "logs");
  return pathResolve(logDir, `${instanceId}.log`);
}

/**
 * Build the `bizar_spawn_background` tool. The plugin wires the
 * result into `Hooks.tool`. The `deps` closure carries the
 * per-process state (InstanceManager, worktree, logger).
 */
export function createBgSpawnTool(deps: BgSpawnDeps) {
  return tool({
    description:
      "Spawn a background agent that runs asynchronously as a separate `opencode run` subprocess. " +
      "Only Odin may call this tool. " +
      "Returns an instanceId immediately (sub-second), then the agent runs to completion in the background. " +
      "Use `bizar_status` / `bizar_collect` / `bizar_kill` to manage the instance. " +
      "Use `bizar_bg_view` (CLI) to watch all running agents in a tmux split window. " +
      "IMPORTANT: do NOT block waiting for the agent. Return control to the user right after spawning.",
    args: {
      agent: z.string().min(1).describe("Agent name to spawn (e.g. 'mimir', 'thor', 'tyr')."),
      prompt: z.string().min(1).describe("User prompt for the background session."),
      model: z
        .string()
        .optional()
        .describe("Optional model override in 'providerID/modelID' format."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Collect-time timeout in ms (1s..30min, default 5min)."),
      persistent: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, auto-restart on terminal failure (up to maxRestarts)."),
      maxRestarts: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe("Number of auto-restart attempts before giving up."),
    },
    execute: async (rawArgs, ctx) => {
      // 1. Odin-only (MEDIUM-26).
      if (ctx.agent !== "odin") {
        return {
          output: JSON.stringify({
            error:
              "Only Odin can spawn background agents. Use the task tool for sync work, or ask Odin to spawn a background agent.",
          }),
        };
      }

      const args = rawArgs as {
        agent: string;
        prompt: string;
        model?: string;
        timeoutMs?: number;
        persistent?: boolean;
        maxRestarts?: number;
      };

      // 2. Validate the model parameter (LOW-34 / §1.4).
      let modelOverride: ModelOverride | undefined;
      if (args.model !== undefined && args.model !== "") {
        const m = parseModel(args.model);
        if (m === null) {
          return {
            output: JSON.stringify({
              error: `model must be in "providerID/modelID" format (e.g. "opencode/deepseek-v4-flash-free"). Omit to use the agent's default.`,
            }),
          };
        }
        modelOverride = m;
      }

      // 3. Clamp timeoutMs (MEDIUM-33 / §7.3).
      const requested = args.timeoutMs ?? TIMEOUT_DEFAULT_MS;
      if (requested < TIMEOUT_MIN_MS || requested > TIMEOUT_MAX_MS) {
        return {
          output: JSON.stringify({
            error: `timeoutMs must be between ${TIMEOUT_MIN_MS} (1s) and ${TIMEOUT_MAX_MS} (30min). Got ${requested}.`,
          }),
        };
      }
      const timeoutMs = requested;

      // 4. Generate the instanceId and seed the manager (track BEFORE
      //    the subprocess starts, so a fast-exiting agent is still
      //    queryable via bizar_status).
      const instanceId = generateInstanceId();
      const logPath = buildLogPath(instanceId);
      const draft = {
        instanceId,
        sessionId: "", // filled in once the opencode run reports it
        agent: args.agent,
        model: modelOverride
          ? `${modelOverride.providerID}/${modelOverride.modelID}`
          : "agent-default",
        promptPreview: args.prompt.slice(0, 200),
        prompt: args.prompt, // store full prompt for restart support
        parentAgent: ctx.agent,
        logPath,
        timeoutMs,
        toolCallCount: 0,
        // v0.5.5 — persistent auto-restart
        persistent: args.persistent ?? false,
        maxRestarts: args.maxRestarts ?? 3,
        restartCount: 0,
      };
      const addRes = await deps.instanceManager.add(draft);
      if (addRes === "cap_reached") {
        return {
          output: JSON.stringify({
            error: `Max concurrent instances reached. Wait for one to finish or call bizar_kill.`,
          }),
        };
      }

      // 5. Spawn the opencode run subprocess. The runner returns
      //    when the opencode child has reported its session id in
      //    the structured log stream (typically <500ms).
      const messageID = generateMessageId();
      let spawnRes: Awaited<ReturnType<typeof spawnAgent>>;
      try {
        spawnRes = await spawnAgent({
          prompt: args.prompt,
          agent: args.agent,
          model: modelOverride,
          worktree: deps.worktree,
          logPath,
          title: `bgr:${args.agent}:${instanceId}:${messageID}`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await deps.instanceManager.update(instanceId, {
          status: "failed",
          error: `spawnAgent threw: ${msg}`,
          completedAt: Date.now(),
        });
        return {
          output: JSON.stringify({
            error: `spawn crashed: ${msg}`,
            instanceId,
            sessionId: null,
            status: "failed",
          }),
        };
      }

      if (!spawnRes.ok || !spawnRes.sessionId) {
        await deps.instanceManager.update(instanceId, {
          status: "failed",
          error: spawnRes.error || "opencode run failed before reporting session id",
          completedAt: Date.now(),
        });
        return {
          output: JSON.stringify({
            error: `spawn failed: ${spawnRes.error || "no session id"}`,
            instanceId,
            sessionId: null,
            status: "failed",
          }),
        };
      }

      // 6. Persist the sessionId in the instance state. The high-level
      //    `status` stays "pending" until the runner reports a terminal
      //    state; we record the processId and the runner's
      //    intermediate states in the dedicated fields.
      await deps.instanceManager.update(instanceId, {
        sessionId: spawnRes.sessionId,
        status: "running",
        processId: spawnRes.processId,
        runnerState: "running",
        sessionIdAt: Date.now(),
      });

      // 7. Wire the runner's exit event to the instance state. When
      //    the opencode run subprocess exits, the runner updates
      //    the status (done / failed / killed) and triggers the
      //    persistent auto-restart flow if appropriate.
      if (spawnRes.processId !== undefined) {
        const { onExit } = await import("../opencode-runner.js");
        onExit(spawnRes.processId, (status) => {
          // Map runner states to BackgroundStatus. The runner reports
          // "starting" | "running" | "done" | "failed" | "killed";
          // BackgroundStatus has "pending" | "running" | "done" |
          // "failed" | "killed" | "timed_out". "starting" maps to
          // "running" (in-flight, no terminal state).
          const mapped: "pending" | "running" | "done" | "failed" | "killed" =
            status.state === "starting" || status.state === "running"
              ? "running"
              : status.state;

          const update: Parameters<InstanceManager["update"]>[1] = {
            status: mapped,
            runnerState: status.state,
            completedAt: status.endedAt ?? Date.now(),
          };
          if (status.exitCode !== undefined) update.exitCode = status.exitCode;
          if (status.error) {
            update.runnerError = status.error;
            update.error = status.error;
          }
          if (status.endedAt !== undefined) update.runnerEndedAt = status.endedAt;
          // Best-effort: if the InstanceManager has gone away (e.g.
          // the plugin restarted), the update silently no-ops.
          deps.instanceManager
            .update(instanceId, update)
            .then(() => {
              // Persistent auto-restart: only for natural failures,
              // not for explicit kills or successes.
              if (status.state === "failed") {
                return deps.instanceManager.maybeAutoRestart(instanceId);
              }
              return undefined;
            })
            .catch((err: unknown) => {
              deps.logger.warn(
                `bizar: bg-spawn exit update failed for ${instanceId}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        });
      }

      // 8. Return the spawn result. v0.8.0 message: the agent is
      //    running in the background; Odin should return control to
      //    the user immediately and not block waiting.
      return {
        output: JSON.stringify({
          instanceId,
          sessionId: spawnRes.sessionId,
          processId: spawnRes.processId,
          status: "running",
          message:
            "Background agent started. It will run to completion in a separate `opencode run` subprocess. " +
            "Use `bizar_status <instanceId>` to check progress, `bizar_collect <instanceId>` to wait for the result, " +
            "or `bizar_kill <instanceId>` to stop it. Run `bizar bg view` in another terminal to watch all running agents live.",
          nextSteps: [
            "Tell the user the agent is running and approximately how long they should expect to wait",
            "If the user wants the result now, call `bizar_collect <instanceId>` (with a reasonable timeout)",
            "If the user wants to stop the agent, call `bizar_kill <instanceId>`",
            "Do NOT block waiting for the result unless the user explicitly asked for it",
          ],
        }),
      };
    },
  });
}
