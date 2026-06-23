/**
 * fingerprint.test.ts
 *
 * Tests for stable fingerprint computation per §5.1, §5.3.
 */

import { describe, test, expect } from "bun:test";
import { fingerprint } from "../src/fingerprint";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** Use a real temp directory as the worktree for path normalization tests */
const WORKTREE = path.join(os.tmpdir(), "bizar-fingerprint-test-worktree");
const OUTSIDE_TREE = path.join(os.tmpdir(), "bizar-outside-worktree");

function setupWorktree() {
  try {
    mkdirSync(WORKTREE, { recursive: true });
    mkdirSync(OUTSIDE_TREE, { recursive: true });
    // Create a file inside the worktree for path tests
    writeFileSync(path.join(WORKTREE, "file.txt"), "x");
  } catch {
    // dir may already exist
  }
}

function teardownWorktree() {
  try { rmSync(WORKTREE, { recursive: true, force: true }); } catch { /* ok */ }
  try { rmSync(OUTSIDE_TREE, { recursive: true, force: true }); } catch { /* ok */ }
}

setupWorktree();

describe("fingerprint — stable hash", () => {
  test("same args produce the same fingerprint", () => {
      const args = { path: path.join(os.tmpdir(), "foo.ts"), recursive: false };
    const a = fingerprint("read", args, WORKTREE);
    const b = fingerprint("read", args, WORKTREE);
    expect(a).toBe(b);
  });

  test("different tool name produces different fingerprint", () => {
      const args = { path: path.join(os.tmpdir(), "foo.ts") };
    const a = fingerprint("read", args, WORKTREE);
    const b = fingerprint("edit", args, WORKTREE);
    expect(a).not.toBe(b);
  });

  test("different args produce different fingerprint", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts") }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "bar.ts") }, WORKTREE);
    expect(a).not.toBe(b);
  });

  test("empty args object produces stable hash", () => {
    const a = fingerprint("read", {}, WORKTREE);
    const b = fingerprint("read", {}, WORKTREE);
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });
});

describe("fingerprint — path normalization", () => {
  test("in-worktree absolute path becomes worktree-relative", () => {
    const inWorktree = path.join(WORKTREE, "src", "index.ts");
    const fp1 = fingerprint("read", { path: inWorktree }, WORKTREE);
    const fp2 = fingerprint("read", { path: "src/index.ts" }, WORKTREE);
    expect(fp1).toBe(fp2);
  });

  test("out-of-worktree absolute path becomes per-path stable hash (not global sentinel)", () => {
    const outside = path.join(OUTSIDE_TREE, "secret.txt");
    const fp1 = fingerprint("read", { path: outside }, WORKTREE);
    const fp2 = fingerprint("read", { path: outside }, WORKTREE);
    expect(fp1).toBe(fp2);
    // Must NOT collide with a different outside path
    const different = path.join(os.tmpdir(), "different/path/file.txt");
    const fp3 = fingerprint("read", { path: different }, WORKTREE);
    expect(fp1).not.toBe(fp3);
  });

  test("two distinct absolute paths outside worktree produce two distinct hashes", () => {
    const pathA = path.join(OUTSIDE_TREE, "a.txt");
    const pathB = path.join(OUTSIDE_TREE, "b.txt");
    const fpA = fingerprint("read", { path: pathA }, WORKTREE);
    const fpB = fingerprint("read", { path: pathB }, WORKTREE);
    expect(fpA).not.toBe(fpB);
  });
});

describe("fingerprint — noise field stripping", () => {
  test("strips timestamp fields", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), createdAt: 1234567890 }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), createdAt: 9999999999 }, WORKTREE);
    expect(a).toBe(b);
  });

  test("strips updatedAt timestamp fields", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), updatedAt: "2024-01-01T00:00:00Z" }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), updatedAt: "2025-12-31T23:59:59Z" }, WORKTREE);
    expect(a).toBe(b);
  });

  test("strips id field", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), id: "abc123" }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), id: "xyz789" }, WORKTREE);
    expect(a).toBe(b);
  });

  test("strips uuid field", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), uuid: "550e8400-e29b-41d4-a716-446655440000" }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), uuid: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }, WORKTREE);
    expect(a).toBe(b);
  });

  test("strips nonce field", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), nonce: "random1" }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), nonce: "random2" }, WORKTREE);
    expect(a).toBe(b);
  });

  test("strips cwd field entirely", () => {
    const a = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), cwd: "/home/user" }, WORKTREE);
    const b = fingerprint("read", { path: path.join(os.tmpdir(), "foo.ts"), cwd: "/completely/different" }, WORKTREE);
    expect(a).toBe(b);
  });
});

describe("fingerprint — nested objects", () => {
  test("nested objects are normalized recursively", () => {
    const a = fingerprint("edit", {
      meta: { author: "Alice", timestamp: 1000 },
      path: path.join(os.tmpdir(), "foo.ts"),
    }, WORKTREE);
    const b = fingerprint("edit", {
      path: path.join(os.tmpdir(), "foo.ts"),
      meta: { timestamp: 9999, author: "Alice" },
    }, WORKTREE);
    expect(a).toBe(b);
  });

  test("deeply nested paths normalized correctly", () => {
    const inWorktree = path.join(WORKTREE, "deeply", "nested", "file.ts");
    const fp = fingerprint("read", {
      config: {
        files: [inWorktree],
      },
    }, WORKTREE);
    const fpRelative = fingerprint("read", {
      config: {
        files: ["deeply/nested/file.ts"],
      },
    }, WORKTREE);
    expect(fp).toBe(fpRelative);
  });
});

// Run canonical key order tests in a separate file (canonical-key-order.test.ts)
// to satisfy §12.1 which references the test by name.

teardownWorktree();