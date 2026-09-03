/**
 * guard.test.ts
 *
 * F-206 — `/guard` progress-guarding loop SDK smoke test.
 * Run via: vitest run --root packages/sdk
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addGuard,
  getGuard,
  listGuards,
  markGuardStopped,
  normalizeSlug,
  recordGuardCheck,
  removeGuard,
  GUARD_SCHEMA_VERSION,
  type GuardCheck,
} from "../../src/agent/guard.js";

describe("guard", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "guard-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("normalizeSlug accepts lowercase ids and rejects malformed", () => {
    expect(normalizeSlug("release-12")).toBe("release-12");
    expect(() => normalizeSlug("Bad Slug")).toThrow(/GUARD_SLUG_INVALID/);
    expect(() => normalizeSlug("")).toThrow(/GUARD_SLUG_REQUIRED/);
    expect(() => normalizeSlug(undefined)).toThrow(/GUARD_SLUG_REQUIRED/);
  });

  it("addGuard creates state.json with schemaVersion and returns a Guard", () => {
    const guard = addGuard({
      planPath: "docs/plans/release-1.md",
      intervalMs: 900_000,
      goal: "ship 1.0",
      slug: "release-1",
      repoRoot: tmp,
    });
    expect(guard.slug).toBe("release-1");
    expect(guard.status).toBe("pending");
    expect(guard.intervalMs).toBe(900_000);
    expect(guard.planPath).toBe("docs/plans/release-1.md");
    expect(guard.schemaVersion).toBe(GUARD_SCHEMA_VERSION);

    const onDisk = JSON.parse(
      readFileSync(join(tmp, ".bizar/guards/release-1/state.json"), "utf-8"),
    );
    expect(onDisk.slug).toBe("release-1");
    expect(onDisk.schemaVersion).toBe("1.0.0");
  });

  it("addGuard is idempotent when re-called with identical options", () => {
    const a = addGuard({
      planPath: "docs/plans/release-1.md",
      intervalMs: 900_000,
      slug: "release-1",
      repoRoot: tmp,
    });
    const b = addGuard({
      planPath: "docs/plans/release-1.md",
      intervalMs: 900_000,
      slug: "release-1",
      repoRoot: tmp,
    });
    expect(a.startedAt).toBe(b.startedAt);
    expect(listGuards(tmp).length).toBe(1);
  });

  it("addGuard throws when re-called with mismatched options on same slug", () => {
    addGuard({
      planPath: "docs/plans/release-1.md",
      intervalMs: 900_000,
      slug: "release-1",
      repoRoot: tmp,
    });
    expect(() =>
      addGuard({
        planPath: "docs/plans/release-2.md",
        intervalMs: 900_000,
        slug: "release-1",
        repoRoot: tmp,
      }),
    ).toThrow(/GUARD_SLUG_TAKEN/);
  });

  it("addGuard rejects missing planPath and sub-second intervals", () => {
    expect(() =>
      addGuard({
        planPath: "",
        intervalMs: 900_000,
        slug: "bad",
        repoRoot: tmp,
      }),
    ).toThrow(/GUARD_PLAN_REQUIRED/);
    expect(() =>
      addGuard({
        planPath: "plan.md",
        intervalMs: 500,
        slug: "bad",
        repoRoot: tmp,
      }),
    ).toThrow(/GUARD_INTERVAL_INVALID/);
  });

  it("listGuards enumerates every guard on disk", () => {
    addGuard({
      planPath: "docs/plans/a.md",
      intervalMs: 60_000,
      slug: "alpha",
      repoRoot: tmp,
    });
    addGuard({
      planPath: "docs/plans/b.md",
      intervalMs: 60_000,
      slug: "beta",
      repoRoot: tmp,
    });
    const all = listGuards(tmp);
    expect(all.map((g) => g.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("getGuard returns null for unknown slug and the persisted record for known", () => {
    expect(getGuard("missing", tmp)).toBeNull();
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "x",
      repoRoot: tmp,
    });
    const g = getGuard("x", tmp);
    expect(g?.slug).toBe("x");
  });

  it("removeGuard returns true for existing guards and false otherwise", () => {
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "x",
      repoRoot: tmp,
    });
    expect(removeGuard("x", tmp)).toBe(true);
    expect(removeGuard("x", tmp)).toBe(false);
    expect(listGuards(tmp)).toEqual([]);
  });

  it("recordGuardCheck appends to checks.jsonl and updates state", () => {
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "x",
      repoRoot: tmp,
    });
    const check: GuardCheck = {
      ts: "2026-09-03T10:00:00.000Z",
      verdict: "healthy",
      signals: ["fresh commit"],
      recommendation: "continue",
      selfTerminated: false,
    };
    const updated = recordGuardCheck("x", check, tmp);
    expect(updated.status).toBe("running");
    expect(updated.lastVerdict).toBe("healthy");
    expect(updated.lastCheckedAt).toBe("2026-09-03T10:00:00.000Z");

    const raw = readFileSync(join(tmp, ".bizar/guards/x/checks.jsonl"), "utf-8");
    const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("healthy");
  });

  it("recordGuardCheck transitions status to done and sets stoppedAt on verdict=done", () => {
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "x",
      repoRoot: tmp,
    });
    const check: GuardCheck = {
      ts: "2026-09-03T11:00:00.000Z",
      verdict: "done",
      signals: ["plan closed"],
      recommendation: "no further action",
      selfTerminated: true,
    };
    const updated = recordGuardCheck("x", check, tmp);
    expect(updated.status).toBe("done");
    expect(updated.stoppedAt).toBe("2026-09-03T11:00:00.000Z");
  });

  it("markGuardStopped transitions status to stopped and sets stoppedAt", () => {
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "x",
      repoRoot: tmp,
    });
    const stopped = markGuardStopped("x", tmp);
    expect(stopped.status).toBe("stopped");
    expect(stopped.stoppedAt).toBeTruthy();
  });

  it("malformed state.json is treated as missing (no crash)", () => {
    const dir = join(tmp, ".bizar/guards");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "broken"), { recursive: true });
    writeFileSync(join(dir, "broken/state.json"), "{ this is not json");
    expect(getGuard("broken", tmp)).toBeNull();
    expect(listGuards(tmp)).toEqual([]);
  });

  it("recordGuardCheck throws GUARD_NOT_FOUND for unknown guard", () => {
    expect(() =>
      recordGuardCheck(
        "missing",
        {
          ts: "2026-09-03T12:00:00.000Z",
          verdict: "healthy",
          signals: [],
          recommendation: "noop",
          selfTerminated: false,
        },
        tmp,
      ),
    ).toThrow(/GUARD_NOT_FOUND/);
  });

  it("ensureDir creates nested directory layout on first add", () => {
    addGuard({
      planPath: "docs/plans/x.md",
      intervalMs: 60_000,
      slug: "nested",
      repoRoot: tmp,
    });
    expect(existsSync(join(tmp, ".bizar/guards/nested"))).toBe(true);
    expect(existsSync(join(tmp, ".bizar/guards/nested/state.json"))).toBe(true);
  });
});
