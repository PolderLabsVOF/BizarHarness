/**
 * bg-get-comments.test.ts
 *
 * Tests for `readPlanComments` — the pure read function extracted from
 * `bg-get-comments.ts` so the file-system code path can be exercised
 * without spinning up a tool framework or an opencode host.
 *
 * The tool wrapper (`createBgGetCommentsTool`) is a thin Zod schema
 * + JSON.stringify around this function; testing the wrapper itself
 * would just duplicate the same assertions on top of a JSON parser.
 * We test the function directly.
 *
 * Groups (13 tests):
 *   1. missing plan.json      — returns ok:true with []
 *   2. invalid slug           — returns ok:false with the regex error
 *   3. corrupt plan.json      — returns ok:false with "Failed to read"
 *   4. plan.json is null      — returns ok:false with "not a v2 canvas object"
 *   5. plan.json is array     — returns ok:false with "not a v2 canvas object"
 *   6. valid plan, no filter  — returns all comments, sorted
 *   7. elementId filter       — only matching comments
 *   8. elementId "nil"/"null" — canvas-pinned only
 *   9. elementId ""           — all comments (same as omitting)
 *  10. chronological sort     — oldest first
 *  11. missing created        — pushed to end
 *  12. malformed comments     — filtered out
 *  13. thread replies         — preserved
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readPlanComments } from "../../src/tools/bg-get-comments.js";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/** Per-test temp worktree. Created once for the whole suite. */
let worktree: string;

beforeAll(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-comments-test-"));
});

afterAll(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true });
  }
});

/**
 * Write a `plan.json` under `plans/<slug>/plan.json` inside the worktree.
 * Caller controls the JSON shape (valid, null, array, malformed, etc.).
 */
function writePlanJson(slug: string, data: unknown): void {
  const dir = join(worktree, "plans", slug);
  mkdirSync(dir, { recursive: true });
  // We pass `data` through `String(...)` for the "corrupt" test, so allow
  // non-stringifiable cases via JSON.stringify with the catch fallback.
  const text = typeof data === "string" ? data : JSON.stringify(data);
  writeFileSync(join(dir, "plan.json"), text, "utf-8");
}

/**
 * Standard fixture used by most tests. Contains:
 *   - 2 comments on el_a (with timestamps)
 *   - 1 comment on el_b (with timestamp)
 *   - 1 canvas-pinned comment (null elementId)
 *   - 1 comment without a `created` timestamp
 */
const SAMPLE_PLAN = {
  schemaVersion: 2,
  title: "Test Plan",
  elements: [],
  comments: [
    { id: "c_1", elementId: "el_a", text: "First", created: "2026-06-18T10:00:00Z" },
    { id: "c_2", elementId: "el_b", text: "Second", created: "2026-06-18T11:00:00Z" },
    { id: "c_3", elementId: null, text: "Canvas pinned", created: "2026-06-18T12:00:00Z" },
    { id: "c_4", elementId: "el_a", text: "No timestamp" }, // no created
  ],
};

// ===========================================================================
// Group 1 — missing plan.json
// ===========================================================================

describe("readPlanComments — missing plan.json", () => {
  it("returns ok:true with empty array when plan.json does not exist", () => {
    const result = readPlanComments(worktree, "nonexistent-plan", undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toEqual([]);
      expect(result.planSlug).toBe("nonexistent-plan");
    }
  });

  it("does not treat a missing plan as an error even with an elementId", () => {
    const result = readPlanComments(worktree, "another-missing", "el_x");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toEqual([]);
    }
  });
});

// ===========================================================================
// Group 2 — invalid slug
// ===========================================================================

describe("readPlanComments — invalid slug", () => {
  it("rejects slugs with uppercase characters", () => {
    const result = readPlanComments(worktree, "UPPERCASE", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid planSlug");
      expect(result.error).toContain("UPPERCASE");
      expect(result.error).toMatch(/a-z0-9/);
    }
  });

  it("rejects path-traversal slugs", () => {
    const result = readPlanComments(worktree, "../etc", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("../etc");
      expect(result.error).toContain("Invalid planSlug");
    }
  });

  it("rejects empty slugs", () => {
    const result = readPlanComments(worktree, "", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid planSlug");
    }
  });

  it("rejects slugs that start with a hyphen", () => {
    const result = readPlanComments(worktree, "-starts-with-hyphen", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid planSlug");
    }
  });

  it("rejects slugs longer than 64 chars", () => {
    const long = "a".repeat(65);
    const result = readPlanComments(worktree, long, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid planSlug");
    }
  });
});

