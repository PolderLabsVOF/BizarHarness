/**
 * Init-helpers regression tests (v0.5.2).
 *
 * Covers the postmortem-2026-06-18 Layer 1 fix: `client.session.list()`
 * is now raced against a 1-second timeout. Without this, a slow or
 * broken session store would hang the plugin's `init()` forever and
 * stall the UI on a blank screen.
 *
 * Two layers of test:
 *   1) `withTimeout` — pure unit tests on the timeout helper itself.
 *   2) `readValidSessionIds` — integration-style test that passes a
 *      fake `PluginInput` whose `client.session.list()` never resolves
 *      and verifies that the function returns within ~1.1s.
 *
 * The second test is what would have caught the original bug: the
 * function must NOT block forever on a slow session store.
 */

import { describe, test, expect } from "bun:test";

import {
  withTimeout,
  readValidSessionIds,
} from "../index.js";

// ---------------------------------------------------------------------------
// `withTimeout` — pure unit tests
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
  test("resolves with the promise's value when it completes in time", async () => {
    const result = await withTimeout(
      Promise.resolve("ok"),
      1000,
      "test",
    );
    expect(result).toBe("ok");
  });

  test("rejects with a labeled error when the promise takes too long", async () => {
    const hanging = new Promise<string>(() => {
      // never resolves
    });
    const start = Date.now();
    let caught: Error | null = null;
    try {
      await withTimeout(hanging, 100, "hanging-promise");
    } catch (err) {
      caught = err as Error;
    }
    const elapsed = Date.now() - start;
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain("hanging-promise");
    expect(caught?.message).toContain("100ms");
    // Should fire within ~100ms (allow 50ms of slack for event-loop jitter).
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(500);
  });

  test("propagates rejections from the underlying promise", async () => {
    const failing = Promise.reject(new Error("underlying failure"));
    let caught: Error | null = null;
    try {
      await withTimeout(failing, 1000, "test");
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toBe("underlying failure");
  });

  test("clears the timer on success (no late rejection)", async () => {
    // Resolve after 50ms, well within the 1000ms timeout. The timer
    // should be cleared; we can't directly observe the cleanup, but
    // the test verifies the function returns the value without ever
    // throwing (the cleared timer's callback never fires).
    const result = await withTimeout(
      new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      1000,
      "test",
    );
    expect(result).toBe("late");
    // Wait long enough that a leaked timer would have fired.
    await new Promise((r) => setTimeout(r, 100));
  });
});

// ---------------------------------------------------------------------------
// `readValidSessionIds` — the postmortem Layer 1 fix
// ---------------------------------------------------------------------------

/**
 * Minimal `PluginInput` shape for testing `readValidSessionIds`. We
 * only need `client`; the other fields are never read by the
 * function under test.
 */
function makeInput(client: unknown): { client: unknown } {
  return { client } as never;
}

describe("readValidSessionIds — postmortem Layer 1 fix (v0.5.2)", () => {
  test("returns the session IDs when client.session.list() resolves", async () => {
    const input = makeInput({
      session: {
        list: async () => ({
          data: [
            { id: "ses_a" },
            { id: "ses_b" },
          ],
        }),
      },
    });
    const ids = await readValidSessionIds(input as never);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(["ses_a", "ses_b"]);
  });

  test("returns the session IDs when client.session.list() returns an array directly", async () => {
    const input = makeInput({
      session: {
        list: async () => [{ id: "ses_x" }, { id: "ses_y" }],
      },
    });
    const ids = await readValidSessionIds(input as never);
    expect([...ids].sort()).toEqual(["ses_x", "ses_y"]);
  });

  test("returns empty set when client.session is missing", async () => {
    const input = makeInput({});
    const ids = await readValidSessionIds(input as never);
    expect(ids.size).toBe(0);
  });

  test("returns empty set when client.session.list is not a function", async () => {
    const input = makeInput({ session: { list: "not-a-function" } });
    const ids = await readValidSessionIds(input as never);
    expect(ids.size).toBe(0);
  });

  test("returns empty set when client.session.list() rejects", async () => {
    const input = makeInput({
      session: {
        list: async () => {
          throw new Error("session store down");
        },
      },
    });
    const ids = await readValidSessionIds(input as never);
    expect(ids.size).toBe(0);
  });

  test(
    "REGRESSION: returns within 1.5s when client.session.list() hangs forever (postmortem Layer 1)",
    async () => {
      // This is the actual bug from the 2026-06-18 postmortem. Before
      // the fix, the call would hang forever and the plugin's `init()`
      // would never resolve.
      const input = makeInput({
        session: {
          list: () => new Promise(() => {
            // never resolves — simulates a stuck session store
          }),
        },
      });
      const start = Date.now();
      const ids = await readValidSessionIds(input as never);
      const elapsed = Date.now() - start;
      // The function should return within ~1s (the timeout). We allow
      // 500ms of slack for event-loop jitter.
      expect(elapsed).toBeLessThan(1500);
      // The fallback is an empty set — the age-based cleanup still
      // runs (spec §4.6).
      expect(ids.size).toBe(0);
    },
  );

  test(
    "REGRESSION: late rejection from hanging list() does not crash the process",
    async () => {
      // After the 1s timeout fires, the original `list()` call may
      // eventually reject (or it may never). The function attaches a
      // no-op `.catch(() => undefined)` to suppress the unhandled-
      // rejection. We can't directly observe unhandled rejections in
      // bun:test, but we can verify the function returns cleanly.
      let rejectFn: ((err: Error) => void) | null = null;
      const input = makeInput({
        session: {
          list: () => new Promise((_, reject) => {
            rejectFn = reject;
          }),
        },
      });
      const ids = await readValidSessionIds(input as never);
      expect(ids.size).toBe(0);
      // Now reject the hanging promise AFTER the function returned.
      // If the no-op catch is missing, this would be an unhandled
      // rejection. With it, the process keeps running.
      if (rejectFn) rejectFn(new Error("late rejection"));
      // Give the microtask queue a chance to run.
      await new Promise((r) => setTimeout(r, 10));
    },
  );
});
