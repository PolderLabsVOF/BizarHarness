/**
 * plugins/bizar/src/tools/bg-send-message.ts
 *
 * v5.5.1 — `bizar_send_message` tool. TRUE mid-flight steer.
 *
 * In v5.5.0 this tool returned `unavailable_in_subprocess_mode` because
 * `opencode run` is a one-shot CLI. v5.5.1 switched bg agents to
 * long-lived opencode serve SDK sessions, so this tool now delegates
 * to `POST /api/background/<id>/steer` on the dashboard. The dashboard
 * calls `sdk.sessions.prompt()` on the live session, which the
 * opencode serve child picks up mid-loop as the next user turn.
 *
 * Wire contract (mirrors `bizar-dash/src/server/routes/background.mjs`):
 *   - Request: `POST /api/background/:id/steer` with body `{ message }`.
 *   - Response: `{ ok, mode: 'true_midflight', newInstanceId: null, instanceId, steerCount }`.
 *
 * Errors surface as `{ ok: false, error }` so callers can react.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

import type { InstanceManager } from "../background.js";
import type { Logger } from "../logger.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface BgSendMessageDeps {
  instanceManager: InstanceManager;
  logger: Logger;
  /**
   * Optional injection point for tests. When provided, the dashboard
   * HTTP call is short-circuited and the test function is called with
   * the resolved request shape.
   */
  _dashboardPost?: (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

// --- Dashboard URL + token (mirrors bg-spawn.ts) ------------------------

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

async function postJsonToDashboard(
  url: string,
  body: unknown,
  override?: BgSendMessageDeps["_dashboardPost"],
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
}

export function createBgSendMessageTool(deps: BgSendMessageDeps) {
  return tool({
    description:
      "Send a follow-up message to a running background agent. " +
      "v5.5.1: TRUE mid-flight steer via the opencode serve SDK. " +
      "The same instance keeps running; the new message becomes the next user turn " +
      "of the running opencode session. No kill+respawn, no [STEERED <ts>] marker, " +
      "no loss of agent context.",
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
    execute: async (rawArgs, _ctx) => {
      const args = rawArgs as { instanceId: string; message: string };
      // 1. Verify the instance exists so we don't silently accept bogus ids.
      const inst = await deps.instanceManager.get(args.instanceId);
      if (!inst) {
        return {
          output: JSON.stringify({
            error: "instance_not_found",
            instanceId: args.instanceId,
          }),
        };
      }

      // 2. v5.5.1 — delegate to the dashboard. The dashboard owns the
      //    opencode SDK and calls `sdk.sessions.prompt({...})` on the
      //    live session, which the opencode serve child picks up
      //    mid-loop as the next user turn.
      const dashboardUrl = `${resolveDashboardUrl()}/api/background/${encodeURIComponent(args.instanceId)}/steer`;
      try {
        const data = (await postJsonToDashboard(
          dashboardUrl,
          { message: args.message },
          deps._dashboardPost,
        )) as { ok: boolean; mode?: string; steerCount?: number; error?: string };
        if (!data || data.ok !== true) {
          return {
            output: JSON.stringify({
              error: data?.error || "steer_failed",
              instanceId: args.instanceId,
            }),
          };
        }
        deps.logger.info(
          `bizar: sendMessage(${args.instanceId}) — TRUE mid-flight steer #${data.steerCount ?? "?"} accepted`,
        );
        return {
          output: JSON.stringify({
            ok: true,
            mode: data.mode || "true_midflight",
            instanceId: args.instanceId,
            steerCount: data.steerCount ?? 0,
            message:
              "Steer delivered to the running opencode session. The agent will pick up your message as the next user turn — no kill+respawn was performed, no context was lost.",
          }),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: sendMessage(${args.instanceId}) failed: ${msg}`);
        return {
          output: JSON.stringify({
            error: `steer_failed: ${msg}`,
            instanceId: args.instanceId,
          }),
        };
      }
    },
  });
}