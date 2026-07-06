/**
 * plugins/bizar/src/tools/memory-search.ts
 *
 * `bizar_memory_search` tool — semantic and full-text search over the
 * Bizar Memory vault.
 *
 * Calls the dashboard's memory API:
 *   - semantic: POST /api/memory/semantic-search (LightRAG)
 *   - fts:      GET  /api/memory/search?q=...&limit=...
 *
 * Defaults to semantic if LightRAG is available, falls back to FTS.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export interface MemorySearchDeps {
  worktree: string;
  logger: Logger;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

/** Result shape returned to the agent. */
export interface MemorySearchResult {
  results: Array<{
    path: string | null;
    title: string | null;
    snippet: string;
    score: number;
    source: string;
  }>;
  query: string;
  mode: string;
  count: number;
}

/**
 * Resolve the dashboard server port by checking the port file first,
 * then falling back to the env var.
 */
async function resolveDashboardPort(): Promise<number | null> {
  // Check ~/.config/bizar/dashboard.port
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
  // Fallback: env var
  const envPort = process.env.BIZAR_DASHBOARD_PORT;
  if (envPort) {
    const n = parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return null;
}

/**
 * Perform semantic search via LightRAG /memory/semantic-search.
 */
async function semanticSearch(
  baseUrl: string,
  query: string,
  limit: number,
): Promise<{ results: MemorySearchResult["results"]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/memory/semantic-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["lightrag"] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { results: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      results?: Array<{
        source?: string;
        relPath?: string | null;
        snippet?: string;
        score?: number;
      }>;
      count?: number;
    };
    const results = (data.results ?? []).map((r) => ({
      path: r.relPath ?? null,
      title: null,
      snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 300) : String(r.snippet ?? ""),
      score: typeof r.score === "number" ? r.score : 1,
      source: r.source ?? "lightrag",
    }));
    return { results };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Perform full-text search via /memory/search.
 */
async function ftsSearch(
  baseUrl: string,
  query: string,
  limit: number,
): Promise<{ results: MemorySearchResult["results"]; error?: string }> {
  try {
    const url = `${baseUrl}/api/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { results: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      results?: Array<{
        relPath?: string;
        snippet?: string;
        score?: number;
      }>;
    };
    const results = (data.results ?? []).map((r) => ({
      path: r.relPath ?? null,
      title: null,
      snippet: typeof r.snippet === "string" ? r.snippet.slice(0, 300) : String(r.snippet ?? ""),
      score: typeof r.score === "number" ? r.score : 0,
      source: "fts",
    }));
    return { results };
  } catch (err) {
    return { results: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function createMemorySearchTool(deps: MemorySearchDeps) {
  return tool({
    description:
      "Search the Bizar Memory vault for relevant notes. " +
      "Performs semantic search via LightRAG by default (best for concepts, synonyms, intent). " +
      "Falls back to full-text search when semantic is unavailable. " +
      "Available to all agents. " +
      "Returns { query, mode, count, results: [{ path, title, snippet, score, source }] }.",
    args: {
      query: z
        .string()
        .min(1)
        .describe("Natural-language search query."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe(`Max results to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`),
      mode: z
        .enum(["semantic", "fts"])
        .optional()
        .default("semantic")
        .describe('Search mode: "semantic" (LightRAG, default) or "fts" (full-text).'),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { query: string; limit?: number; mode?: "semantic" | "fts" };
      const { logger } = deps;
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

      const port = await resolveDashboardPort();
      if (!port) {
        return {
          output: JSON.stringify({
            error: "dashboard_not_running",
            message:
              "The Bizar dashboard is not running. Start it with `bizar dash start`.",
            query: args.query,
            mode: args.mode ?? "semantic",
            results: [],
          }),
        };
      }

      const baseUrl = `http://127.0.0.1:${port}`;
      const mode: "semantic" | "fts" = args.mode ?? "semantic";

      let searchResults: { results: MemorySearchResult["results"]; error?: string };

      if (mode === "semantic") {
        searchResults = await semanticSearch(baseUrl, args.query, limit);
        if (searchResults.error) {
          logger.debug(`bizar: memory-search semantic failed, falling back to FTS: ${searchResults.error}`);
          // Fall back to FTS if semantic fails
          const ftsResult = await ftsSearch(baseUrl, args.query, limit);
          searchResults = ftsResult;
        }
      } else {
        searchResults = await ftsSearch(baseUrl, args.query, limit);
      }

      if (searchResults.error) {
        return {
          output: JSON.stringify({
            error: "search_failed",
            message: searchResults.error,
            query: args.query,
            mode,
            results: [],
          }),
        };
      }

      const response: MemorySearchResult = {
        query: args.query,
        mode,
        count: searchResults.results.length,
        results: searchResults.results,
      };

      return { output: JSON.stringify(response) };
    },
  });
}
