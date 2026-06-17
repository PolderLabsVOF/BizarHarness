/**
 * canonical-key-order.test.ts
 *
 * Verifies that fingerprint.ts sorts object keys canonically (alphabetically)
 * before JSON stringify, so that {a:1, b:2} and {b:2, a:1} produce the same
 * fingerprint. Per LOW finding 34 / §12.1.
 */

import { describe, test, expect } from "bun:test";
import { fingerprint } from "../src/fingerprint";

describe("fingerprint — canonical key order", () => {
  test("flat object: same keys/values in different insertion order produce the same fingerprint", () => {
    const a = {
      tool: "read",
      args: { path: "/tmp/foo.ts", recursive: false, limit: 10 },
    };
    const b = {
      tool: "read",
      args: { limit: 10, recursive: false, path: "/tmp/foo.ts" },
    };
    // Same keys, same values, different insertion order — must match.
    expect(fingerprint(a.tool, a.args, "/tmp")).toBe(fingerprint(b.tool, b.args, "/tmp"));
  });

  test("nested objects: different insertion order at both levels also match", () => {
    const a = { tool: "edit", args: { meta: { z: 1, a: 2 }, path: "/x" } };
    const b = { tool: "edit", args: { path: "/x", meta: { a: 2, z: 1 } } };
    expect(fingerprint(a.tool, a.args, "/tmp")).toBe(fingerprint(b.tool, b.args, "/tmp"));
  });

  test("deeply nested: three levels of differing key order all resolve to same fingerprint", () => {
    const a = {
      tool: "bash",
      args: {
        outer: {
          middle: {
            innerKey: "value",
            otherKey: 42,
          },
          alpha: "x",
        },
      },
    };
    const b = {
      tool: "bash",
      args: {
        outer: {
          alpha: "x",
          middle: {
            otherKey: 42,
            innerKey: "value",
          },
        },
      },
    };
    expect(fingerprint(a.tool, a.args, "/tmp")).toBe(fingerprint(b.tool, b.args, "/tmp"));
  });

  test("array order is preserved (arrays of same values in same order match)", () => {
    const a = { tool: "bash", args: { commands: ["echo a", "echo b"] } };
    const b = { tool: "bash", args: { commands: ["echo a", "echo b"] } };
    expect(fingerprint(a.tool, a.args, "/tmp")).toBe(fingerprint(b.tool, b.args, "/tmp"));
  });

  test("array with different order produces different fingerprint", () => {
    const a = { tool: "bash", args: { commands: ["echo a", "echo b"] } };
    const b = { tool: "bash", args: { commands: ["echo b", "echo a"] } };
    expect(fingerprint(a.tool, a.args, "/tmp")).not.toBe(fingerprint(b.tool, b.args, "/tmp"));
  });
});