// ===========================================================================
// Group 3 — corrupt plan.json
// ===========================================================================

describe("readPlanComments — corrupt plan.json", () => {
  it("returns ok:false with 'Failed to read plan.json' when JSON is invalid", () => {
    const slug = "corrupt-plan";
    const dir = join(worktree, "plans", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.json"), "{ not valid json :: !!", "utf-8");

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith("Failed to read plan.json:")).toBe(true);
      // The planSlug is always echoed back, even on error
      expect(result.planSlug).toBe(slug);
    }
  });
});

// ===========================================================================
// Group 4 — plan.json is null
// ===========================================================================

describe("readPlanComments — plan.json is null", () => {
  it("returns ok:false when the JSON literal is `null`", () => {
    const slug = "null-plan";
    writePlanJson(slug, null);
    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("plan.json is not a v2 canvas object");
      expect(result.error).toContain("object");
    }
  });
});

// ===========================================================================
// Group 5 — plan.json is array
// ===========================================================================

describe("readPlanComments — plan.json is array", () => {
  it("returns ok:false when the JSON is a top-level array", () => {
    const slug = "array-plan";
    writePlanJson(slug, []);
    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("plan.json is not a v2 canvas object");
      expect(result.error).toContain("array");
    }
  });

  it("returns ok:false for a non-empty array at the top level", () => {
    const slug = "comments-as-array";
    writePlanJson(slug, [{ id: "c_1" }]);
    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("array");
    }
  });
});

// ===========================================================================
// Group 6 — valid plan, no elementId filter
// ===========================================================================

describe("readPlanComments — valid plan, no elementId", () => {
  it("returns all comments with valid id strings, sorted by created time", () => {
    const slug = "all-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(4);
      for (const c of result.comments) {
        expect(typeof c.id).toBe("string");
        expect(c.id.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes every comment id in the result", () => {
    const slug = "all-plan-2";
    writePlanJson(slug, SAMPLE_PLAN);
    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.comments.map((c) => c.id);
      expect(ids).toContain("c_1");
      expect(ids).toContain("c_2");
      expect(ids).toContain("c_3");
      expect(ids).toContain("c_4");
    }
  });
});

// ===========================================================================
// Group 7 — elementId filter
// ===========================================================================

describe("readPlanComments — elementId filter", () => {
  it("returns only comments pinned to the requested element", () => {
    const slug = "filter-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, "el_a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(2);
      for (const c of result.comments) {
        expect(c.elementId).toBe("el_a");
      }
      const ids = result.comments.map((c) => c.id);
      expect(ids).toContain("c_1");
      expect(ids).toContain("c_4");
    }
  });

  it("returns an empty array when no comments match the requested element", () => {
    const slug = "filter-plan";
    writePlanJson(slug, SAMPLE_PLAN);
    const result = readPlanComments(worktree, slug, "el_nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toEqual([]);
    }
  });
});

// ===========================================================================
// Group 8 — elementId "nil" / "null"
// ===========================================================================

describe("readPlanComments — elementId 'nil' / 'null' (canvas-pinned only)", () => {
  it("returns only canvas-pinned comments when elementId === 'nil'", () => {
    const slug = "nil-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, "nil");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]?.id).toBe("c_3");
      expect(result.comments[0]?.elementId).toBeNull();
    }
  });

  it("returns only canvas-pinned comments when elementId === 'null'", () => {
    const slug = "null-string-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, "null");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]?.id).toBe("c_3");
    }
  });
});

// ===========================================================================
// Group 9 — elementId ""
// ===========================================================================

describe("readPlanComments — elementId '' (empty string)", () => {
  it("returns all comments (same as omitting)", () => {
    const slug = "empty-element-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, "");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(4);
    }
  });
});

