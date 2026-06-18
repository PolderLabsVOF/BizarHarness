/**
 * bg-get-comments.ts
 *
 * `bizar_get_plan_comments` tool — read-only access to the comments on a
 * Bizar Plan canvas.
 *
 * Background agents (Thor, Tyr, Mimir, etc.) call this to pick up user
 * feedback pinned to specific elements they are working on. The tool
 * reads `plans/<slug>/plan.json` from disk and returns the comments
 * array, optionally filtered to a specific element.
 *
 * The schema on disk is the v2 canvas shape:
 *
 *   {
 *     schemaVersion: 2,
 *     title: "...",
 *     elements: [...],
 *     connections: [...],
 *     comments: [
 *       {
 *         id: "c_xxx",
 *         x: 100, y: 200,
 *         elementId: "el_yyy" | null,
 *         author: "DrB0rk",
 *         text: "Make this button bigger",
 *         created: "2026-06-18T...",
 *         thread: [
 *           { id: "r_xxx", author: "ai", text: "Done", created: "..." }
 *         ]
 *       }
 *     ],
 *     viewport: { x, y, zoom }
 *   }
 *
 * If the file does not exist, has an older shape, or the elementId filter
 * yields zero results, the tool returns an empty array — never an error.
 * This matches the principle that a missing plan is not the agent's
 * problem; it just means "no feedback on file".
 *
 * Returns (on success):
 *   `Array<{ id, x, y, elementId, author, text, created, thread: [...] }>`
 *
 * Returns (on error):
 *   `{ error: string, planSlug: string }`
 *
 * Read-only — available to ALL agents (Vör, Frigg, Mimir, Odin, Thor,
 * Tyr, Heimdall, etc.). The function is pure: no side effects, no
 * network calls, no process spawning.
 *
 * The "worktree" passed in via deps is the directory the plugin was
 * loaded for; `plans/` lives at the root of the project.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../logger.js";

export interface BgGetCommentsDeps {
  /** The project's working directory (e.g. /home/user/proj). `plans/` is here. */
  worktree: string;
  logger: Logger;
}

// --- On-disk shapes ---------------------------------------------------------

/** A single thread reply on a canvas comment. */
interface PlanCommentReply {
  id?: string;
  author?: string;
  text?: string;
  created?: string;
}

/** A single canvas comment as stored in plan.json. */
interface PlanComment {
  id: string;
  x?: number;
  y?: number;
  elementId?: string | null;
  author?: string;
  text?: string;
  created?: string;
  thread?: PlanCommentReply[];
}

/** The minimum subset of plan.json the tool reads. */
interface PlanCanvasFile {
  schemaVersion?: number;
  title?: string;
  elements?: Array<{ id?: string; title?: string }>;
  connections?: unknown[];
  comments?: PlanComment[];
  viewport?: unknown;
}

// --- Validation helpers -----------------------------------------------------

/** Same slug rule used by `cli/plan.mjs`. Lowercase, hyphens, 1–64 chars. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isValidSlug(s: string): boolean {
  return SLUG_REGEX.test(s);
}

// --- Core read function (extracted for testability) --------------------------

/**
 * Read the plan.json from disk, parse it, and return the filtered comments.
 *
 * Exported (named) so the test file can drive the same code path the
 * real tool uses, without needing a tool framework.
 *
 * Errors are swallowed and returned as a result — a missing plan should
 * never break an agent session. The only fatal error is "invalid slug",
 * which is a programming error rather than a runtime condition.
 */
