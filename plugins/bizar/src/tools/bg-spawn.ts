/**
 * bg-spawn.ts
 *
 * `bizar_spawn_background` tool (v0.4.2 spec §1, §6.3, §7.1).
 *
 * Odin-only — any other agent calling this tool receives a clear error
 * (MEDIUM-26). The caller's `ctx.agent` is the source of truth.
 *
 * Args:
 *   - `agent: string` — the agent to spawn (e.g. "mimir", "thor", "tyr").
 *   - `prompt: string` — the user prompt; sent verbatim via
 *     `parts: [{ type: "text", text: prompt }]`.
 *   - `model?: string` — `"<providerID>/<modelID>"` override (LOW-34).
 *   - `timeoutMs?: number` — collect-time timeout, clamped to [1000, 1800000].
 *
 * Returns on success:
 *   `{ instanceId, sessionId, status: "pending" }`
 *
 * The "Track BEFORE HTTP" invariant (spec §2.2 / HIGH-21):
 *   1. Validate inputs.
 *   2. Generate `instanceId` and `messageID`.
 *   3. `InstanceManager.add()` — atomic cap check + insert; map entry
 *      exists BEFORE any HTTP call.
 *   4. `POST /session` — returns the opencode `sessionId`.
 *   5. `POST /session/{id}/prompt_async` — fire the prompt.
 *   6. On either HTTP failure, mark the instance `failed` and return the
 *      error. The map is never left in a half-state.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import { generateInstanceId, generateMessageId } from "../background.js";
import type { HttpClient, ModelOverride } from "../http-client.js";
import type { Logger } from "../logger.js";

// --- Spec §1.4 / LOW-34: model parameter parsing -------------------------

/**
 * Parse the `model?: string` argument.
 *   - "provider/model"  → { providerID, modelID }
 *   - "model"           → null (no slash)
 *   - "a/b/c"           → null (multiple slashes)
 *   - "provider/"       → null (empty half)
 *   - "/model"          → null (empty half)
 */
function parseModel(raw: string): ModelOverride | null {
  if (raw === "") return null;
  const parts = raw.split("/");
  if (parts.length !== 2) return null;
  const providerID = parts[0];
  const modelID = parts[1];
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

// --- Tool factory ---------------------------------------------------------

/** Spec §7.3: `timeoutMs` clamped to [1000, 1800000] (1s..30min). */
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 300_000;

export interface BgSpawnDeps {
  instanceManager: InstanceManager;
  http: HttpClient;
  worktree: string;
  logger: Logger;
}

/**
 * Build the `bizar_spawn_background` tool. The plugin wires the result
 * into `Hooks.tool`. The `deps` closure carries the per-process state
 * (InstanceManager, HttpClient, worktree, logger).
 */
export function createBgSpawnTool(deps: BgSpawnDeps) {
  return tool({
    description:
      "Spawn a background agent that runs asynchronously. Only Odin may call this tool. " +
      "Returns an instanceId; use bizarre_status / bizarre_collect / bizarre_kill to manage the instance.",
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
      };

      // 2. Validate the model parameter (LOW-34 / §1.4).
      let modelOverride: ModelOverride | undefined;
      if (args.model !== undefined && args.model !== "") {
        const m = parseModel(args.model);
        if (m === null) {
          return {
            output: JSON.stringify({
              error: `model must be in "providerID/modelID" format (e.g. "minimax/MiniMax-M3"). Omit to use the agent's default.`,
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

      // 4. Generate the instanceId and seed the manager (track BEFORE HTTP).
      const instanceId = generateInstanceId();
      const draft = {
        instanceId,
        sessionId: "", // filled in by POST /session response
        agent: args.agent,
        model: modelOverride
          ? `${modelOverride.providerID}/${modelOverride.modelID}`
          : "agent-default",
        promptPreview: args.prompt.slice(0, 200),
        parentAgent: ctx.agent,
        logPath: buildLogPath(deps.worktree, instanceId),
        timeoutMs,
        toolCallCount: 0,
      };
      const addRes = await deps.instanceManager.add(draft);
      if (addRes === "cap_reached") {
        return {
          output: JSON.stringify({
            error: `Max concurrent instances reached. Wait for one to finish or call bizarre_kill.`,
          }),
        };
      }

      // 5. POST /session. The in-memory entry already exists.
      const sessionRes = await deps.http.createSession(
        {
          parentID: ctx.sessionID,
          title: `bgr:${args.agent}:${instanceId}`,
          agent: args.agent,
          ...(modelOverride ? { model: modelOverride } : {}),
        },
        deps.worktree,
      );
      if (!sessionRes.ok) {
        await deps.instanceManager.update(instanceId, {
          status: "failed",
          error: `POST /session failed: ${sessionRes.error}`,
          completedAt: Date.now(),
        });
        return {
          output: JSON.stringify({
            error: `spawn failed: ${sessionRes.error}`,
            instanceId,
            sessionId: null,
            status: "failed",
          }),
        };
      }

      // 6. Persist the sessionId in the in-memory state.
      await deps.instanceManager.update(instanceId, {
        sessionId: sessionRes.value.id,
        status: "running",
      });

      // 7. POST /session/{id}/prompt_async.
      const messageID = generateMessageId();
      const sendRes = await deps.http.sendPrompt(
        {
          sessionId: sessionRes.value.id,
          messageID,
          agent: args.agent,
          ...(modelOverride ? { model: modelOverride } : {}),
          parts: [{ type: "text", text: args.prompt }],
        },
        deps.worktree,
      );
      if (!sendRes.ok) {
        await deps.instanceManager.update(instanceId, {
          status: "failed",
          error: `POST /session/{id}/prompt_async failed: ${sendRes.error}`,
          completedAt: Date.now(),
        });
        return {
          output: JSON.stringify({
            error: `spawn failed: ${sendRes.error}`,
            instanceId,
            sessionId: sessionRes.value.id,
            status: "failed",
          }),
        };
      }

      return {
        output: JSON.stringify({
          instanceId,
          sessionId: sessionRes.value.id,
          status: "pending",
        }),
      };
    },
  });
}

// --- Helpers --------------------------------------------------------------

function buildLogPath(worktree: string, instanceId: string): string {
  // The log file is owned by the opencode serve child (not by us). The
  // plugin doesn't write to it. We still record the conventional path so
  // the user can `cat` the per-session log for diagnostics.
  return `${worktree}/.opencode/log/${instanceId}.log`;
}