// ===========================================================================
// Group 10 — chronological sort
// ===========================================================================

describe("readPlanComments — chronological sort", () => {
  it("returns comments sorted oldest first by `created`", () => {
    const slug = "sort-plan";
    writePlanJson(slug, {
      schemaVersion: 2,
      elements: [],
      comments: [
        { id: "c_late", elementId: "el_x", text: "Late", created: "2026-06-18T15:00:00Z" },
        { id: "c_early", elementId: "el_x", text: "Early", created: "2026-06-18T09:00:00Z" },
        { id: "c_mid", elementId: "el_x", text: "Mid", created: "2026-06-18T12:00:00Z" },
      ],
    });

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.comments.map((c) => c.id);
      expect(ids).toEqual(["c_early", "c_mid", "c_late"]);
    }
  });
});

// ===========================================================================
// Group 11 — missing created timestamp
// ===========================================================================

describe("readPlanComments — missing created timestamp", () => {
  it("pushes comments without `created` to the end of the sorted result", () => {
    const slug = "no-timestamp-plan";
    writePlanJson(slug, SAMPLE_PLAN);

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.comments.map((c) => c.id);
      // The 3 timestamped comments come first (oldest to newest), then c_4 with no timestamp
      expect(ids).toEqual(["c_1", "c_2", "c_3", "c_4"]);
    }
  });

  it("places comments with empty-string `created` at the end too", () => {
    const slug = "empty-timestamp-plan";
    writePlanJson(slug, {
      schemaVersion: 2,
      elements: [],
      comments: [
        { id: "c_no_ts", elementId: "el_x", text: "No ts", created: "" },
        { id: "c_a", elementId: "el_x", text: "Has ts", created: "2026-06-18T10:00:00Z" },
      ],
    });

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments.map((c) => c.id)).toEqual(["c_a", "c_no_ts"]);
    }
  });
});

// ===========================================================================
// Group 12 — malformed comments filtered out
// ===========================================================================

describe("readPlanComments — malformed comments", () => {
  it("filters out entries without a string `id`", () => {
    const slug = "malformed-plan";
    writePlanJson(slug, {
      schemaVersion: 2,
      elements: [],
      comments: [
        { id: "c_valid", elementId: "el_x", text: "Has id", created: "2026-06-18T10:00:00Z" },
        // missing id entirely
        { elementId: "el_x", text: "No id at all" } as unknown as { id: string },
        // id is the wrong type
        { id: 42, elementId: "el_x", text: "Non-string id" } as unknown as { id: string },
        // null entry in the array
        null,
        // string entry
        "string comment",
      ],
    });

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0]?.id).toBe("c_valid");
    }
  });
});

// ===========================================================================
// Group 13 — thread replies preserved
// ===========================================================================

describe("readPlanComments — thread replies", () => {
  it("passes the `thread` field through unchanged", () => {
    const slug = "thread-plan";
    const thread = [
      { id: "r_1", author: "ai", text: "Done.", created: "2026-06-18T11:00:00Z" },
      { id: "r_2", author: "DrB0rk", text: "Thanks!", created: "2026-06-18T12:00:00Z" },
    ];
    writePlanJson(slug, {
      schemaVersion: 2,
      elements: [],
      comments: [
        {
          id: "c_1",
          elementId: "el_x",
          text: "Please address feedback",
          created: "2026-06-18T10:00:00Z",
          thread,
        },
      ],
    });

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments).toHaveLength(1);
      // The thread array contents must be preserved (deep equality). Note:
      // we do NOT assert reference identity — `JSON.parse` always produces
      // fresh objects, so the returned thread is a deep-equal copy, not the
      // same array reference we wrote to disk.
      expect(result.comments[0]?.thread).toEqual(thread);
    }
  });

  it("returns undefined `thread` when the comment has no thread field", () => {
    const slug = "no-thread-plan";
    writePlanJson(slug, {
      schemaVersion: 2,
      elements: [],
      comments: [{ id: "c_1", elementId: "el_x", text: "Plain", created: "2026-06-18T10:00:00Z" }],
    });

    const result = readPlanComments(worktree, slug, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comments[0]?.thread).toBeUndefined();
    }
  });
});
