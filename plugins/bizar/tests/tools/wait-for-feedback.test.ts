/**
 * wait-for-feedback.test.ts
 *
 * Tests for `waitForFeedback` in src/tools/wait-for-feedback.ts.
 *
 * We test the core function (extracted from the tool factory) directly
 * with an injectable `sleep` and `now` so tests run instantly. The
 * tool factory's wrapper is thin and adds no behavior.
 *
 * Groups:
 *   1. timeout (no feedback → status: "timed_out")
 *   2. immediate feedback (comments already present)
 *   3. delayed feedback (comments added while polling)
 *   4. approved status (meta.json)
 *   5. rejected status (meta.json)
 *   6. sinceTimestamp filter (only newer comments count)
 *   7. invalid slug → error
 *   8. missing plan → error
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { waitForFeedback } from "../../src/tools/wait-for-feedback.ts";

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

beforeAll(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-wait-feedback-test-"));
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

/** Make a sleep function that just bumps a fake clock by `ms` instead of
 *  actually waiting. Tests stay fast even with big timeout values. */
function fakeSleep(now: { t: number }) {
  return (ms: number) => {
    now.t += ms;
    return Promise.resolve();
  };
}

// ===========================================================================
// Group 1 — timeout
// ===========================================================================

describe("waitForFeedback — timeout", () => {
  test("returns timed_out when no feedback arrives", async () => {
    const slug = "timeout-no-feedback";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    const now = { t: 1000 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 50 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("timed_out");
      expect(r.newComments).toEqual([]);
      expect(r.planStatus).toBe("draft");
    }
  });

  test("clamps timeout to minimum 5000ms", async () => {
    const slug = "timeout-clamp";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 100 }, // way below min
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Waited exactly the clamped minimum (5000ms), no feedback → timed out
      expect(r.status).toBe("timed_out");
      expect(r.waitedMs).toBeGreaterThanOrEqual(5000);
    }
  });
});

// ===========================================================================
// Group 2 — immediate feedback (comments already present)
// ===========================================================================

describe("waitForFeedback — immediate feedback", () => {
  test("returns feedback_received on first tick when comments exist", async () => {
    const slug = "immediate-comments";
    seedCanvas(slug, {
      schemaVersion: 2,
      comments: [
        { id: "c_1", text: "Hello", created: "2026-06-18T10:00:00Z", author: "DrB0rk" },
      ],
    });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("feedback_received");
      expect(r.newComments).toHaveLength(1);
      expect(r.newComments[0]!.id).toBe("c_1");
    }
  });
});

// ===========================================================================
// Group 3 — delayed feedback (comments added while polling)
// ===========================================================================

describe("waitForFeedback — delayed feedback", () => {
  test("returns feedback_received when comments appear during polling", async () => {
    const slug = "delayed-comments";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    const now = { t: 0 };

    // Sleep that injects a comment after 2 ticks
    let sleepCount = 0;
    const sleep = (ms: number) => {
      sleepCount++;
      now.t += ms;
      // After 2 sleeps (i.e. during the 3rd tick), add a comment.
      if (sleepCount === 2) {
        const canvas = {
          schemaVersion: 2,
          comments: [
            { id: "c_late", text: "Late", created: "2026-06-18T12:00:00Z" },
          ],
        };
        writeFileSync(planJsonPath(slug), JSON.stringify(canvas), "utf-8");
      }
      return Promise.resolve();
    };

    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep,
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("feedback_received");
      expect(r.newComments).toHaveLength(1);
      expect(r.newComments[0]!.id).toBe("c_late");
    }
  });
});

// ===========================================================================
// Group 4 — approved status
// ===========================================================================

describe("waitForFeedback — approved", () => {
  test("returns approved when meta.json status is approved (on first tick)", async () => {
    const slug = "approved-first-tick";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    seedMeta(slug, { status: "approved" });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("approved");
      expect(r.planStatus).toBe("approved");
    }
  });

  test("returns approved when meta.json becomes approved during polling", async () => {
    const slug = "approved-during";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    const now = { t: 0 };
    let sleepCount = 0;
    const sleep = (ms: number) => {
      sleepCount++;
      now.t += ms;
      if (sleepCount === 2) {
        writeFileSync(metaJsonPath(slug), JSON.stringify({ status: "approved" }));
      }
      return Promise.resolve();
    };
    const r = await waitForFeedback(
      { worktree, logger: new MockLogger(), pollIntervalMs: 5, sleep, now: () => now.t },
      { planSlug: slug, timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("approved");
  });
});

// ===========================================================================
// Group 5 — rejected status
// ===========================================================================

describe("waitForFeedback — rejected", () => {
  test("returns rejected when meta.json status is rejected", async () => {
    const slug = "rejected-ok";
    seedCanvas(slug, { schemaVersion: 2, comments: [] });
    seedMeta(slug, { status: "rejected" });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      { planSlug: slug, timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("rejected");
      expect(r.planStatus).toBe("rejected");
    }
  });
});

// ===========================================================================
// Group 6 — sinceTimestamp filter
// ===========================================================================

describe("waitForFeedback — sinceTimestamp filter", () => {
  test("only counts comments strictly after sinceTimestamp", async () => {
    const slug = "since-ts";
    seedCanvas(slug, {
      schemaVersion: 2,
      comments: [
        { id: "c_old", text: "Old", created: "2026-06-18T09:00:00Z" },
        { id: "c_new", text: "New", created: "2026-06-18T11:00:00Z" },
      ],
    });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      {
        planSlug: slug,
        timeoutMs: 60_000,
        sinceTimestamp: "2026-06-18T10:00:00Z",
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("feedback_received");
      expect(r.newComments).toHaveLength(1);
      expect(r.newComments[0]!.id).toBe("c_new");
    }
  });

  test("returns timed_out when all comments are older than sinceTimestamp", async () => {
    const slug = "since-ts-no-new";
    seedCanvas(slug, {
      schemaVersion: 2,
      comments: [
        { id: "c_old", text: "Old", created: "2026-06-18T09:00:00Z" },
      ],
    });
    const now = { t: 0 };
    const r = await waitForFeedback(
      {
        worktree,
        logger: new MockLogger(),
        pollIntervalMs: 5,
        sleep: fakeSleep(now),
        now: () => now.t,
      },
      {
        planSlug: slug,
        timeoutMs: 60_000,
        sinceTimestamp: "2026-06-18T12:00:00Z",
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("timed_out");
      expect(r.newComments).toEqual([]);
    }
  });
});

// ===========================================================================
// Group 7 — invalid slug
// ===========================================================================

describe("waitForFeedback — invalid slug", () => {
  test("returns error result for invalid slug", async () => {
    const r = await waitForFeedback(
      { worktree, logger: new MockLogger(), pollIntervalMs: 5, sleep: fakeSleep({ t: 0 }), now: () => 0 },
      { planSlug: "UPPERCASE", timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Invalid planSlug/);
    }
  });
});

// ===========================================================================
// Group 8 — missing plan
// ===========================================================================

describe("waitForFeedback — missing plan", () => {
  test("returns error result when plan directory does not exist", async () => {
    const r = await waitForFeedback(
      { worktree, logger: new MockLogger(), pollIntervalMs: 5, sleep: fakeSleep({ t: 0 }), now: () => 0 },
      { planSlug: "does-not-exist", timeoutMs: 60_000 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Plan not found/);
    }
  });
});