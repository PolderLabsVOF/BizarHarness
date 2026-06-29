/**
 * dashboard-client.ts
 *
 * v0.7.0-alpha.1 — Plugin-side bridge to the Bizar dashboard via the
 * @polderlabs/bizar-sdk. Replaces (does not remove) the file-based
 * `serve-info.ts` bridge.
 *
 * Usage:
 *   import { createDashboardPublisher } from "./dashboard-client.js";
 *
 *   const publisher = createDashboardPublisher({
 *     logger: myLogger,
 *   });
 *   await publisher.start();
 *   publisher.publish({
 *     type: "session.created",
 *     properties: { sessionId: "ses_1", agent: "mimir" },
 *   });
 *
 * Behavior:
 *   - Reads `BIZAR_DASHBOARD_URL` (default http://127.0.0.1:4098).
 *   - Reads `BIZAR_DASHBOARD_PASSWORD` first, then falls back to
 *     `~/.cache/bizarharness/dash-auth.json` (the file written by the
 *     dashboard on first start).
 *   - `publish()` is fire-and-forget: returns a Promise that resolves
 *     after one HTTP round-trip or rejects on failure. NEVER throws
 *     into the caller — failures are logged and swallowed (the plugin
 *     must keep running even when the dashboard is down).
 *   - `publish()` queues events if the dashboard is unreachable and
 *     drains the queue on reconnect (best-effort).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
// v4.0.0 — SDK is part of the same package at packages/sdk/.
// The SDK must be built (npm run build:sdk) before the plugin is compiled.
import { createBizarClient, isBizarError } from "../../../packages/sdk/dist/index.js";
import type { BizarClient, DashboardEvent } from "../../../packages/sdk/dist/index.js";

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:4098";
const DEFAULT_AUTH_FILE_PATHS = [
  join(homedir(), ".cache", "bizarharness", "dash-auth.json"),
  join(homedir(), ".cache", "bizar", "dash-auth.json"),
];
/**
 * The auth file paths to search. Override at test-time via
 * `process.env.BIZAR_DASHBOARD_AUTH_FILE` (single file) or
 * `process.env.BIZAR_DASHBOARD_AUTH_FILES` (colon-separated list).
 */
function getAuthFilePaths(): string[] {
  const single = process.env.BIZAR_DASHBOARD_AUTH_FILE;
  if (single) return [single];
  const multi = process.env.BIZAR_DASHBOARD_AUTH_FILES;
  if (multi) return multi.split(":").filter(Boolean);
  return DEFAULT_AUTH_FILE_PATHS;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DashboardPublisherOptions {
  logger: Logger;
  baseUrl?: string;
  password?: string;
  /** Disable the publisher entirely (e.g. BIZAR_DASHBOARD_DISABLE=1). */
  disabled?: boolean;
  /** Max queued events while the dashboard is unreachable. */
  queueLimit?: number;
}

/**
 * Read the dashboard auth record from one of the candidate paths.
 * Returns null if no usable file exists. Never throws.
 */
function readDashboardAuth(): { password: string; baseUrl?: string; port?: number } | null {
  for (const candidate of getAuthFilePaths()) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as {
        password?: unknown;
        baseUrl?: unknown;
        port?: unknown;
      };
      if (typeof parsed.password !== "string" || parsed.password.length < 16) continue;
      return {
        password: parsed.password,
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
        port: typeof parsed.port === "number" ? parsed.port : undefined,
      };
    } catch {
      // ignore malformed file
    }
  }
  return null;
}

export interface DashboardPublisher {
  start(): Promise<void>;
  publish(event: DashboardEvent): Promise<void>;
  stop(): void;
  /** Whether the publisher is currently configured and ready. */
  isReady(): boolean;
}

export function createDashboardPublisher(
  options: DashboardPublisherOptions,
): DashboardPublisher {
  const { logger, disabled = false, queueLimit = 100 } = options;

  let client: BizarClient | null = null;
  const queue: DashboardEvent[] = [];
  let flushing = false;

  function resolveConfig(): { baseUrl: string; password: string } | null {
    let baseUrl = options.baseUrl ?? process.env.BIZAR_DASHBOARD_URL;
    if (!baseUrl) {
      const port = process.env.BIZAR_DASHBOARD_PORT;
      baseUrl = port ? `http://127.0.0.1:${port}` : DEFAULT_DASHBOARD_URL;
    }
    const password =
      options.password ??
      process.env.BIZAR_DASHBOARD_PASSWORD ??
      readDashboardAuth()?.password;

    if (!password) {
      return null;
    }
    return { baseUrl, password };
  }

  function isReady(): boolean {
    return client !== null;
  }

  async function start(): Promise<void> {
    if (disabled) {
      logger.debug("bizar: dashboard publisher disabled by config");
      return;
    }
    const cfg = resolveConfig();
    if (!cfg) {
      logger.debug(
        "bizar: dashboard publisher not started (no password in env or auth file)",
      );
      return;
    }
    client = createBizarClient({
      baseUrl: cfg.baseUrl,
      password: cfg.password,
    });
    logger.info(
      `bizar: dashboard publisher started (url=${cfg.baseUrl}, password len=${cfg.password.length})`,
    );

    // Verify the dashboard is reachable. Non-fatal — publish() will retry
    // and surface connection errors as warnings.
    try {
      const health = await client.health.check();
      if (isBizarError(health)) {
        logger.warn(
          `bizar: dashboard unreachable at ${cfg.baseUrl} (${health.name}); publish events will be queued`,
        );
      }
    } catch (err) {
      logger.warn(
        `bizar: dashboard health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    void flushQueue();
  }

  async function publish(event: DashboardEvent): Promise<void> {
    if (!client) {
      logger.debug(
        `bizar: dashboard publisher not ready — dropping event ${event.type}`,
      );
      return;
    }
    if (queue.length >= queueLimit) {
      queue.shift();
      logger.warn(
        `bizar: dashboard publisher queue full (${queueLimit}); dropping oldest event`,
      );
    }
    queue.push(event);
    if (!flushing) {
      void flushQueue();
    }
  }

  async function flushQueue(): Promise<void> {
    if (flushing || !client) return;
    flushing = true;
    try {
      while (queue.length > 0 && client) {
        const next = queue.shift()!;
        try {
          const result = await client.events.publish(next);
          if (isBizarError(result)) {
            logger.warn(
              `bizar: dashboard publish failed (${result.name}); requeueing ${next.type}`,
            );
            queue.unshift(next);
            break;
          }
        } catch (err) {
          logger.warn(
            `bizar: dashboard publish threw: ${err instanceof Error ? err.message : String(err)}`,
          );
          queue.unshift(next);
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  function stop(): void {
    client = null;
    queue.length = 0;
    logger.debug("bizar: dashboard publisher stopped");
  }

  return { start, publish, stop, isReady };
}
