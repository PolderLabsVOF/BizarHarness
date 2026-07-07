/**
 * wait-for-feedback.ts
 *
 * `bizar_wait_for_feedback` tool (v0.4.0).
 *
 * Blocks the agent's turn until one of the following happens:
 *   1. A new comment is added to the plan canvas (filtered by
 *      `sinceTimestamp` if provided).
 *   2. `meta.json.status` becomes "approved" or "rejected".
 *   3. `timeoutMs` is reached.
 *
 * Implementation:
 *   - Polls every 2 seconds via `setTimeout`. NOT a busy loop.
 *   - Each tick reads `plan.json` and `meta.json` from disk.
 *   - Returns immediately on success; on timeout returns
 *     `status: "timed_out"`.
 *
 * The tool never throws. All errors return a structured result.
 *
 * Companion tools:
 *   - `bizar_plan_action` — CRUD on the canvas (add comments, etc.)
 *   - `bizar_get_plan_comments` — read-only access to comments
 *
 * v0.4.0 MVP — this is the polling version. A future v0.5.0 will
 * switch to SSE-based push notifications from the plan server.
 *
 * Cline SDK port (Phase 2):
 *   - Uses `createTool` from `@cline/sdk` directly.
 *   - Adds `name: BIZAR_WAIT_FOR_FEEDBACK_TOOL_NAME`.
 *   - `inputSchema` is `z.object(...).shape` over the same fields as before.
 *   - Returns structured `{ ok, status, ... }` / `{ ok: false, error, ... }`
 *     instead of `{ output: JSON.stringify(...) }`.
 */

import { createTool, type AgentTool } from "@cline/sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "../logger.js";

export const BIZAR_WAIT_FOR_FEEDBACK_TOOL_NAME = "bizar_wait_for_feedback";

// --- On-disk shapes (subset) ---------------------------------------------

interface PlanComment {
  id?: string;
  elementId?: string | null;
  author?: string;
  text?: string;
  created?: string;
  thread?: Array<{ id?: string; author?: string; created?: string }>;
  [key: string]: unknown;
}

interface PlanCanvas {
  schemaVersion?: number;
  elements?: unknown[];
  connections?: unknown[];
  comments?: PlanComment[];
  [key: string]: unknown;
}

interface PlanMeta {
  status?: string;
  [key: string]: unknown;
}

// --- Constants -----------------------------------------------------------

/** Polling interval in ms. 2 seconds — short enough for snappy UX,
 *  long enough that 5 ticks of polling per 10s window doesn't hammer disk. */
const POLL_INTERVAL_MS = 2_000;

/** Min/max/default timeout per spec. */
const TIMEOUT_MIN_MS = 5_000;
const TIMEOUT_MAX_MS = 1_800_000;
const TIMEOUT_DEFAULT_MS = 600_000;

/** Same slug rule used everywhere in the project. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

// --- Return type ---------------------------------------------------------

export type WaitOutcome =
  | "feedback_received"
  | "approved"
  | "rejected"
  | "timed_out";

export type PlanStatusOutcome =
  | "draft"
  | "approved"
  | "rejected"
  | "in-progress"
  | "done";

export interface WaitResult {
  ok: true;
  status: WaitOutcome;
  planSlug: string;
  planStatus: PlanStatusOutcome;
  newComments: PlanComment[];
  waitedMs: number;
}

export interface WaitError {
  ok: false;
  status: "error";
  planSlug: string;
  error: string;
  waitedMs: number;
}

export type WaitForFeedbackResult = WaitResult | WaitError;

export interface WaitForFeedbackArgs {
  planSlug: string;
  timeoutMs?: number;
  sinceTimestamp?: string;
}

export interface WaitForFeedbackDeps {
  worktree: string;
  logger: Logger;
  /**
   * Override the polling interval. Tests pass a small value (e.g. 5ms)
   * to keep the suite fast. Defaults to POLL_INTERVAL_MS.
   */
  pollIntervalMs?: number;
  /** Override the sleep function (tests use this). Defaults to global setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Override the current-time source (tests). Defaults to Date.now. */
  now?: () => number;
}

