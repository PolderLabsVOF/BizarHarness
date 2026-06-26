/**
 * read-glyph-feedback.ts
 *
 * `read_glyph_feedback` tool (v3.22.0).
 *
 * Reads the structured `feedback.md` file the user wrote when they
 * clicked "Submit to agent" on a glyph in the dashboard. Returns:
 *   - parsed frontmatter (glyph, submittedAt, submittedBy, commentCount, questionCount)
 *   - the markdown body (Free-placed comments / Open-question answers / Full MDX source)
 *   - the parsed counts
 *
 * File location: `<worktree>/artifacts/<slug>/feedback.md`. The dashboard
 * writes this file via `POST /api/artifacts/:slug/submit` and marks the
 * artifact's `meta.json` `status` as `review`.
 *
 * Companion tools:
 *   - `bizar_get_plan_comments` — legacy canvas comment reader
 *   - `bizar_plan_action`      — CRUD on the v2 canvas
 *
 * Read-only — available to ALL agents. Never throws.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../logger.js";

export interface ReadGlyphFeedbackDeps {
  /** The project's working directory (e.g. /home/user/proj). `artifacts/` is here. */
  worktree: string;
  logger: Logger;
}

// --- Constants -----------------------------------------------------------

/** Same slug rule used everywhere in the project. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// --- Return type ---------------------------------------------------------

export interface ReadGlyphFeedbackResult {
  ok: true;
  found: true;
  slug: string;
  meta: Record<string, string>;
  body: string;
  feedbackFile: string;
  commentCount: number;
  questionCount: number;
}

export interface ReadGlyphFeedbackMissing {
  ok: true;
  found: false;
  slug: string;
  message: string;
  feedbackFile: string;
}

export interface ReadGlyphFeedbackError {
  ok: false;
  error: string;
  slug: string;
}

export type ReadGlyphFeedbackOutcome =
  | ReadGlyphFeedbackResult
  | ReadGlyphFeedbackMissing
  | ReadGlyphFeedbackError;

// --- Pure core: readGlyphFeedback ----------------------------------------

/**
 * Read `artifacts/<slug>/feedback.md` from disk and parse it. Exported
 * so tests can drive the same code path the real tool uses.
 *
 * Behavior:
 *   - Invalid slug         → returns `{ ok: false, error }`
 *   - File missing         → returns `{ ok: true, found: false, message }`
 *   - File present, parseable → returns `{ ok: true, found: true, meta, body, ... }`
 *   - File present, corrupt   → returns `{ ok: true, found: true, meta: {}, body: raw }`
 *
 * Never throws.
 */
export function readGlyphFeedback(
  worktree: string,
  slug: string,
): ReadGlyphFeedbackOutcome {
  if (!SLUG_REGEX.test(slug)) {
    return {
      ok: false,
      error: `Invalid slug: "${slug}". Must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
      slug,
    };
  }

  const feedbackFile = join(worktree, "artifacts", slug, "feedback.md");
  if (!existsSync(feedbackFile)) {
    return {
      ok: true,
      found: false,
      slug,
      message: `No feedback.md in artifacts/${slug}/ — has the user submitted feedback yet?`,
      feedbackFile,
    };
  }

  const raw = readFileSync(feedbackFile, "utf-8");

  // Parse the YAML frontmatter. We only support scalar values (string /
  // number) because the dashboard's writer only emits scalars.
  const meta: Record<string, string> = {};
  const fm = raw.match(/^---\n([\s\S]+?)\n---/);
  let body = raw;
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2];
    }
    body = raw.slice(fm[0].length).replace(/^\s+/, "");
  }

  const commentCount = parseInt(meta.commentCount || "0", 10) || 0;
  const questionCount = parseInt(meta.questionCount || "0", 10) || 0;

  return {
    ok: true,
    found: true,
    slug,
    meta,
    body,
    feedbackFile,
    commentCount,
    questionCount,
  };
}

// --- Tool factory --------------------------------------------------------

/**
 * Build the `read_glyph_feedback` tool. The plugin wires the result
 * into `Hooks.tool`. The `deps` closure carries the worktree and logger.
 */
export function createReadGlyphFeedbackTool(deps: ReadGlyphFeedbackDeps) {
  return tool({
    description:
      "Reads feedback.md for a glyph the user submitted for review. " +
      "Returns free-placed comments with (x, y) coordinates, answers to " +
      "OpenQuestions, and the original MDX source. Use this to understand " +
      "exactly what the user wants changed before regenerating the glyph.",
    args: {
      slug: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Must match ^[a-z0-9][a-z0-9-]{0,63}$")
        .describe("The artifact slug (e.g., 'dashboard-stale-pid-fix')."),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as { slug: string };
      const result = readGlyphFeedback(deps.worktree, args.slug);
      if (!result.ok) {
        deps.logger.warn(`bizar: read_glyph_feedback(${args.slug}) failed: ${result.error}`);
      }
      return { output: JSON.stringify(result) };
    },
  });
}