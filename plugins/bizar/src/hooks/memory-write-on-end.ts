/**
 * plugins/bizar/src/hooks/memory-write-on-end.ts
 *
 * Session-end memory write hook.
 *
 * Fires on `session.idle` (natural completion) or `session.error` events.
 * Writes an automated session summary to the memory vault at:
 *   sessions/<date>-<session-id>.md
 *
 * Key design decisions:
 *   - Configurable: `settings.memory.writeOnSessionEnd` (default true)
 *   - Non-blocking: write is fire-and-forget (success logged, failure warned)
 *   - Idempotent: if the same session fires multiple terminal events,
 *     only the first write succeeds (check if note already exists via API)
 *   - Uses the dashboard API (POST /api/memory/notes) for consistency
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

const SESSION_NOTES_PREFIX = "sessions/";

export interface MemoryWriteOnEndDeps {
  worktree: string;
  logger: Logger;
  enabled: boolean;
}

/**
 * Resolve the dashboard server port. Returns null if not available.
 */
export async function resolveDashboardPort(): Promise<number | null> {
  const portFile = join(homedir(), ".config", "bizar", "dashboard.port");
  if (existsSync(portFile)) {
    try {
      const raw = readFileSync(portFile, "utf8").trim();
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
    } catch {
      // fall through
    }
  }
  const envPort = process.env.BIZAR_DASHBOARD_PORT;
  if (envPort) {
    const n = parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return null;
}

interface SessionEndInfo {
  sessionID: string;
  agent: string;
  startedAt: number;
  endedAt: number;
  status: "idle" | "error" | "killed";
  error?: string;
}

/**
 * Build a session summary note body.
 */
function buildSessionSummary(
  info: SessionEndInfo,
  conversationPreview: string,
): string {
  const durationMin = Math.round((info.endedAt - info.startedAt) / 60_000);
  const started = new Date(info.startedAt).toISOString();
  const ended = new Date(info.endedAt).toISOString();

  const lines: string[] = [
    `# Session Summary: ${info.sessionID.slice(0, 8)}…`,
    "",
    `**Agent:** ${info.agent}`,
    `**Started:** ${started}`,
    `**Ended:** ${ended}`,
    `**Duration:** ~${durationMin} min`,
    `**Status:** ${info.status}${info.error ? ` — ${info.error}` : ""}`,
    "",
    "## Conversation Preview",
    "",
    conversationPreview.slice(0, 2000),
    "",
    "## Key Decisions",
    "",
    "- *(add your key decisions here)*",
    "",
    "## Tools Used",
    "",
    "- *(tools used during this session)*",
    "",
    "## Errors / Issues",
    info.error ? `\n${info.error}\n` : "- *(no errors)*",
  ];

  return lines.join("\n");
}

/**
 * Write a session summary note to the memory vault.
 */
async function writeSessionSummary(
  port: number,
  info: SessionEndInfo,
  conversationPreview: string,
  worktree: string,
  logger: Logger,
): Promise<void> {
  const date = new Date(info.startedAt).toISOString().slice(0, 10); // YYYY-MM-DD
  const slug = `${date}-${info.sessionID.slice(0, 8)}.md`;
  const relPath = `${SESSION_NOTES_PREFIX}${slug}`;

  const body = buildSessionSummary(info, conversationPreview);

  const payload = {
    path: relPath,
    frontmatter: {
      type: "session-summary",
      session_id: info.sessionID,
      started_at: new Date(info.startedAt).toISOString(),
      ended_at: new Date(info.endedAt).toISOString(),
      duration_minutes: Math.round((info.endedAt - info.startedAt) / 60_000),
      agent: info.agent,
      project: worktree.split("/").pop() ?? "unknown",
      tags: ["auto-generated"],
      status: info.status,
    },
    body,
  };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/memory/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok || res.status === 409) {
      // 409 = already exists (idempotent)
      logger.debug(`bizar: session summary written for ${info.sessionID.slice(0, 8)}`);
    } else {
      const text = await res.text().catch(() => "");
      logger.warn(`bizar: session summary write failed for ${info.sessionID.slice(0, 8)}: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`bizar: session summary write failed for ${info.sessionID.slice(0, 8)}: ${msg}`);
  }
}

/**
 * Create the session-end memory write hook.
 *
 * Usage in index.ts `event` hook:
 *   const { memoryWriteOnEnd } = createMemoryWriteOnEnd(deps);
 *   if (type === "session.idle" || type === "session.error") {
 *     memoryWriteOnEnd(sessionID, eventPayload).catch(() => {});
 *   }
 */
export function createMemoryWriteOnEnd(deps: MemoryWriteOnEndDeps) {
  const { logger } = deps;

  /** Sessions that have already been written (idempotency). */
  const _writtenSessions = new Set<string>();

  async function memoryWriteOnEnd(
    sessionID: string,
    info: SessionEndInfo,
    conversationPreview: string,
  ): Promise<void> {
    if (!deps.enabled) return;
    if (_writtenSessions.has(sessionID)) return;
    _writtenSessions.add(sessionID);

    const port = await resolveDashboardPort();
    if (!port) {
      logger.debug(`bizar: session-end memory write skipped — dashboard not running`);
      return;
    }

    await writeSessionSummary(port, info, conversationPreview, deps.worktree, logger);
  }

  return { memoryWriteOnEnd };
}
