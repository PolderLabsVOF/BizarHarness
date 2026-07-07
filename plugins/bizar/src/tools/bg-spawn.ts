/**
 * plugins/bizar/src/tools/bg-spawn.ts
 *
 * v5.5.1 — `bizar_spawn_background` tool, refactored to delegate to the
 * dashboard's SDK-based spawner (`POST /api/background`) instead of
 * spawning `cline run` subprocesses directly.
 *
 * Why the plugin now talks to the dashboard instead of running `cline run`:
 *   - The v5.5.0 design (cline-runner.ts) spawned one `cline run`
 *     subprocess per agent. Steering a running agent required
 *     kill+respawn with a `[STEERED <ts>]` marker — a poor approximation
 *     of "true mid-flight prompt".
 *   - cline's serve child exposes long-lived SDK sessions that accept
 *     new prompts via `POST /api/session/{id}/prompt`. Steering is then
 *     a real mid-flight redirect: the same session keeps running, the
 *     new prompt becomes the next user turn.
 *   - The dashboard already owns the cline SDK (see
 *     `bizar-dash/src/server/cline-sdk.mjs`); it can mediate between
 *     the plugin's many bg instances and the single cline serve child.
 *
 * This tool therefore:
 *   1. Validates the request (Odin-only check, model parsing,
 *      timeoutMs clamping — unchanged from v5.5.0).
 *   2. Builds the delegation wrapper prompt if the agent is a subagent.
 *   3. POSTs `{ agent, prompt, worktree, ... }` to the dashboard at
 *      `POST /api/background`.
 *   4. Tracks the returned instance in the local InstanceManager so the
 *      existing `bizar_status`, `bizar_collect`, `bizar_kill`,
 *      `bizar_pause`, `bizar_resume` tools work unchanged (they now
 *      delegate to the dashboard HTTP API too — see respective tool files).
 *
 * Backwards compat: the public tool args are unchanged. The return
 * shape is backwards compatible — `instanceId` + `sessionId` are still
 * present, but `processId` is `null` (no OS subprocess) and a new
 * `liveSession: true` flag indicates the new SDK-backed mode.
 *
 * Spec §1, §6.3, §7.1.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_SPAWN_BACKGROUND_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...).shape` over the same fields as before.
 *   - Returns structured `{ instanceId, sessionId, ... }` /
 *     `{ error, ... }` instead of `{ output: JSON.stringify(...) }`.
 *   - `ctx.agent` becomes `context.metadata.parentAgent` look-up.
 */
import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";

