/**
 * plan-action.ts
 *
 * `bizar_plan_action` tool (v0.4.0).
 *
 * CRUD on the v2 canvas (`plans/<slug>/plan.json`) and on the plan
 * metadata (`plans/<slug>/meta.json`). Pure file I/O — does not require
 * the `opencode serve` child, so it works in any environment, even
 * when background agents are disabled.
 *
 * Actions:
 *   - `get_canvas`         — return the full plan.json
 *   - `add_element`        — push a new element (id generated if absent)
 *   - `update_element`     — patch an existing element
 *   - `delete_element`     — remove an element AND its connections
 *   - `add_connection`     — push a new connection (id generated)
 *   - `delete_connection`  — remove a connection
 *   - `add_comment`        — push a new comment (id generated)
 *   - `reply_to_comment`   — append to an existing comment's thread
 *   - `set_status`         — update meta.json `status`
 *
 * Errors:
 *   - Invalid slug → `{ error: "Invalid planSlug ..." }`
 *   - Missing plan.json (for canvas-touching actions) → `{ error: "Plan not found: ..." }`
 *   - Corrupt plan.json → `{ error: "Failed to read plan.json: ..." }`
 *   - Missing element/connection/comment → `{ error: "Element not found: ..." }`
 *
 * The tool NEVER throws. All errors are returned as JSON.
 *
 * Concurrency:
 *   - All writes go through a per-store async mutex (see `withLock`).
 *   - Writes are atomic via `writeFileSync(tmp) + renameSync(tmp, final)`.
 *
 * Read-only counterpart: `bizar_get_plan_comments` (see bg-get-comments.ts).
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

import type { Logger } from "../logger.js";

// --- On-disk shapes (subset of v2 canvas) ---------------------------------

/** A canvas element as stored in plan.json. We accept arbitrary fields
 *  beyond the documented subset so the agent can add new shapes later. */
export interface PlanElement {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  content?: string;
  [key: string]: unknown;
}

export interface PlanConnection {
  id?: string;
  from?: string;
  to?: string;
  fromElementId?: string;
  toElementId?: string;
  label?: string;
  [key: string]: unknown;
}

export interface PlanCommentReply {
  id?: string;
  author?: string;
  text?: string;
  created?: string;
  [key: string]: unknown;
}

export interface PlanComment {
  id?: string;
  x?: number;
  y?: number;
  elementId?: string | null;
  author?: string;
  text?: string;
  created?: string;
  thread?: PlanCommentReply[];
  [key: string]: unknown;
}

export interface PlanCanvas {
  schemaVersion?: number;
  title?: string;
  elements?: PlanElement[];
  connections?: PlanConnection[];
  comments?: PlanComment[];
  viewport?: { x?: number; y?: number; zoom?: number };
  [key: string]: unknown;
}

export interface PlanMeta {
  status?: string;
  [key: string]: unknown;
}

// --- Tool factory types ---------------------------------------------------

export interface PlanActionDeps {
  /** Project root; `plans/<slug>/plan.json` lives here. */
  worktree: string;
  logger: Logger;
}

/** Per-plan status (matches cli/plan.mjs's meta.json). */
export const PLAN_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "in-progress",
  "done",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanActionOk {
  ok: true;
  action: string;
  planSlug: string;
  [key: string]: unknown;
}

export interface PlanActionErr {
  ok: false;
  action: string;
  planSlug: string;
  error: string;
}

export type PlanActionResult = PlanActionOk | PlanActionErr;

// --- Slug validation ------------------------------------------------------

/** Same slug rule used everywhere in the project. */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

// --- ID generators --------------------------------------------------------

