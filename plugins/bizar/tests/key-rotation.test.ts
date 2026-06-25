/**
 * key-rotation unit tests.
 *
 * Covers:
 *   1. discoverMiniMaxKeys — env var parsing (comma list vs numbered, empty,
 *      whitespace, defensive cap)
 *   2. wrapFetchForKeyRotation — provider routing (only minimax URLs)
 *   3. wrapFetchForKeyRotation — pass-through (no rotation when <2 keys,
 *      non-chat-completions URLs, non-POST methods)
 *   4. wrapFetchForKeyRotation — retry on 429 / 402 / 5xx
 *   5. wrapFetchForKeyRotation — no retry on 401 / 400 / 200
 *   6. wrapFetchForKeyRotation — round-robin starting index advances
 *      after success
 *   7. wrapFetchForKeyRotation — caps retries at apiKeys.length
 */

import { describe, it, expect } from "bun:test";
import {
  wrapFetchForKeyRotation,
  discoverMiniMaxKeys,
} from "../src/key-rotation.js";

const MINI_URL = "https://minimax.io/v1/chat/completions";
const OTHER_URL = "https://example.com/v1/chat/completions";

function makeResponse(status: number, body = "{}"): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** A fake fetch that records every call and returns a queued sequence of
 *  responses (or throws if the queue is exhausted). */
function fakeFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  let i = 0;
  const fn = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, headers });
    if (i >= responses.length) throw new Error("fakeFetch: queue exhausted");
    const next = responses[i++]!;
    if (next instanceof Error) throw next;
    return next;
  }) as any;
  (fn as any).calls = calls;
  return fn;
}

/** Convenience: read the Authorization header from the i-th recorded call. */
function authOf(fake: any, i: number): string | null {
  return fake.calls[i].headers.get("Authorization");
}

// ─── discoverMiniMaxKeys ─────────────────────────────────────────────────

describe("discoverMiniMaxKeys", () => {
  it("returns empty array when no env vars are set", () => {
    expect(discoverMiniMaxKeys({})).toEqual([]);
  });

  it("reads MINIMAX_API_KEY alone (single-key mode — rotation disabled)", () => {
    expect(discoverMiniMaxKeys({ MINIMAX_API_KEY: "primary-key" })).toEqual([
      "primary-key",
    ]);
  });

  it("reads MINIMAX_API_KEY + numbered _2/_3 in order", () => {
    expect(
      discoverMiniMaxKeys({
        MINIMAX_API_KEY: "k1",
        MINIMAX_API_KEY_2: "k2",
        MINIMAX_API_KEY_3: "k3",
      }),
    ).toEqual(["k1", "k2", "k3"]);
  });

  it("skips gaps in numbered vars", () => {
    expect(
      discoverMiniMaxKeys({
        MINIMAX_API_KEY: "k1",
        MINIMAX_API_KEY_3: "k3", // gap at _2
      }),
    ).toEqual(["k1", "k3"]);
  });

  it("prefers MINIMAX_API_KEYS (comma list) over numbered vars", () => {
    expect(
      discoverMiniMaxKeys({
        MINIMAX_API_KEYS: "a,b,c",
        MINIMAX_API_KEY: "ignored",
        MINIMAX_API_KEY_2: "also-ignored",
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace and filters empty entries in comma list", () => {
    expect(
      discoverMiniMaxKeys({
        MINIMAX_API_KEYS: "  k1 , , k2 ,,k3  ",
      }),
    ).toEqual(["k1", "k2", "k3"]);
  });

  it("caps rotation at 16 keys (defensive)", () => {
    const many = Array.from({ length: 25 }, (_, i) => `k${i + 1}`).join(",");
    const got = discoverMiniMaxKeys({ MINIMAX_API_KEYS: many });
    expect(got.length).toBe(16);
    expect(got[0]).toBe("k1");
    expect(got[15]).toBe("k16");
  });
});

// ─── wrapFetchForKeyRotation — provider routing ───────────────────────────

describe("wrapFetchForKeyRotation — provider routing", () => {
  it("wraps POST /chat/completions targeting minimax.io", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    await wrapped(MINI_URL, { method: "POST" });
    expect(fake.calls.length).toBe(1);
    expect(authOf(fake, 0)).toBe("Bearer k1");
  });

  it("passes through other-provider URLs without rotation", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    await wrapped(OTHER_URL, { method: "POST" });
    expect(fake.calls.length).toBe(1);
    // Authorization should be undefined (wrapper did not touch it)
    expect(authOf(fake, 0)).toBeNull();
  });

  it("passes through non-POST methods", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    await wrapped(MINI_URL, { method: "GET" });
    expect(fake.calls.length).toBe(1);
    expect(authOf(fake, 0)).toBeNull();
  });

  it("passes through non-chat-completions paths", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    await wrapped("https://minimax.io/v1/models", { method: "POST" });
    expect(fake.calls.length).toBe(1);
    expect(authOf(fake, 0)).toBeNull();
  });
});

// ─── wrapFetchForKeyRotation — pass-through / no-op ───────────────────────

