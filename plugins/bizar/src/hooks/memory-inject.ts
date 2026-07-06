/**
 * plugins/bizar/src/hooks/memory-inject.ts
 *
 * Session-start memory injection hook.
 *
 * Fires on `session.created` event, searches the memory vault for
 * relevant context based on the user's initial message, and queues a
 * Memory Context injection into the system prompt via
 * `experimental.chat.system.transform`.
 *
 * Key design decisions:
 *   - Fires ONCE per session (idempotent via `ctx._memoryInjectedSessions`)
 *   - Uses the first user message text as the search query
 *   - Reads top 3 results and injects a "## Memory Context" section
 *   - Skips if no results found (no empty section)
 *   - Configurable via `settings.memory.injectOnSessionStart` (default true)
 *   - Non-blocking: memory search is fire-and-forget
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

/** How many memory results to inject at most */
const MAX_INJECT_RESULTS = 3;

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

/**
 * Search memory vault via the dashboard API.
 * Returns up to `limit` results.
 */
async function searchMemory(
  port: number,
  query: string,
  limit = 5,
): Promise<Array<{ path: string | null; snippet: string; score: number }>> {
  try {
    // Try semantic first, then fall back to FTS
    const baseUrl = `http://127.0.0.1:${port}`;

    // Semantic search via LightRAG
    const semRes = await fetch(`${baseUrl}/api/memory/semantic-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["lightrag", "obsidian"] }),
    });

    if (semRes.ok) {
      const data = (await semRes.json()) as {
        results?: Array<{
          relPath?: string | null;
          snippet?: string;
          score?: number;
        }>;
      };
      if (data.results && data.results.length > 0) {
        return (data.results).map((r) => ({
          path: r.relPath ?? null,
          snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 500) : String(r.snippet ?? ""),
          score: typeof r.score === "number" ? r.score : 1,
        }));
      }
    }

    // Fall back to FTS
    const ftsRes = await fetch(
      `${baseUrl}/api/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { method: "GET" },
    );
    if (ftsRes.ok) {
      const data = (await ftsRes.json()) as {
        results?: Array<{ relPath?: string; snippet?: string; score?: number }>;
      };
      if (data.results) {
        return data.results.map((r) => ({
          path: r.relPath ?? null,
          snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 500) : String(r.snippet ?? ""),
          score: typeof r.score === "number" ? r.score : 0,
        }));
      }
    }
  } catch {
    // non-fatal: memory injection should not break session start
  }
  return [];
}

/**
 * Extract a search query from the first user message.
 * Uses a simple heuristic: first 50 chars + key nouns.
 */
function buildSearchQuery(messageText: string): string {
  // Strip /commands, whitespace, quotes
  const cleaned = messageText.replace(/^[\/\s"\']+/, "").trim();
  // Take first meaningful chunk (up to 80 chars)
  const core = cleaned.slice(0, 80).split(/[.\n!?]/)[0] ?? cleaned;
  return core || cleaned.slice(0, 50);
}

/**
 * Format a memory result as a markdown section for injection.
 */
function formatMemoryContext(
  results: Array<{ path: string | null; snippet: string; score: number }>,
): string {
  const lines = ["## Memory Context\n"];
  lines.push(
    `_Automatically injected from the Bizar Memory vault. ${results.length} relevant note(s) found._\n`,
  );
  for (const r of results.slice(0, MAX_INJECT_RESULTS)) {
    if (r.path) {
      lines.push(`### ${r.path}`);
    } else {
      lines.push("### (semantic match)");
    }
    lines.push(`_${r.score > 0 ? `score: ${r.score.toFixed(2)}` : "full-text match"}_\n`);
    lines.push(r.snippet);
    lines.push("\n---\n");
  }
  return lines.join("\n");
}

export interface MemoryInjectDeps {
  /** Set of sessionIds that have already been injected (cleared on session.deleted). */
  injectedSessions: Set<string>;
  worktree: string;
  logger: Logger;
  /** If false, skip injection entirely (configurable via settings). */
  enabled: boolean;
}

/**
 * Build the session-start memory injection logic.
 * Call this from the `event` hook for `session.created` events.
 *
 * Usage in index.ts `event` hook:
 *   const memoryInjectDeps = { injectedSessions, worktree, logger, enabled: true };
 *   const { memoryInject } = createMemoryInject(memoryInjectDeps);
 *   // in event handler:
 *   if (type === "session.created") {
 *     memoryInject(sessionID, userMessageText).catch(() => {});
 *   }
 *
 * The `injectedSessions` Set is also checked/cleared in `session.deleted`.
 */
export function createMemoryInject(deps: MemoryInjectDeps) {
  const { injectedSessions, logger } = deps;

  /**
   * Fire memory search and queue the result for injection.
   * Safe to await or fire-and-forget — errors are swallowed.
   */
  async function memoryInject(
    sessionID: string,
    userMessageText: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!deps.enabled) return;
    if (injectedSessions.has(sessionID)) return;

    // Mark injected BEFORE the async work so we don't double-fire
    // even if the request races.
    injectedSessions.add(sessionID);

    try {
      const port = await resolveDashboardPort();
      if (!port) return;

      const query = buildSearchQuery(userMessageText);
      if (!query) return;

      const results = await searchMemory(port, query, 5);
      if (results.length === 0) return;

      const context = formatMemoryContext(results);

      // We can't directly push to output.system here (we're in the `event` hook).
      // Instead, we use the `pendingInjections` map in the RuntimeContext
      // (same mechanism used for loop guard injections).
      // The `experimental.chat.system.transform` hook already checks this map.
      // We store it under a special marker so the transform hook can distinguish it.
      // But wait — pendingInjections only holds ONE message at a time.
      // We need a separate mechanism... Actually, looking at the transform hook:
      //   const pending = ctx.pendingInjections.get(sessionID);
      //   if (pending) { output.system.push(pending); ctx.pendingInjections.delete(sessionID); }
      // This only allows ONE injection at a time.
      //
      // Alternative: use a separate Map for memory injections.
      // The transform hook checks ctx._memoryInjections.get(sessionID) separately.
      //
      // Since we control both the injection (here) and the hook (in index.ts),
      // we can add a second map. Let's use ctx._memoryPendingInjections.

      // Signal that we have memory to inject by setting a flag.
      // The actual injection happens in experimental.chat.system.transform.
      // We use a module-level store that the transform hook reads.
      _pendingMemoryContext.set(sessionID, context);
    } catch (err) {
      // Non-fatal: don't let a failed memory injection break session start.
      logger.debug(
        `bizar: memory-inject failed for session ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { memoryInject };
}

/**
 * Module-level store for pending memory context injections.
 * The `experimental.chat.system.transform` hook reads this and injects
 * the queued context into the system prompt.
 */
export const _pendingMemoryContext = new Map<string, string>();

/**
 * Retrieve and clear any pending memory context for a session.
 * Called from `experimental.chat.system.transform`.
 */
export function popMemoryContext(sessionID: string): string | null {
  const ctx = _pendingMemoryContext.get(sessionID);
  _pendingMemoryContext.delete(sessionID);
  return ctx ?? null;
}