export function readPlanComments(
  worktree: string,
  planSlug: string,
  elementId: string | undefined,
): { ok: true; comments: PlanComment[]; planSlug: string } | { ok: false; error: string; planSlug: string } {
  if (!isValidSlug(planSlug)) {
    return { ok: false, error: `Invalid planSlug: "${planSlug}". Must match ^[a-z0-9][a-z0-9-]{0,63}$.`, planSlug };
  }

  const planPath = join(worktree, "plans", planSlug, "plan.json");
  if (!existsSync(planPath)) {
    // No plan.json — this is a v1 plan, or the plan was never created.
    // We return an empty array; the agent should treat it as "no feedback".
    return { ok: true, comments: [], planSlug };
  }

  let parsed: PlanCanvasFile;
  try {
    const raw = readFileSync(planPath, "utf-8");
    parsed = JSON.parse(raw) as PlanCanvasFile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read plan.json: ${msg}`, planSlug };
  }

  // Guard against the JSON being null or a non-object (e.g. "null" or "[]"
  // at the top level). The v2 schema requires an object; anything else is
  // a programmer error rather than a runtime condition.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `plan.json is not a v2 canvas object (got ${Array.isArray(parsed) ? "array" : typeof parsed})`,
      planSlug,
    };
  }

  const all = Array.isArray(parsed.comments) ? parsed.comments : [];

  // Filter by elementId if requested. Note: we keep elementId === null
  // (canvas-pinned, no element) separate from elementId === undefined
  // (malformed comment). The latter is filtered out as "not a comment".
  let filtered: PlanComment[];
  if (elementId === undefined) {
    filtered = all.filter((c) => c && typeof c === "object" && typeof c.id === "string");
  } else if (elementId === "nil" || elementId === "null") {
    // explicit "canvas-pinned only"
    filtered = all.filter(
      (c) => c && typeof c === "object" && typeof c.id === "string" && c.elementId == null,
    );
  } else if (elementId === "") {
    // empty string means "all comments" (used by the v2 viewer's
    // "show me everything" GET with ?elementId=)
    filtered = all.filter((c) => c && typeof c === "object" && typeof c.id === "string");
  } else {
    filtered = all.filter(
      (c) => c && typeof c === "object" && typeof c.id === "string" && c.elementId === elementId,
    );
  }

  // Sort by created time (oldest first) so the agent sees a chronological
  // thread. Missing/empty timestamps are pushed to the end.
  filtered.sort((a, b) => {
    const at = String(a.created || "");
    const bt = String(b.created || "");
    if (at === bt) return 0;
    if (at === "") return 1;
    if (bt === "") return -1;
    return at.localeCompare(bt);
  });

  return { ok: true, comments: filtered, planSlug };
}

// --- Tool factory -----------------------------------------------------------

/**
 * Build the `bizar_get_plan_comments` tool. The plugin wires the result
 * into `Hooks.tool`. The `deps` closure carries the worktree and logger.
 */
export function createBgGetCommentsTool(deps: BgGetCommentsDeps) {
  return tool({
    description:
      "Read the comments pinned to elements on a Bizar Plan canvas. " +
      "Use this to pick up user feedback while implementing changes. " +
      "Read-only; available to all agents. " +
      "Returns an array of comment objects with id, x, y, elementId, " +
      "author, text, created, and a thread of replies.",
    args: {
      planSlug: z
        .string()
        .min(1)
        .max(64)
        .describe(
          "The plan's slug (lowercase, hyphens, e.g. 'my-feature'). " +
            "Matches the directory under plans/<slug>/.",
        ),
      elementId: z
        .string()
        .optional()
        .describe(
          "Optional element id (e.g. 'el_abc123'). If provided, only " +
            "comments pinned to that element are returned. Omit to " +
            "get all comments on the plan. Pass an empty string, " +
            "'nil', or 'null' to get comments pinned to the canvas " +
            "(no element).",
        ),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { planSlug: string; elementId?: string };
      const result = readPlanComments(deps.worktree, args.planSlug, args.elementId);
      if (!result.ok) {
        deps.logger.warn(
          `bizar: get_plan_comments(${args.planSlug}) failed: ${result.error}`,
        );
        return { output: JSON.stringify({ error: result.error, planSlug: args.planSlug }) };
      }
      return { output: JSON.stringify(result.comments) };
    },
  });
}