function makeElementId(): string {
  return "el_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeConnectionId(): string {
  return "conn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeCommentId(): string {
  return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeReplyId(): string {
  return "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- File I/O helpers (mirrors state.ts) ---------------------------------

/** Per-plan mutex — serialize concurrent writes to the same plan. */
async function withLock<T>(
  locks: Map<string, Promise<unknown>>,
  planSlug: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(planSlug) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(planSlug, next.catch(() => {}));
  return next;
}

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

function writeJsonAtomic(filePath: string, data: unknown, logger: Logger): void {
  const tmp = `${filePath}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, filePath);
  } catch (err: unknown) {
    logger.warn(`bizar: failed to write ${filePath}: ${String(err)}`);
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // non-fatal
    }
  }
}

function ensurePlanDir(planDir: string): boolean {
  try {
    mkdirSync(planDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// --- Pure core: planAction (extracted for testing) ------------------------

export interface PlanActionArgs {
  action: string;
  planSlug: string;
  element?: PlanElement;
  elementId?: string;
  connection?: PlanConnection;
  connectionId?: string;
  comment?: PlanComment;
  commentId?: string;
  reply?: PlanCommentReply;
  status?: PlanStatus;
}

/**
 * Execute a plan action against the on-disk files. Returns a structured
 * result; never throws.
 *
 * Extracted from the tool factory so tests can drive the same code path
 * without needing the opencode tool framework.
 */
export function planAction(
  worktree: string,
  logger: Logger,
  locks: Map<string, Promise<unknown>>,
  args: PlanActionArgs,
): Promise<PlanActionResult> {
  if (!isValidSlug(args.planSlug)) {
    return Promise.resolve({
      ok: false,
      action: args.action,
      planSlug: args.planSlug,
      error: `Invalid planSlug: "${args.planSlug}". Must match ^[a-z0-9][a-z0-9-]{0,63}$.`,
    });
  }

  return withLock(locks, args.planSlug, async (): Promise<PlanActionResult> => {
    const planDir = join(worktree, "plans", args.planSlug);
    const planPath = join(planDir, "plan.json");
    const metaPath = join(planDir, "meta.json");

    // `get_canvas` is the only read that doesn't require an existing plan
    if (args.action === "get_canvas") {
      if (!existsSync(planPath)) {
        return {
          ok: false,
          action: args.action,
          planSlug: args.planSlug,
          error: `Plan not found: ${args.planSlug}`,
        };
      }
      const canvas = readCanvas(planPath);
      if (canvas === null) {
        return {
          ok: false,
          action: args.action,
          planSlug: args.planSlug,
          error: `Plan not found or corrupt: ${args.planSlug}`,
        };
      }
      return {
        ok: true,
        action: args.action,
        planSlug: args.planSlug,
        canvas,
      };
    }

    // All other actions require a writable plan dir. If the directory
    // doesn't exist, create it (so the agent can create + populate in
    // one workflow). If creation fails, return an error.
    if (!existsSync(planDir)) {
      if (!ensurePlanDir(planDir)) {
        return {
          ok: false,
          action: args.action,
          planSlug: args.planSlug,
          error: `Cannot create plan directory: ${planDir}`,
        };
      }
    }

    switch (args.action) {
      case "add_element":
        return doAddElement(planPath, logger, args);
      case "update_element":
        return doUpdateElement(planPath, logger, args);
      case "delete_element":
        return doDeleteElement(planPath, logger, args);
      case "add_connection":
        return doAddConnection(planPath, logger, args);
      case "delete_connection":
        return doDeleteConnection(planPath, logger, args);
      case "add_comment":
        return doAddComment(planPath, logger, args);
      case "reply_to_comment":
        return doReplyToComment(planPath, logger, args);
      case "set_status":
        return doSetStatus(planPath, metaPath, logger, args);
      default:
        return {
          ok: false,
          action: args.action,
          planSlug: args.planSlug,
          error: `Unknown action: "${args.action}"`,
        };
    }
  });
}

// --- Action handlers ------------------------------------------------------

type CanvasResult =
  | { ok: true; canvas: PlanCanvas }
  | { ok: false; error: string };

function ensureCanvasForWrite(planPath: string, logger: Logger): CanvasResult {
  if (existsSync(planPath)) {
    const canvas = readCanvas(planPath);
    if (canvas === null) {
      // Corrupt file — refuse to overwrite
      logger.warn(`bizar: cannot mutate corrupt plan.json at ${planPath}`);
      return { ok: false, error: `plan.json is corrupt or not a v2 canvas object` };
    }
    // Backfill defaults
    if (!Array.isArray(canvas.elements)) canvas.elements = [];
    if (!Array.isArray(canvas.connections)) canvas.connections = [];
    if (!Array.isArray(canvas.comments)) canvas.comments = [];
    if (!canvas.viewport || typeof canvas.viewport !== "object") {
      canvas.viewport = { x: 0, y: 0, zoom: 1 };
    }
    if (canvas.schemaVersion !== 2) canvas.schemaVersion = 2;
    return { ok: true, canvas };
  }
  // New plan — create a minimal v2 canvas
  const fresh: PlanCanvas = {
    schemaVersion: 2,
    title: "Untitled plan",
    elements: [],
    connections: [],
    comments: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  return { ok: true, canvas: fresh };
}

function doAddElement(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.element) {
    return errMissingArg(args, "element");
  }
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const element: PlanElement = { ...args.element };
  if (!element.id) element.id = makeElementId();
  // Default position/size if missing
  if (typeof element.x !== "number") element.x = 80;
  if (typeof element.y !== "number") element.y = 80;
  if (typeof element.width !== "number") element.width = 240;
  if (typeof element.height !== "number") element.height = 160;
  if (!element.type) element.type = "text";
  canvas.elements!.push(element);
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    elementId: element.id,
  };
}

function doUpdateElement(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.elementId) return errMissingArg(args, "elementId");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const idx = canvas.elements!.findIndex((e) => e.id === args.elementId);
  if (idx === -1) {
    return {
      ok: false,
      action: args.action,
      planSlug: args.planSlug,
      error: `Element not found: ${args.elementId}`,
    };
  }
  // Patch — only update fields present in args.element
  if (args.element) {
    for (const [k, v] of Object.entries(args.element)) {
      // Never let the agent rewrite the id (use delete+add to change it)
      if (k === "id") continue;
      (canvas.elements![idx] as Record<string, unknown>)[k] = v;
    }
  }
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    elementId: args.elementId,
  };
}

function doDeleteElement(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.elementId) return errMissingArg(args, "elementId");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const before = canvas.elements!.length;
  canvas.elements = canvas.elements!.filter((e) => e.id !== args.elementId);
  const removed = before - canvas.elements.length;

  // Cascade: remove connections touching this element
  const connsBefore = canvas.connections!.length;
  canvas.connections = canvas.connections!.filter((c) => {
    return (
      c.fromElementId !== args.elementId &&
      c.toElementId !== args.elementId &&
      // Also handle the `from`/`to` shorthand used by some schemas.
      c.from !== args.elementId &&
      c.to !== args.elementId
    );
  });
  const removedConns = connsBefore - canvas.connections.length;

  // Cascade: remove comments pinned to this element (keep canvas-pinned)
  const commentsBefore = canvas.comments!.length;
  canvas.comments = canvas.comments!.filter((c) => c.elementId !== args.elementId);
  const removedComments = commentsBefore - canvas.comments.length;

  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    elementId: args.elementId,
    removed,
    removedConnections: removedConns,
    removedComments,
  };
}

function doAddConnection(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.connection) return errMissingArg(args, "connection");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const connection: PlanConnection = { ...args.connection };
  if (!connection.id) connection.id = makeConnectionId();
  // Normalize: accept either {from,to} or {fromElementId,toElementId}
  if (connection.from && !connection.fromElementId) connection.fromElementId = connection.from;
  if (connection.to && !connection.toElementId) connection.toElementId = connection.to;
  canvas.connections!.push(connection);
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    connectionId: connection.id,
  };
}

function doDeleteConnection(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.connectionId) return errMissingArg(args, "connectionId");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const before = canvas.connections!.length;
  canvas.connections = canvas.connections!.filter((c) => c.id !== args.connectionId);
  const removed = before - canvas.connections.length;
  if (removed === 0) {
    return {
      ok: false,
      action: args.action,
      planSlug: args.planSlug,
      error: `Connection not found: ${args.connectionId}`,
    };
  }
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    connectionId: args.connectionId,
    removed,
  };
}

function doAddComment(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.comment) return errMissingArg(args, "comment");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const comment: PlanComment = { ...args.comment };
  if (!comment.id) comment.id = makeCommentId();
  if (!comment.created) comment.created = new Date().toISOString();
  if (!comment.thread) comment.thread = [];
  canvas.comments!.push(comment);
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    commentId: comment.id,
  };
}

function doReplyToComment(
  planPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.commentId) return errMissingArg(args, "commentId");
  if (!args.reply) return errMissingArg(args, "reply");
  const ensured = ensureCanvasForWrite(planPath, logger);
  if (!ensured.ok) {
    return { ok: false, action: args.action, planSlug: args.planSlug, error: ensured.error };
  }
  const canvas = ensured.canvas;
  const target = canvas.comments!.find((c) => c.id === args.commentId);
  if (!target) {
    return {
      ok: false,
      action: args.action,
      planSlug: args.planSlug,
      error: `Comment not found: ${args.commentId}`,
    };
  }
  if (!Array.isArray(target.thread)) target.thread = [];
  const reply: PlanCommentReply = { ...args.reply };
  if (!reply.id) reply.id = makeReplyId();
  if (!reply.created) reply.created = new Date().toISOString();
  target.thread.push(reply);
  writeJsonAtomic(planPath, canvas, logger);
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    commentId: args.commentId,
    replyId: reply.id,
  };
}

function doSetStatus(
  planPath: string,
  metaPath: string,
  logger: Logger,
  args: PlanActionArgs,
): PlanActionResult {
  if (!args.status) return errMissingArg(args, "status");
  if (!(PLAN_STATUSES as readonly string[]).includes(args.status)) {
    return {
      ok: false,
      action: args.action,
      planSlug: args.planSlug,
      error: `Invalid status: ${args.status}. Must be one of: ${PLAN_STATUSES.join(", ")}.`,
    };
  }
  const meta = (existsSync(metaPath) ? readMeta(metaPath) : null) ?? {};
  meta.status = args.status;
  meta.lastEdited = new Date().toISOString();
  writeJsonAtomic(metaPath, meta, logger);

  // Also touch plan.json (if it exists) so the viewer reloads.
  if (existsSync(planPath)) {
    const canvas = readCanvas(planPath);
    if (canvas !== null) {
      (canvas as Record<string, unknown>).lastEdited = meta.lastEdited;
      writeJsonAtomic(planPath, canvas, logger);
    }
  }
  return {
    ok: true,
    action: args.action,
    planSlug: args.planSlug,
    status: args.status,
  };
}

function errMissingArg(args: PlanActionArgs, name: string): PlanActionResult {
  return {
    ok: false,
    action: args.action,
    planSlug: args.planSlug,
    error: `Missing required argument: "${name}"`,
  };
}

// --- Zod schema for the tool framework ------------------------------------

const elementSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

const connectionSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    fromElementId: z.string().optional(),
    toElementId: z.string().optional(),
    label: z.string().optional(),
  })
  .passthrough();

const commentSchema = z
  .object({
    id: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    elementId: z.string().nullable().optional(),
    author: z.string().optional(),
    text: z.string().optional(),
    created: z.string().optional(),
  })
  .passthrough();

const replySchema = z
  .object({
    id: z.string().optional(),
    author: z.string().optional(),
    text: z.string().optional(),
    created: z.string().optional(),
  })
  .passthrough();

// --- Tool factory ---------------------------------------------------------

/**
 * Build the `bizar_plan_action` tool. The plugin wires the result into
 * `Hooks.tool`. The `deps` closure carries the worktree, logger, and a
 * shared per-plan mutex map (one mutex map per plugin instance).
 */
export function createPlanActionTool(deps: PlanActionDeps) {
  const locks = new Map<string, Promise<unknown>>();
  return tool({
    description:
      "CRUD on a Bizar Plan canvas. Use this to add elements, update " +
      "their content, post comments, reply to comments, and set the " +
      "plan's status. Pure file I/O — does not require any background " +
      "agent or local server. Available to all agents.",
    args: {
      action: z.enum([
        "get_canvas",
        "add_element",
        "update_element",
        "delete_element",
        "add_connection",
        "delete_connection",
        "add_comment",
        "reply_to_comment",
        "set_status",
      ]),
      planSlug: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Must match ^[a-z0-9][a-z0-9-]{0,63}$")
        .describe("The plan's slug (e.g. 'my-feature')."),
      element: elementSchema.optional(),
      elementId: z.string().optional(),
      connection: connectionSchema.optional(),
      connectionId: z.string().optional(),
      comment: commentSchema.optional(),
      commentId: z.string().optional(),
      reply: replySchema.optional(),
      status: z.enum(PLAN_STATUSES).optional(),
    },
    execute: async (rawArgs) => {
      const args = rawArgs as PlanActionArgs;
      try {
        const result = await planAction(deps.worktree, deps.logger, locks, args);
        return { output: JSON.stringify(result) };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.warn(`bizar: plan_action(${args.action}) crashed: ${msg}`);
        return {
          output: JSON.stringify({
            ok: false,
            action: args.action,
            planSlug: args.planSlug,
            error: `Internal error: ${msg}`,
          }),
        };
      }
    },
  });
}