import { generateInstanceId } from "../background.js";
import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";
import { resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const BIZAR_SPAWN_BACKGROUND_TOOL_NAME = "bizar_spawn_background";

/** Spec §7.3: `timeoutMs` clamped to [1000, 1800000] (1s..30min). */
const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 300_000;

/**
 * Agents whose `mode` is `primary` and therefore accepted by
 * cline's `--agent` flag.
 *
 * Exported for testability — the test asserts the set is in sync with
 * the agent configs.
 */
export const PRIMARY_AGENTS: ReadonlySet<string> = new Set([
  "odin",
  "quick",
  "agent-browser",
]);

/**
 * Decide whether a given agent name needs the delegation wrapper.
 * Pure function, exported for testability.
 */
export function needsDelegationWrapper(agent: string): boolean {
  return !PRIMARY_AGENTS.has(agent);
}

/**
 * Build the delegation prompt that wraps a subagent request.
 *
 * Exported for testability.
 */
export function buildDelegationPrompt(requestedAgent: string, userPrompt: string): string {
  return [
    "You are Odin, the BizarHarness router.",
    "",
    "A background agent session has been requested with a SPECIFIC subagent.",
    "Your only job is to delegate to that subagent using the `task` tool. Do NOT",
    "perform the work yourself. Do NOT interpret the user's prompt. Do NOT ask",
    "clarifying questions. Do NOT route to any other agent.",
    "",
    `Requested subagent: ${requestedAgent}`,
    "",
    "Task prompt to pass verbatim to the subagent:",
    "--- BEGIN USER PROMPT ---",
    userPrompt,
    "--- END USER PROMPT ---",
    "",
    `Use the task tool with agent="${requestedAgent}" and the exact prompt above.`,
    "After the subagent finishes, report its final output VERBATIM.",
    "Do not summarize, do not add commentary, do not run any other tools.",
  ].join("\n");
}

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
  /**
   * Optional injection point for tests. When provided, the dashboard
   * HTTP call is short-circuited and the test function is called with
   * the resolved request shape. Production code never sets this.
   */
  _dashboardPost?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

export type BizarBgSpawnInput = z.infer<typeof bizarBgSpawnSchema>;

export type BizarBgSpawnSuccess = {
  instanceId: string;
  dashboardInstanceId: string | undefined;
  sessionId: string | null;
  processId: null;
  status: string;
  liveSession: true;
  message: string;
  nextSteps: string[];
  model?: string;
};

export type BizarBgSpawnOutput =
  | BizarBgSpawnSuccess
  | { error: string; instanceId?: string; sessionId?: string | null; status?: string };

const bizarBgSpawnSchema = z.object({
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
});

/**
 * Compute the LogWriter's actual log path for a given instanceId. Mirrors
 * the convention used by `bg-spawn.ts` pre-v5.5.1 so existing log readers
 * (dashboard's log viewer) find the file in the same place.
 */
function buildLogPath(instanceId: string): string {
  const logDir = process.env.BIZAR_LOG_DIR || pathResolve(homedir(), ".cache", "bizar", "logs");
  return pathResolve(logDir, `${instanceId}.log`);
}

// --- Dashboard HTTP wiring -----------------------------------------------

/**
 * Resolve the dashboard base URL. Order:
 *   1. `BIZAR_DASHBOARD_URL` env override (matches dashboard-client.ts).
 *   2. `BIZAR_DASHBOARD_PORT` env override → `http://127.0.0.1:<port>`.
 *   3. Default `http://127.0.0.1:4098` (matches dashboard default port
 *      in install.sh + bizarre installer).
 */
function resolveDashboardUrl(): string {
  const fromEnv = process.env.BIZAR_DASHBOARD_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  const port = process.env.BIZAR_DASHBOARD_PORT;
  if (port && /^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
  return "http://127.0.0.1:4098";
}

const DEFAULT_DASHBOARD_AUTH_PATHS = [
  join(homedir(), ".config", "bizar", "dashboard-secret"),
  join(homedir(), ".cache", "bizarharness", "dash-auth.json"),
  join(homedir(), ".cache", "bizar", "dash-auth.json"),
];

/**
 * Read the dashboard bearer token from the on-disk secret file. The
 * dashboard writes `~/.config/bizar/dashboard-secret` (mode 0600) on
 * first boot. Loopback requests don't need the token (auth middleware
 * trusts loopback automatically), but we send it anyway when available
 * so a non-loopback deployment works without extra config.
 */
function readDashboardToken(): string {
  for (const candidate of DEFAULT_DASHBOARD_AUTH_PATHS) {
    try {
      if (!existsSync(candidate)) continue;
      const text = readFileSync(candidate, "utf-8").trim();
      if (text && text.length >= 16) return text;
    } catch {
      /* ignore */
    }
  }
  // Fall back to the password (dash-auth.json carries a `password` field).
  for (const candidate of DEFAULT_DASHBOARD_AUTH_PATHS) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { password?: unknown };
      if (typeof parsed.password === "string" && parsed.password.length >= 16) {
        return parsed.password;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * POST JSON to the dashboard. Returns the parsed JSON on 2xx; throws a
 * structured `Error` (with `.httpStatus`) on transport / non-2xx so
 * callers can surface a clear error to the agent.
 *
 * In tests, `deps._dashboardPost` overrides this with a mock.
 */
async function postJsonToDashboard(
  url: string,
  body: unknown,
  logger: Logger,
  override?: BgSpawnDeps["_dashboardPost"],
): Promise<unknown> {
  if (override) {
    const res = await override(url, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.json().catch(() => ({}));
      const err = new Error(
        `dashboard HTTP ${res.status}: ${JSON.stringify(text).slice(0, 200)}`,
      );
      (err as Error & { httpStatus?: number }).httpStatus = res.status;
      throw err;
    }
    return res.json();
  }

  const token = readDashboardToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `dashboard HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
      (err as Error & { httpStatus?: number }).httpStatus = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
  void logger;
}

/**
 * Build the `bizar_spawn_background` tool. The plugin wires the
 * result into `api.registerTool()` from `AgentExtensionApi`. The
 * `deps` closure carries the per-process state (InstanceManager,
 * worktree, logger).
 */
export function createBgSpawnTool(
  deps: BgSpawnDeps,
): AgentTool<BizarBgSpawnInput, BizarBgSpawnOutput> {
  return createTool({
    name: BIZAR_SPAWN_BACKGROUND_TOOL_NAME,
    description:
      "Spawn a background agent that runs asynchronously as a long-lived cline serve session " +
      "(SDK-backed via the dashboard). " +
      "Only Odin may call this tool. " +
      "Returns an instanceId immediately (sub-second), then the agent runs to completion in the background. " +
      "Use `bizar_status` / `bizar_collect` / `bizar_kill` to manage the instance. " +
      "Use `bizar_bg_view` (CLI) to watch all running agents in a tmux split window. " +
      "Steering is TRUE mid-flight via `bizar_send_message` (no kill+respawn). " +
      "IMPORTANT: do NOT block waiting for the agent. Return control to the user right after spawning.",
    inputSchema: bizarBgSpawnSchema.shape,
    execute: async (input, context) => {
      // 1. Odin-only (MEDIUM-26).
      const parentAgent =
        (context.metadata as { parentAgent?: string } | undefined)?.parentAgent ?? null;
      if (parentAgent !== "odin") {
        return {
          error:
            "Only Odin can spawn background agents. Use the task tool for sync work, or ask Odin to spawn a background agent.",
        };
      }

      // 2. Validate the model parameter (LOW-34 / §1.4).
      let modelOverride: ModelOverride | undefined;
      if (input.model !== undefined && input.model !== "") {
        const m = parseModel(input.model);
        if (m === null) {
          return {
            error: `model must be in "providerID/modelID" format (e.g. "cline/deepseek-v4-flash-free"). Omit to use the agent's default.`,
          };
        }
        modelOverride = m;
      }

      // 3. Clamp timeoutMs (MEDIUM-33 / §7.3).
      const requested = input.timeoutMs ?? TIMEOUT_DEFAULT_MS;
      if (requested < TIMEOUT_MIN_MS || requested > TIMEOUT_MAX_MS) {
        return {
          error: `timeoutMs must be between ${TIMEOUT_MIN_MS} (1s) and ${TIMEOUT_MAX_MS} (30min). Got ${requested}.`,
        };
      }
      const timeoutMs = requested;

      // 4. Build the delegation wrapper (mirrors bg-spawn.ts pre-v5.5.1).
      const isPrimary = PRIMARY_AGENTS.has(input.agent);
      const wrapperPrompt = isPrimary
        ? input.prompt
        : buildDelegationPrompt(input.agent, input.prompt);

      // 5. Pre-allocate the instanceId so we can track BEFORE the
      //    dashboard call (track-before-HTTP, HIGH-21). The dashboard
      //    generates its own instanceId, but accepting ours would
      //    require a second round-trip — instead we accept the
      //    dashboard's id and patch it back in. The local InstanceManager
      //    mirrors the dashboard state so `bizar_status` works.
      const instanceId = generateInstanceId();
      const logPath = buildLogPath(instanceId);
      const draft = {
        instanceId,
        sessionId: "", // filled in once the dashboard returns the sessionId
        agent: input.agent,
        model: modelOverride
          ? `${modelOverride.providerID}/${modelOverride.modelID}`
          : "agent-default",
        promptPreview: input.prompt.slice(0, 200),
        prompt: input.prompt, // store full prompt for restart support
        parentAgent,
        logPath,
        timeoutMs,
        toolCallCount: 0,
        persistent: input.persistent ?? false,
        maxRestarts: input.maxRestarts ?? 3,
        restartCount: 0,
        progress: 0,
        toolCalls: [],
      };
      const addRes = await deps.instanceManager.add(draft);
      if (addRes === "cap_reached") {
        return {
          error: `Max concurrent instances reached. Wait for one to finish or call bizar_kill.`,
        };
      }

      // 6. POST to the dashboard. The dashboard owns the SDK and the
      //    underlying cline session; we mirror its instanceId.
      const dashboardUrl = `${resolveDashboardUrl()}/api/background`;
      let spawnRes: { instanceId: string; sessionId: string | null; status?: string; liveSession?: boolean };
      try {
        spawnRes = (await postJsonToDashboard(
          dashboardUrl,
          {
            agent: input.agent,
            prompt: wrapperPrompt,
            model: modelOverride
              ? `${modelOverride.providerID}/${modelOverride.modelID}`
              : undefined,
            worktree: deps.worktree,
            timeoutMs,
            persistent: Boolean(input.persistent),
            maxRestarts: input.maxRestarts ?? 3,
            tags: [`spawned-by:${parentAgent}`, `plugin-instance:${instanceId}`],
          },
          deps.logger,
          deps._dashboardPost,
        )) as { instanceId: string; sessionId: string | null; status?: string; liveSession?: boolean };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await deps.instanceManager.update(instanceId, {
          status: "failed",
          error: `dashboard POST /api/background failed: ${msg}`,
          completedAt: Date.now(),
        });
        return {
          error: `spawn failed: dashboard unreachable (${msg}). Make sure the Bizar dashboard is running.`,
          instanceId,
          sessionId: null,
          status: "failed",
        };
      }

      // 7. The dashboard allocates its own instanceId. Patch our local
      //    record to mirror the dashboard state — keep the original
      //    instanceId we returned to the caller (the plugin's existing
      //    InstanceManager tracks by that id, and the dashboard already
      //    has the same metadata via the `tags: ["plugin-instance:<id>"]`
      //    we sent above).
      if (spawnRes.instanceId && spawnRes.instanceId !== instanceId) {
        // Update the local record's sessionId + flags; the local id stays
        // as-is so all subsequent tool calls (status/collect/kill/...)
        // resolve correctly. The dashboard id is stored alongside as
        // `dashboardInstanceId` for cross-referencing.
        await deps.instanceManager.update(instanceId, {
          sessionId: spawnRes.sessionId || "",
          status: "running",
          runnerState: "running",
          sessionIdAt: Date.now(),
          liveSession: true,
          dashboardInstanceId: spawnRes.instanceId,
        });
      } else {
        await deps.instanceManager.update(instanceId, {
          sessionId: spawnRes.sessionId || "",
          status: "running",
          runnerState: "running",
          sessionIdAt: Date.now(),
          liveSession: true,
        });
      }

      // 8. Return the spawn result. v5.5.1 message: the agent is
      //    running in the background on an cline serve session; Odin
      //    should return control to the user immediately.
      return {
        instanceId,
        dashboardInstanceId: spawnRes.instanceId,
        sessionId: spawnRes.sessionId,
        processId: null, // no subprocess; the cline serve child owns the session
        status: "running",
        liveSession: true,
        message:
          "Background agent started. It runs as an cline serve SDK session managed by the Bizar dashboard. " +
          "Use `bizar_status <instanceId>` to check progress, `bizar_collect <instanceId>` to wait for the result, " +
          "`bizar_send_message <instanceId> <msg>` for true mid-flight steering, " +
          "or `bizar_kill <instanceId>` to stop it. Run `bizar bg view` in another terminal to watch all running agents live.",
        nextSteps: [
          "Tell the user the agent is running and approximately how long they should expect to wait",
          "If the user wants the result now, call `bizar_collect <instanceId>` (with a reasonable timeout)",
          "If the user wants to redirect the agent, call `bizar_send_message <instanceId> <msg>` — this is TRUE mid-flight",
          "If the user wants to stop the agent, call `bizar_kill <instanceId>`",
          "Do NOT block waiting for the result unless the user explicitly asked for it",
        ],
      };
    },
  });
}
