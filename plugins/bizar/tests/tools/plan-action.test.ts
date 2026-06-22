/**
 * plan-action.test.ts
 *
 * Tests for the `planAction` core function in src/tools/plan-action.ts.
 *
 * The tool factory (`createPlanActionTool`) is a thin Zod schema + JSON
 * wrapper around `planAction`. Testing the core function directly is
 * faster and lets us drive edge cases that the framework would reject
 * before reaching our code.
 *
 * Groups (13 tests):
 *   1. get_canvas (success + missing + corrupt)
 *   2. add_element (id generation + defaults)
 *   3. update_element (patch + missing)
 *   4. delete_element (cascade connections/comments)
 *   5. add_connection (id generation + shorthand normalization)
 *   6. delete_connection (success + missing)
 *   7. add_comment (id + timestamp)
 *   8. reply_to_comment (append to thread + missing)
 *   9. set_status (update meta.json + touch plan.json)
 *  10. invalid slug
 *  11. corrupt plan.json does not throw
 *  12. concurrent writes do not lose data
 *  13. unknown action
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { planAction } from "../../src/tools/plan-action.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  log(opts: { level: string; message: string }) { this.messages.push(opts); }
  debug(m: string) { this.messages.push({ level: "debug", message: m }); }
  info(m: string) { this.messages.push({ level: "info", message: m }); }
  warn(m: string) { this.messages.push({ level: "warn", message: m }); }
  error(m: string) { this.messages.push({ level: "error", message: m }); }
}

let worktree: string;
const logger = new MockLogger();
const locks = new Map<string, Promise<unknown>>();

beforeAll(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-plan-action-test-"));
});

afterAll(() => {
  if (worktree) rmSync(worktree, { recursive: true, force: true });
});

function planDir(slug: string) {
  return join(worktree, "plans", slug);
}

function planJsonPath(slug: string) {
  return join(planDir(slug), "plan.json");
}

function metaJsonPath(slug: string) {
  return join(planDir(slug), "meta.json");
}

function seedCanvas(slug: string, canvas: unknown) {
  mkdirSync(planDir(slug), { recursive: true });
  writeFileSync(planJsonPath(slug), JSON.stringify(canvas), "utf-8");
}

function seedMeta(slug: string, meta: unknown) {
  mkdirSync(planDir(slug), { recursive: true });
  writeFileSync(metaJsonPath(slug), JSON.stringify(meta), "utf-8");
}

function readCanvas(slug: string): unknown {
  return JSON.parse(readFileSync(planJsonPath(slug), "utf-8"));
}

// ===========================================================================
// Group 1 — get_canvas
// ===========================================================================

describe("planAction — get_canvas", () => {
  test("returns the full plan.json when present", async () => {
    const slug = "get-canvas-ok";
    seedCanvas(slug, {
      schemaVersion: 2,
      title: "Test",
      elements: [{ id: "el_a", title: "A" }],
      comments: [],
    });
    const r = await planAction(worktree, logger, locks, {
      action: "get_canvas",
      planSlug: slug,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("get_canvas");
      const canvas = r.canvas as { title?: string; elements?: unknown[] };
      expect(canvas.title).toBe("Test");
      expect(canvas.elements).toHaveLength(1);
    }
  });

  test("returns error when plan.json does not exist", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "get_canvas",
      planSlug: "nonexistent-plan",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Plan not found/);
      expect(r.planSlug).toBe("nonexistent-plan");
    }
  });
});

// ===========================================================================
// Group 2 — add_element
// ===========================================================================

describe("planAction — add_element", () => {
  test("writes a new element with a generated id when none provided", async () => {
    const slug = "add-element-gen";
    await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: slug,
      element: { title: "Generated" },
    });
    const canvas = readCanvas(slug) as { elements: Array<{ id: string; title: string }> };
    expect(canvas.elements).toHaveLength(1);
    expect(canvas.elements[0]!.id).toMatch(/^el_/);
    expect(canvas.elements[0]!.title).toBe("Generated");
  });

  test("preserves a provided id when present", async () => {
    const slug = "add-element-id";
    await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: slug,
      element: { id: "el_custom", title: "Custom" },
    });
    const canvas = readCanvas(slug) as { elements: Array<{ id: string }> };
    expect(canvas.elements[0]!.id).toBe("el_custom");
  });

  test("applies default position/size when missing", async () => {
    const slug = "add-element-defaults";
    await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: slug,
      element: { title: "T" },
    });
    const canvas = readCanvas(slug) as {
      elements: Array<{ x: number; y: number; width: number; height: number; type: string }>;
    };
    expect(canvas.elements[0]!.x).toBe(80);
    expect(canvas.elements[0]!.y).toBe(80);
    expect(canvas.elements[0]!.width).toBe(240);
    expect(canvas.elements[0]!.height).toBe(160);
    expect(canvas.elements[0]!.type).toBe("text");
  });

  test("returns an error when 'element' arg is missing", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: "missing-element-arg",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Missing required argument: "element"/);
    }
  });
});

// ===========================================================================
// Group 3 — update_element
// ===========================================================================

describe("planAction — update_element", () => {
  test("patches an existing element", async () => {
    const slug = "update-elem-ok";
    seedCanvas(slug, {
      schemaVersion: 2,
      elements: [{ id: "el_x", title: "Old", x: 10 }],
    });
    const r = await planAction(worktree, logger, locks, {
      action: "update_element",
      planSlug: slug,
      elementId: "el_x",
      element: { title: "New", x: 20 },
    });
    expect(r.ok).toBe(true);
    const canvas = readCanvas(slug) as { elements: Array<{ title: string; x: number; id: string }> };
    expect(canvas.elements[0]!.title).toBe("New");
    expect(canvas.elements[0]!.x).toBe(20);
    expect(canvas.elements[0]!.id).toBe("el_x"); // id preserved
  });

  test("returns error when element not found", async () => {
    const slug = "update-elem-missing";
    seedCanvas(slug, { schemaVersion: 2, elements: [] });
    const r = await planAction(worktree, logger, locks, {
      action: "update_element",
      planSlug: slug,
      elementId: "el_nope",
      element: { title: "X" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Element not found/);
  });

  test("returns error when elementId is missing", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "update_element",
      planSlug: "update-elem-no-id",
      element: { title: "X" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Missing required argument: "elementId"/);
  });
});

// ===========================================================================
// Group 4 — delete_element (cascade)
// ===========================================================================

describe("planAction — delete_element", () => {
  test("removes the element and its connections + comments", async () => {
    const slug = "delete-elem-cascade";
    seedCanvas(slug, {
      schemaVersion: 2,
      elements: [
        { id: "el_a" },
        { id: "el_b" },
      ],
      connections: [
        { id: "conn_1", fromElementId: "el_a", toElementId: "el_b" },
        { id: "conn_2", fromElementId: "el_b", toElementId: "el_a" },
      ],
      comments: [
        { id: "c_1", elementId: "el_a", text: "Pinned to a" },
        { id: "c_2", elementId: "el_b", text: "Pinned to b" },
        { id: "c_3", elementId: null, text: "Canvas pinned" },
      ],
    });
    const r = await planAction(worktree, logger, locks, {
      action: "delete_element",
      planSlug: slug,
      elementId: "el_a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.removed).toBe(1);
      expect(r.removedConnections).toBe(2);
      expect(r.removedComments).toBe(1); // only c_1; canvas-pinned c_3 kept
    }
    const canvas = readCanvas(slug) as {
      elements: unknown[];
      connections: unknown[];
      comments: Array<{ elementId: string | null }>;
    };
    expect(canvas.elements).toHaveLength(1);
    expect(canvas.connections).toHaveLength(0);
    expect(canvas.comments).toHaveLength(2);
    expect(canvas.comments.find((c) => c.elementId === null)).toBeDefined();
  });
});

// ===========================================================================
// Group 5 — add_connection
// ===========================================================================

describe("planAction — add_connection", () => {
  test("writes a new connection with a generated id", async () => {
    const slug = "add-conn-gen";
    await planAction(worktree, logger, locks, {
      action: "add_connection",
      planSlug: slug,
      connection: { from: "el_a", to: "el_b" },
    });
    const canvas = readCanvas(slug) as { connections: Array<{ id: string; fromElementId: string; toElementId: string }> };
    expect(canvas.connections).toHaveLength(1);
    expect(canvas.connections[0]!.id).toMatch(/^conn_/);
    expect(canvas.connections[0]!.fromElementId).toBe("el_a");
    expect(canvas.connections[0]!.toElementId).toBe("el_b");
  });

  test("preserves a provided id", async () => {
    const slug = "add-conn-id";
    await planAction(worktree, logger, locks, {
      action: "add_connection",
      planSlug: slug,
      connection: { id: "conn_custom", fromElementId: "el_a", toElementId: "el_b" },
    });
    const canvas = readCanvas(slug) as { connections: Array<{ id: string }> };
    expect(canvas.connections[0]!.id).toBe("conn_custom");
  });
});

// ===========================================================================
// Group 6 — delete_connection
// ===========================================================================

describe("planAction — delete_connection", () => {
  test("removes the connection", async () => {
    const slug = "del-conn-ok";
    seedCanvas(slug, {
      schemaVersion: 2,
      connections: [
        { id: "conn_x", fromElementId: "el_a", toElementId: "el_b" },
      ],
    });
    const r = await planAction(worktree, logger, locks, {
      action: "delete_connection",
      planSlug: slug,
      connectionId: "conn_x",
    });
    expect(r.ok).toBe(true);
    const canvas = readCanvas(slug) as { connections: unknown[] };
    expect(canvas.connections).toHaveLength(0);
  });

  test("returns error when connection not found", async () => {
    const slug = "del-conn-missing";
    seedCanvas(slug, { schemaVersion: 2, connections: [] });
    const r = await planAction(worktree, logger, locks, {
      action: "delete_connection",
      planSlug: slug,
      connectionId: "conn_nope",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Connection not found/);
  });
});

// ===========================================================================
// Group 7 — add_comment
// ===========================================================================

describe("planAction — add_comment", () => {
  test("writes a comment with generated id and timestamp", async () => {
    const slug = "add-comment-gen";
    await planAction(worktree, logger, locks, {
      action: "add_comment",
      planSlug: slug,
      comment: { elementId: "el_a", text: "Hi", author: "DrB0rk" },
    });
    const canvas = readCanvas(slug) as { comments: Array<{ id: string; created: string; thread: unknown[] }> };
    expect(canvas.comments).toHaveLength(1);
    expect(canvas.comments[0]!.id).toMatch(/^c_/);
    expect(canvas.comments[0]!.created).toMatch(/T/); // ISO-ish
    expect(canvas.comments[0]!.thread).toEqual([]);
  });
});

// ===========================================================================
// Group 8 — reply_to_comment
// ===========================================================================

describe("planAction — reply_to_comment", () => {
  test("appends a reply to an existing comment's thread", async () => {
    const slug = "reply-comment-ok";
    seedCanvas(slug, {
      schemaVersion: 2,
      comments: [{ id: "c_target", elementId: "el_a", text: "Hello" }],
    });
    const r = await planAction(worktree, logger, locks, {
      action: "reply_to_comment",
      planSlug: slug,
      commentId: "c_target",
      reply: { author: "ai", text: "Done" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.commentId).toBe("c_target");
      expect(r.replyId).toMatch(/^r_/);
    }
    const canvas = readCanvas(slug) as {
      comments: Array<{ thread: Array<{ id: string; author: string; text: string }> }>;
    };
    expect(canvas.comments[0]!.thread).toHaveLength(1);
    expect(canvas.comments[0]!.thread[0]!.author).toBe("ai");
    expect(canvas.comments[0]!.thread[0]!.text).toBe("Done");
  });

  test("returns error when comment not found", async () => {
    const slug = "reply-comment-missing";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    const r = await planAction(worktree, logger, locks, {
      action: "reply_to_comment",
      planSlug: slug,
      commentId: "c_nope",
      reply: { text: "Hi" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Comment not found/);
  });
});

// ===========================================================================
// Group 9 — set_status
// ===========================================================================

describe("planAction — set_status", () => {
  test("updates meta.json status", async () => {
    const slug = "set-status-ok";
    seedMeta(slug, { status: "draft" });
    const r = await planAction(worktree, logger, locks, {
      action: "set_status",
      planSlug: slug,
      status: "approved",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("approved");
    const meta = JSON.parse(readFileSync(metaJsonPath(slug), "utf-8"));
    expect(meta.status).toBe("approved");
    expect(meta.lastEdited).toMatch(/T/);
  });

  test("creates meta.json if missing", async () => {
    const slug = "set-status-create";
    mkdirSync(planDir(slug), { recursive: true });
    const r = await planAction(worktree, logger, locks, {
      action: "set_status",
      planSlug: slug,
      status: "rejected",
    });
    expect(r.ok).toBe(true);
    expect(existsSync(metaJsonPath(slug))).toBe(true);
  });

  test("rejects invalid status value", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "set_status",
      planSlug: "set-status-bad",
      status: "wat" as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid status/);
  });
});

// ===========================================================================
// Group 10 — invalid slug
// ===========================================================================

describe("planAction — invalid slug", () => {
  test("rejects UPPERCASE slug", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "get_canvas",
      planSlug: "UPPERCASE",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid planSlug/);
  });

  test("rejects empty slug", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "get_canvas",
      planSlug: "",
    });
    expect(r.ok).toBe(false);
  });

  test("rejects path-traversal slug", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "get_canvas",
      planSlug: "../etc",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid planSlug/);
  });
});

// ===========================================================================
// Group 11 — corrupt plan.json does not throw
// ===========================================================================

describe("planAction — corrupt plan.json", () => {
  test("does not throw and returns an error result on invalid JSON", async () => {
    const slug = "corrupt-plan";
    mkdirSync(planDir(slug), { recursive: true });
    writeFileSync(planJsonPath(slug), "{ not valid json :: !!", "utf-8");
    const r = await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: slug,
      element: { title: "Should fail" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/corrupt/i);
    }
    // Original corrupt file is preserved
    expect(readFileSync(planJsonPath(slug), "utf-8")).toBe("{ not valid json :: !!");
  });

  test("does not throw when plan.json is null", async () => {
    const slug = "null-plan";
    mkdirSync(planDir(slug), { recursive: true });
    writeFileSync(planJsonPath(slug), "null", "utf-8");
    const r = await planAction(worktree, logger, locks, {
      action: "add_element",
      planSlug: slug,
      element: { title: "X" },
    });
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// Group 12 — concurrent writes do not lose data
// ===========================================================================

describe("planAction — concurrency", () => {
  test("parallel add_element calls all land on disk", async () => {
    const slug = "concurrent-add";
    const N = 30;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        planAction(worktree, logger, locks, {
          action: "add_element",
          planSlug: slug,
          element: { title: `e-${i}` },
        }),
      ),
    );
    const oks = results.filter((r) => r.ok);
    expect(oks).toHaveLength(N);
    const canvas = readCanvas(slug) as { elements: unknown[] };
    expect(canvas.elements).toHaveLength(N);
    const ids = new Set(
      ((canvas.elements as Array<{ id: string }>)).map((e) => e.id),
    );
    expect(ids.size).toBe(N); // all ids unique
  });

  test("parallel delete + add does not corrupt the file", async () => {
    const slug = "concurrent-mixed";
    // Seed 10 elements
    seedCanvas(slug, {
      schemaVersion: 2,
      elements: Array.from({ length: 10 }, (_, i) => ({ id: `el_seed_${i}` })),
    });
    // Fire 10 deletes + 10 adds in parallel
    const ops = [
      ...Array.from({ length: 10 }, (_, i) =>
        planAction(worktree, logger, locks, {
          action: "delete_element",
          planSlug: slug,
          elementId: `el_seed_${i}`,
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        planAction(worktree, logger, locks, {
          action: "add_element",
          planSlug: slug,
          element: { title: `new-${i}` },
        }),
      ),
    ];
    const results = await Promise.all(ops);
    expect(results.every((r) => r.ok)).toBe(true);
    // File is still valid JSON
    const canvas = JSON.parse(readFileSync(planJsonPath(slug), "utf-8")) as {
      elements: unknown[];
    };
    expect(Array.isArray(canvas.elements)).toBe(true);
    expect(canvas.elements).toHaveLength(10); // 10 deletes + 10 adds = 10
  });
});

// ===========================================================================
// Group 13 — unknown action
// ===========================================================================

describe("planAction — unknown action", () => {
  test("returns error for unknown action", async () => {
    const r = await planAction(worktree, logger, locks, {
      action: "nuke_plan",
      planSlug: "unknown-action",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown action/);
  });
});