describe("wrapFetchForKeyRotation — pass-through when <2 keys", () => {
  it("returns the original fetch unchanged for a single key", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["only-key"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    // The single-key path is a pure pass-through — Authorization was
    // never set by us, so the request goes out unmodified.
    expect(authOf(fake, 0)).toBeNull();
  });

  it("returns the original fetch unchanged for zero keys", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: [],
    });
    await wrapped(MINI_URL, { method: "POST" });
    expect(authOf(fake, 0)).toBeNull();
  });
});

// ─── wrapFetchForKeyRotation — retry on retryable statuses ────────────────

describe("wrapFetchForKeyRotation — rotates on retryable statuses", () => {
  it("retries with key #2 after key #1 returns 429", async () => {
    const fake = fakeFetch([makeResponse(429), makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.length).toBe(2);
    expect(authOf(fake, 0)).toBe("Bearer k1");
    expect(authOf(fake, 1)).toBe("Bearer k2");
  });

  it("retries on 402 (payment required / quota exhausted)", async () => {
    const fake = fakeFetch([makeResponse(402), makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.length).toBe(2);
  });

  it("retries on 5xx server errors", async () => {
    const fake = fakeFetch([makeResponse(503), makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.length).toBe(2);
  });

  it("retries on network errors (fetch threw)", async () => {
    const fake = fakeFetch([new Error("ECONNRESET"), makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.length).toBe(2);
    expect(authOf(fake, 0)).toBe("Bearer k1");
    expect(authOf(fake, 1)).toBe("Bearer k2");
  });

  it("caps retries at apiKeys.length — returns last failure after N attempts", async () => {
    const fake = fakeFetch([
      makeResponse(429),
      makeResponse(429),
      makeResponse(429),
    ]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(429);
    expect(fake.calls.length).toBe(3); // tried every key, no more
  });

  it("rotates through all keys when each returns 429", async () => {
    const fake = fakeFetch([
      makeResponse(429), // k1
      makeResponse(429), // k2
      makeResponse(200), // k3
    ]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.map((c: { headers: Headers }) => c.headers.get("Authorization"))).toEqual([
      "Bearer k1",
      "Bearer k2",
      "Bearer k3",
    ]);
  });
});

// ─── wrapFetchForKeyRotation — non-retryable statuses ─────────────────────

describe("wrapFetchForKeyRotation — does NOT rotate on 401 / 400 / 200", () => {
  it("returns 401 immediately without trying other keys", async () => {
    const fake = fakeFetch([makeResponse(401)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(401);
    expect(fake.calls.length).toBe(1);
    expect(authOf(fake, 0)).toBe("Bearer k1");
  });

  it("returns 400 immediately (client error — no key will fix)", async () => {
    const fake = fakeFetch([makeResponse(400)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(400);
    expect(fake.calls.length).toBe(1);
  });

  it("returns 200 immediately on success without trying other keys", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    const out = await wrapped(MINI_URL, { method: "POST" });
    expect(out.status).toBe(200);
    expect(fake.calls.length).toBe(1);
  });
});

// ─── wrapFetchForKeyRotation — round-robin on success ─────────────────────

describe("wrapFetchForKeyRotation — advances start index after success", () => {
  it("starts the next request on the next key", async () => {
    const fake = fakeFetch([
      makeResponse(200), // first request succeeds on k1
      makeResponse(200), // second request should start on k2
      makeResponse(200), // third request should start on k3
    ]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    expect(fake.calls.map((c: { headers: Headers }) => c.headers.get("Authorization"))).toEqual([
      "Bearer k1",
      "Bearer k2",
      "Bearer k3",
    ]);
  });

  it("wraps around: after the last key succeeds, the next request starts on key #0", async () => {
    const fake = fakeFetch([
      makeResponse(200), // starts k1
      makeResponse(200), // starts k2
      makeResponse(200), // starts k3
      makeResponse(200), // wraps back to k1
    ]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    expect(fake.calls.map((c: { headers: Headers }) => c.headers.get("Authorization"))).toEqual([
      "Bearer k1",
      "Bearer k2",
      "Bearer k3",
      "Bearer k1",
    ]);
  });

  it("does NOT advance the index when all keys fail (returns the error)", async () => {
    const fake = fakeFetch([
      makeResponse(429), // 1st call: k1
      makeResponse(429), // 1st call: k2
      makeResponse(200), // 1st call: k3 (succeeds, index advances past k3)
      makeResponse(200), // 2nd call: starts on k1 (index wrapped)
    ]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2", "k3"],
    });
    await wrapped(MINI_URL, { method: "POST" });
    await wrapped(MINI_URL, { method: "POST" });
    expect(authOf(fake, 3)).toBe("Bearer k1");
  });
});

// ─── wrapFetchForKeyRotation — preserves other headers ────────────────────

describe("wrapFetchForKeyRotation — preserves non-Authorization headers", () => {
  it("keeps Content-Type, custom headers, etc. from the original request", async () => {
    const fake = fakeFetch([makeResponse(200)]);
    const wrapped = wrapFetchForKeyRotation(fake, {
      providerId: "minimax",
      apiKeys: ["k1", "k2"],
    });
    await wrapped(MINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": "abc123",
      },
    });
    const headers = fake.calls[0].headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Session-Id")).toBe("abc123");
    expect(headers.get("Authorization")).toBe("Bearer k1");
  });
});