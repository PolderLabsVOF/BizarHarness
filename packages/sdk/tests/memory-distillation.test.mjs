/**
 * Tests for the RETRIEVE → JUDGE → DISTILL → CONSOLIDATE pipeline (F-033 / ADR-174).
 *
 * Roundtrip: write 3 memory entries of kind `coding_convention`,
 * run the distiller, assert ≥1 promoted pattern with
 * `provenance_tier` set.
 */

import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDistillation,
  retrieve,
  judge,
  PROVENANCE_TIERS,
} from "../src/router/memory-distillation.js";
import { writeNote } from "../dist/memory/index.js";

function makeEntry(body, opts = {}) {
  return {
    memory_id: opts.id ?? `note-${Math.random().toString(36).slice(2, 8)}`,
    frontmatter: {
      kind: opts.kind ?? "coding_convention",
      createdAt: opts.createdAt ?? new Date().toISOString(),
      ...opts.frontmatter,
    },
    body,
  };
}

describe("memory-distillation — RETRIEVE", () => {
  test("short body without code block is 'simple'", () => {
    const r = retrieve(makeEntry("Use const for module exports.", { kind: "coding_convention" }));
    expect(r.complexity).toBe("simple");
    expect(r.hasCodeBlock).toBe(false);
  });

  test("body with a fenced code block is 'complex'", () => {
    const r = retrieve(makeEntry("Pattern:\n```ts\nconst a = 1;\n```"));
    expect(r.complexity).toBe("complex");
    expect(r.hasCodeBlock).toBe(true);
  });

  test("frontmatter tag `test-exec` flips testExec=true", () => {
    const r = retrieve(makeEntry("x", { frontmatter: { tags: ["test-exec"] } }));
    expect(r.testExec).toBe(true);
  });

  test("frontmatter `kind: feedback` flips testExec=true", () => {
    const r = retrieve(makeEntry("x", { frontmatter: { kind: "feedback" } }));
    expect(r.testExec).toBe(true);
  });
});

describe("memory-distillation — JUDGE / provenance_tier", () => {
  test("testExec=true → oracle:test-exec", () => {
    const r = retrieve(makeEntry("x", { frontmatter: { tags: ["test-exec"] } }));
    expect(judge(makeEntry("x"), r)).toBe("oracle:test-exec");
  });

  test("testExec=false → proxy:structural", () => {
    const r = retrieve(makeEntry("x", { kind: "coding_convention" }));
    expect(judge(makeEntry("x"), r)).toBe("proxy:structural");
  });
});

describe("memory-distillation — RUN (4-step pipeline)", () => {
  test("3 coding_convention entries → ≥1 promoted pattern with provenance_tier", () => {
    const entries = [
      makeEntry("Always use const for module-level exports.", { kind: "coding_convention" }),
      makeEntry("Prefer async/await over raw promise chains.", { kind: "coding_convention" }),
      makeEntry(
        "Document every exported function with a JSDoc block.",
        { kind: "coding_convention", frontmatter: { kind: "coding_convention", tags: ["test-exec"] } },
      ),
    ];

    const result = runDistillation(entries);
    expect(result.patterns.length).toBeGreaterThan(0);
    // The third entry carries the `test-exec` tag → oracle tier →
    // eligible for promotion.
    const promoted = result.promoted;
    expect(promoted.length).toBeGreaterThanOrEqual(1);
    expect(promoted[0].provenance_tier).toBe("oracle:test-exec");
    expect(promoted[0].promoted).toBe(true);
    expect(result.byTier["oracle:test-exec"]).toBeGreaterThanOrEqual(1);
  });

  test("all-proxy input still produces patterns, but none promoted", () => {
    const entries = [
      makeEntry("Pattern: keep imports sorted.", { kind: "task_summary" }),
      makeEntry("Use: lint before commit.", { kind: "task_summary" }),
    ];
    const result = runDistillation(entries);
    expect(result.patterns.length).toBeGreaterThan(0);
    expect(result.promoted.length).toBe(0);
    expect(result.byTier["proxy:structural"]).toBeGreaterThan(0);
  });

  test("empty input → empty result with zero counts", () => {
    const result = runDistillation([]);
    expect(result.patterns).toEqual([]);
    expect(result.promoted).toEqual([]);
    for (const tier of PROVENANCE_TIERS) {
      expect(result.byTier[tier]).toBe(0);
    }
  });

  test("non-pattern kinds (e.g. user_preference) are not distilled", () => {
    const entries = [
      makeEntry("I prefer dark mode.", { kind: "user_preference" }),
      makeEntry("I prefer tabs.", { kind: "user_preference" }),
    ];
    const result = runDistillation(entries);
    expect(result.patterns.length).toBe(0);
  });

  test("run is idempotent (same input → same patterns)", () => {
    const entries = [
      makeEntry("Use const for top-level exports.", { kind: "coding_convention", id: "a" }),
      makeEntry(
        "Use const for top-level exports in TypeScript modules.",
        { kind: "coding_convention", frontmatter: { tags: ["test-exec"] }, id: "b" },
      ),
    ];
    const r1 = runDistillation(entries);
    const r2 = runDistillation(entries);
    expect(r2.patterns.length).toBe(r1.patterns.length);
    expect(r2.promoted.map((p) => p.id).sort()).toEqual(r1.promoted.map((p) => p.id).sort());
  });
});

describe("memory-distillation — roundtrip via in-process vault", () => {
  test("write 3 coding_convention notes → run distiller → promoted pattern exists", async () => {
    const vault = mkdtempSync(join(tmpdir(), "bizar-f033-"));
    try {
      // 1. Seed: write 3 coding_convention notes — one of them is
      //    marked `test-exec` to drive the oracle tier.
      writeNote(vault, "conv-1.md", {
        title: "Always use const for module-level exports",
        kind: "coding_convention",
        createdAt: new Date().toISOString(),
      }, "Always use `const` for module-level exports.");
      writeNote(vault, "conv-2.md", {
        title: "Prefer async/await over raw promise chains",
        kind: "coding_convention",
        createdAt: new Date().toISOString(),
      }, "Prefer `async`/`await` over raw `.then()` chains.");
      writeNote(vault, "conv-3.md", {
        title: "Document exported functions",
        kind: "coding_convention",
        createdAt: new Date().toISOString(),
        tags: ["test-exec"],
      }, "Document every exported function with a JSDoc block.");

      // 2. Read them back via the SDK in-process vault helpers.
      const vaultModule = await import("../dist/memory/index.js");
      const notes = vaultModule.listNotes(vault, "", 100);
      expect(notes.length).toBe(3);

      // 3. Translate to the distiller's input shape.
      const entries = notes.map((n) => ({
        memory_id: n.relPath,
        relPath: n.relPath,
        frontmatter: n.frontmatter ?? {},
        body: n.body ?? "",
        kind: n.frontmatter?.kind ?? n.frontmatter?.type,
        createdAt: n.frontmatter?.createdAt,
      }));

      // 4. Run the distiller and assert the promoted pattern.
      const result = runDistillation(entries);
      expect(result.patterns.length).toBeGreaterThanOrEqual(1);
      const promoted = result.promoted;
      expect(promoted.length).toBeGreaterThanOrEqual(1);
      expect(promoted[0].provenance_tier).toBe("oracle:test-exec");
      expect(promoted[0].promoted).toBe(true);
      // Provenance tier is one of the allowed ADR-174 values.
      expect(PROVENANCE_TIERS).toContain(promoted[0].provenance_tier);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
