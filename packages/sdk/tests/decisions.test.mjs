/**
 * decisions.test.mjs — Pillar D: Decisions log tests.
 *
 * Run: node --test packages/sdk/tests/decisions.test.mjs
 * Or:  npm run test -- --test-path-pattern decisions
 */

import { describe, test, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDir() {
  const d = join(
    tmpdir(),
    `bizar-decisions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(d, { recursive: true });
  return d;
}

async function importFresh() {
  const proj = freshDir();
  const mod = await import("../dist/learning/decisions.js").catch(() =>
    import("../src/learning/decisions.ts").catch(() => {
      throw new Error("could not import decisions — run build:sdk first");
    }),
  );
  return { ...mod, proj };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decisions", () => {
  let helpers;

  test.beforeAll(async () => {
    helpers = await importFresh();
  });

  afterEach(() => {
    try {
      const { proj } = helpers;
      if (proj && existsSync(proj)) rmSync(proj, { recursive: true });
    } catch { /* best-effort */ }
  });

  // 1. record — basic creation
  test("recordDecision creates an entry with id, ts, hash, prev_hash", async () => {
    const { recordDecision, proj } = helpers;
    const entry = recordDecision({
      event: "decide",
      subject: "use_turbo",
      rationale: "faster builds",
      refs: ["perf#123"],
      project: proj,
    });
    expect(typeof entry.id).toBe("string");
    expect(typeof entry.ts).toBe("number");
    expect(typeof entry.hash).toBe("string");
    expect(typeof entry.prev_hash).toBe("string");
    expect(entry.event).toBe("decide");
    expect(entry.subject).toBe("use_turbo");
    expect(entry.rationale).toBe("faster builds");
    expect(Array.isArray(entry.refs)).toBe(true);
    expect(entry.refs[0]).toBe("perf#123");
  });

  // 2. supersede — records a new entry linked to the previous
  test("supersede records a new entry", async () => {
    const { recordDecision, listDecisions, proj } = helpers;
    recordDecision({ event: "decide", subject: "route_a", rationale: "initial", project: proj });
    recordDecision({ event: "supersede", subject: "route_a", rationale: "better option found", project: proj });
    const all = listDecisions({ project: proj });
    expect(all.length).toBe(2);
    expect(all[1].event).toBe("supersede");
    expect(all[1].subject).toBe("route_a");
  });

  // 3. redact — marks entry as redacted (still present, hash chain intact)
  test("redact records a redaction entry", async () => {
    const { recordDecision, listDecisions, proj } = helpers;
    recordDecision({ event: "decide", subject: "old_approach", rationale: "initial", project: proj });
    recordDecision({ event: "redact", subject: "old_approach", rationale: "superseded by route_b", project: proj });
    const all = listDecisions({ project: proj });
    expect(all.length).toBe(2);
    expect(all[1].event).toBe("redact");
  });

  // 4. chain verify — all entries chain correctly
  test("verifyChain returns ok=true for a valid chain", async () => {
    const { recordDecision, verifyChain, proj } = helpers;
    recordDecision({ event: "decide", subject: "x", rationale: "a", project: proj });
    recordDecision({ event: "decide", subject: "y", rationale: "b", project: proj });
    const result = verifyChain({ project: proj });
    expect(result.ok).toBe(true);
  });

  // 5. tamper detection — modify one byte, verifyChain returns false
  test("verifyChain returns ok=false when a byte is tampered", async () => {
    const { recordDecision, proj } = helpers;
    recordDecision({ event: "decide", subject: "x", rationale: "a", project: proj });
    const path = join(proj, ".bizar", "learning", "decisions.jsonl");
    const raw = readFileSync(path, "utf8");
    // Flip one byte in the middle of the file.
    const tampered = raw.slice(0, Math.floor(raw.length / 2)) + "X" + raw.slice(Math.floor(raw.length / 2) + 1);
    rmSync(path);
    writeFileSync(path, tampered, "utf8");
    const { verifyChain } = await importFresh();
    const result = verifyChain({ project: proj });
    expect(result.ok).toBe(false);
    expect(typeof result.at).toBe("number");
  });

  // 6. datamark render — escapes unicode surrogates
  test("datamark escapes unicode surrogates", async () => {
    const { datamark } = helpers;
    // Isolated surrogate pair (invalid standalone UTF-8).
    const input = "hello \uD800 world";
    const out = datamark(input);
    expect(out).not.toContain("\uD800");
    expect(out).toContain("�");
  });
});

// ---------------------------------------------------------------------------
// Inline writeFileSync helper for the tamper test (Node built-ins)
// ---------------------------------------------------------------------------
import { writeFileSync } from "node:fs";