export type BizarWaitForFeedbackInput = z.infer<typeof bizarWaitForFeedbackSchema>;
export type BizarWaitForFeedbackOutput = WaitForFeedbackResult;

const bizarWaitForFeedbackSchema = z.object({
  planSlug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Must match ^[a-z0-9][a-z0-9-]{0,63}$")
    .describe("The plan's slug (e.g. 'my-feature')."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .min(TIMEOUT_MIN_MS)
    .max(TIMEOUT_MAX_MS)
    .optional()
    .describe(
      `How long to wait, in milliseconds. Default ${TIMEOUT_DEFAULT_MS} (10 min). ` +
        `Range [${TIMEOUT_MIN_MS}, ${TIMEOUT_MAX_MS}] (5 s..30 min).`,
    ),
  sinceTimestamp: z
    .string()
    .optional()
    .describe(
      "Optional ISO timestamp. Only comments with `created` strictly " +
        "after this value count as feedback. If omitted, the first poll " +
        "returns any existing non-empty comment set as feedback.",
    ),
});
function clampTimeout(raw: number | undefined): number {
  if (raw === undefined) return TIMEOUT_DEFAULT_MS;
  if (!Number.isFinite(raw) || raw < TIMEOUT_MIN_MS) return TIMEOUT_MIN_MS;
  if (raw > TIMEOUT_MAX_MS) return TIMEOUT_MAX_MS;
  return Math.floor(raw);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the plan.json from disk. Returns null on missing/corrupt.
 */
function readCanvas(planPath: string): PlanCanvas | null {
  if (!existsSync(planPath)) return null;
  try {
    const raw = readFileSync(planPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PlanCanvas;
  } catch {
    return null;
  }
}

/**
 * Read meta.json. Returns null on missing/corrupt.
 */
function readMeta(metaPath: string): PlanMeta | null {
  if (!existsSync(metaPath)) return null;
  try {
    const raw = readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PlanMeta;
  } catch {
    return null;
  }
}

/** Sort comments oldest-first by `created`. Missing timestamps go to the end. */
function sortByCreated(comments: PlanComment[]): PlanComment[] {
  return comments.slice().sort((a, b) => {
    const at = String(a.created ?? "");
    const bt = String(b.created ?? "");
    if (at === bt) return 0;
    if (at === "") return 1;
    if (bt === "") return -1;
    return at.localeCompare(bt);
  });
}

/** Filter comments to only those with `created` strictly greater than the
 *  cutoff. If `sinceTimestamp` is undefined, returns the input as-is. */
function filterNewComments(
  comments: PlanComment[],
  sinceTimestamp: string | undefined,
): PlanComment[] {
  if (sinceTimestamp === undefined || sinceTimestamp === "") {
    return comments;
  }
  return comments.filter((c) => {
    const created = String(c.created ?? "");
    return created !== "" && created > sinceTimestamp;
  });
}

function normalizeStatus(raw: string | undefined): PlanStatusOutcome {
  if (raw === "draft" || raw === "approved" || raw === "rejected" ||
      raw === "in-progress" || raw === "done") {
    return raw;
  }
  return "draft";
}

/**
 * Poll the plan until feedback arrives, status changes, or the timeout
 * is reached. Extracted from the tool factory so tests can drive the same
 * code path with a tiny `pollIntervalMs` and an injectable sleep.
 *
 * Never throws. Returns a structured `WaitForFeedbackResult`.
 */
export async function waitForFeedback(
  deps: WaitForFeedbackDeps,
  args: WaitForFeedbackArgs,
): Promise<WaitForFeedbackResult> {
  const start = (deps.now ?? Date.now)();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const pollInterval = deps.pollIntervalMs ?? POLL_INTERVAL_MS;

  if (!SLUG_REGEX.test(args.planSlug)) {
    return {
      ok: false,
      status: "error",
      planSlug: args.planSlug,
      error: `Invalid planSlug: "${args.planSlug}". Must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
      waitedMs: 0,
    };
  }

  const timeoutMs = clampTimeout(args.timeoutMs);
  const planDir = join(deps.worktree, "plans", args.planSlug);
  const planPath = join(planDir, "plan.json");
  const metaPath = join(planDir, "meta.json");

  // If the plan doesn't even exist, that's an error (the agent shouldn't
  // wait for feedback on a nonexistent plan).
  if (!existsSync(planPath) && !existsSync(metaPath)) {
    return {
      ok: false,
      status: "error",
      planSlug: args.planSlug,
      error: `Plan not found: ${args.planSlug}`,
      waitedMs: 0,
    };
  }

  // Tick: read both files, evaluate exit conditions.
  // Returns null when no exit condition was met; returns the final
  // result when one was met.
  async function tick(): Promise<WaitForFeedbackResult | null> {
    const meta = readMeta(metaPath);
    const canvas = readCanvas(planPath);
    const status = normalizeStatus(meta?.status);

    // Status-driven exit (approved / rejected)
    if (status === "approved") {
      return {
        ok: true,
        status: "approved",
        planSlug: args.planSlug,
        planStatus: status,
        newComments: [],
        waitedMs: now() - start,
      };
    }
    if (status === "rejected") {
      return {
        ok: true,
        status: "rejected",
        planSlug: args.planSlug,
        planStatus: status,
        newComments: [],
        waitedMs: now() - start,
      };
    }

    // Comment-driven exit
    if (canvas !== null) {
      const all = Array.isArray(canvas.comments) ? canvas.comments : [];
      const newOnes = sortByCreated(filterNewComments(all, args.sinceTimestamp));
      if (newOnes.length > 0) {
        return {
          ok: true,
          status: "feedback_received",
          planSlug: args.planSlug,
          planStatus: status,
          newComments: newOnes,
          waitedMs: now() - start,
        };
      }
    }

    return null;
  }

  // First tick — gives us immediate feedback if it's already there.
  const first = await tick();
  if (first !== null) return first;

  // Loop with `setTimeout`, NOT a busy loop. We use a `deadline` so the
  // final sleep doesn't overshoot the timeout by much.
  const deadline = start + timeoutMs;
  while (now() < deadline) {
    const remaining = deadline - now();
    const waitMs = Math.max(0, Math.min(pollInterval, remaining));
    if (waitMs === 0) break;
    await sleep(waitMs);
    if (now() >= deadline) break;

    const result = await tick();
    if (result !== null) return result;
  }

  // Timed out — return the current state with the timeout flag.
  const finalMeta = readMeta(metaPath);
  const finalStatus = normalizeStatus(finalMeta?.status);
  const finalCanvas = readCanvas(planPath);
  const finalComments = sortByCreated(
    filterNewComments(
      Array.isArray(finalCanvas?.comments) ? (finalCanvas!.comments as PlanComment[]) : [],
      args.sinceTimestamp,
    ),
  );
  return {
    ok: true,
    status: "timed_out",
    planSlug: args.planSlug,
    planStatus: finalStatus,
    newComments: finalComments,
    waitedMs: now() - start,
  };
}

// --- Zod schema + tool factory ------------------------------------------

/**
 * Build the `bizar_wait_for_feedback` tool. The plugin wires the result
 * into `api.registerTool()` from `AgentExtensionApi`. The `deps`
 * closure carries the worktree and logger.
 */
export function createWaitForFeedbackTool(
  deps: WaitForFeedbackDeps,
): AgentTool<BizarWaitForFeedbackInput, BizarWaitForFeedbackOutput> {
  return createTool({
    name: BIZAR_WAIT_FOR_FEEDBACK_TOOL_NAME,
    description:
      "Block until the user provides feedback on a plan, approves it, " +
      "rejects it, or the timeout is reached. Polls every 2 seconds. " +
      "Use this after calling `bizar_plan_action` to add a comment or " +
      "present the plan for approval. Returns when feedback arrives, " +
      "when meta.json.status changes to approved/rejected, or on timeout. " +
      "Never throws. Available to all agents (heavy poll — Odin preferred).",
    inputSchema: bizarWaitForFeedbackSchema.shape,
    execute: async (input) => {
      try {
        const result = await waitForFeedback(deps, input);
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: wait_for_feedback crashed: ${msg}`);
        return {
          ok: false as const,
          status: "error",
          planSlug: input.planSlug,
          error: `Internal error: ${msg}`,
          waitedMs: 0,
        };
      }
    },
  });
}

