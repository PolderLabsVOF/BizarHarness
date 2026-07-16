/**
 * instincts.test.mjs — Pillar D: Instinct log tests.
 *
 * Run: node --test packages/sdk/tests/instincts.test.mjs
 * Or:  npm run test -- --test-path-pattern instincts
 */

import { describe, test, expect, afterEach, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDir() {
  const d = join(tmpdir(), `bizar-instincts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

async function importFresh() {
  // Use a unique tmp project to avoid cross-test contamination.
  const proj = freshDir();
  // Dynamically import the TS source via the dist stub.
  // We build first, then import from dist.
  const { recordInstinct, listInstincts, promoteInstinct, dropInstinct } =
    await import("../dist/learning/instincts.js").catch(() =>
      // Fallback: import TypeScript source via tsx (for dev).
      import("../src/learning/instincts.ts").catch(() => {
        throw new Error("could not import instincts — run build:sdk first");
      }),
    );
  return { recordInstinct, listInstincts, promoteInstinct, dropInstinct, proj };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("instincts", () => {
  let helpers;

  test.beforeAll(async () => {
    helpers = await importFresh();
  });

  afterEach(() => {
    // Clean up tmp project dir after each test.
    try {
      const { proj } = helpers;
      if (proj && existsSync(proj)) rmSync(proj, { recursive: true });
    } catch { /* best-effort */ }
  });

  // 1. record — basic creation
  test("recordInstinct creates an entry with all fields", async () => {
    const { recordInstinct, proj } = helpers;
    const entry = recordInstinct({
      trigger: "npm install",
      action: "run_preinstall",
      confidence: 0.7,
      evidence: ["runs on every clone"],
      scope: "project",
      project: proj,
    });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.trigger).toBe("npm install");
    expect(entry.action).toBe("run_preinstall");
    expect(entry.confidence).toBe(0.7);
    expect(Array.isArray(entry.evidence)).toBe(true);
    expect(entry.evidence[0]).toBe("runs on every clone");
    expect(entry.scope).toBe("project");
    expect(entry.created_at).toBeTruthy();
    expect(entry.updated_at).toBeTruthy();
  });

  // 2. list — returns recorded entries
  test("listInstincts returns recorded entries", async () => {
    const { recordInstinct, listInstincts, proj } = helpers;
    recordInstinct({ trigger: "git push", action: "check_remote", project: proj });
    recordInstinct({ trigger: "npm install", action: "run_preinstall", project: proj });
    const all = listInstincts({ project: proj });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  // 3. promote — raises confidence and updates updated_at
  test("promoteInstinct raises confidence and updates updated_at", async () => {
    const { recordInstinct, promoteInstinct, listInstincts, proj } = helpers;
    const e = recordInstinct({ trigger: "git push", action: "check_remote", confidence: 0.3, project: proj });
    const updated = promoteInstinct(e.id, 0.9, { project: proj });
    expect(updated).not.toBeNull();
    expect(updated.confidence).toBe(0.9);
    const listed = listInstincts({ project: proj });
    const found = listed.find((x) => x.id === e.id);
    expect(found.confidence).toBe(0.9);
  });

  // 4. drop — removes entry
  test("dropInstinct removes the entry", async () => {
    const { recordInstinct, dropInstinct, listInstincts, proj } = helpers;
    const e = recordInstinct({ trigger: "ls", action: "list_dir", project: proj });
    const gone = dropInstinct(e.id, { project: proj });
    expect(gone).toBe(true);
    const remaining = listInstincts({ project: proj });
    expect(remaining.find((x) => x.id === e.id)).toBeUndefined();
  });

  // 5. atomic append — file remains valid JSONL after append
  test("append is atomic: file stays valid JSONL after write", async () => {
    const { recordInstinct, proj } = helpers;
    const path = join(proj, ".bizar", "learning", "instincts.jsonl");
    // Write 3 entries rapidly.
    for (let i = 0; i < 3; i++) {
      recordInstinct({ trigger: `cmd_${i}`, action: `action_${i}`, project: proj });
    }
    // File must be readable as lines of valid JSON.
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // 6. scope filter — project vs global
  test("listInstincts filters by scope", async () => {
    const { recordInstinct, listInstincts, proj } = helpers;
    recordInstinct({ trigger: "git push", action: "check", scope: "global", project: proj });
    recordInstinct({ trigger: "npm install", action: "run", scope: "project", project: proj });
    const global = listInstincts({ scope: "global", project: proj });
    const project = listInstincts({ scope: "project", project: proj });
    expect(global.every((e) => e.scope === "global")).toBe(true);
    expect(project.every((e) => e.scope === "project")).toBe(true);
  });
});
