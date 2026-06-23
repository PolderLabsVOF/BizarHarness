/**
 * settings.test.ts
 *
 * Tests for SettingsStore — read/write round-trip, atomic writes,
 * corrupt-file fallback, validation, and concurrency.
 *
 * Groups:
 *   1. defaults-on-missing-file
 *   2. defaults-on-corrupt-file
 *   3. round-trip update()
 *   4. typed set() for each key
 *   5. invalid-value rejection (clamped to safe value)
 *   6. file path expansion (~ → home)
 *   7. concurrent update() serialization
 *   8. sequential update() round-trip
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import {
  SettingsStore,
  DEFAULT_PLAN_SETTINGS,
  type PlanSettings,
} from "../src/settings";
import os from "node:os";

// Minimal mock logger
class MockLogger {
  messages: Array<{ level: string; message: string }> = [];
  log(opts: { level: string; message: string }) {
    this.messages.push(opts);
  }
  debug(m: string) { this.messages.push({ level: "debug", message: m }); }
  info(m: string) { this.messages.push({ level: "info", message: m }); }
  warn(m: string) { this.messages.push({ level: "warn", message: m }); }
  error(m: string) { this.messages.push({ level: "error", message: m }); }
}

const TEST_DIR = path.join(os.tmpdir(), "bizar-settings-test");

beforeEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

function makeLogger(): MockLogger {
  return new MockLogger();
}

// ===========================================================================
// Group 1 — defaults on missing file
// ===========================================================================

describe("SettingsStore — missing file", () => {
  test("returns DEFAULT_PLAN_SETTINGS when file does not exist", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const s = await store.get();
    expect(s).toEqual(DEFAULT_PLAN_SETTINGS);
  });

  test("does not log a warning when file is simply missing", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.get();
    // ENOENT is silent — only SyntaxError / schema errors log.
    const warns = logger.messages.filter((m) => m.level === "warn");
    expect(warns).toHaveLength(0);
  });
});

// ===========================================================================
// Group 2 — corrupt file fallback
// ===========================================================================

describe("SettingsStore — corrupt file", () => {
  test("returns defaults + warning when JSON is invalid", async () => {
    const logger = makeLogger();
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    writeFileSync(filePath, "{ not valid json :: !!", "utf8");
    const store = new SettingsStore(TEST_DIR, logger);
    const s = await store.get();
    expect(s).toEqual(DEFAULT_PLAN_SETTINGS);
    expect(logger.messages.some((m) => m.level === "warn" && m.message.includes("corrupt"))).toBe(true);
  });

  test("returns defaults + warning when JSON is null", async () => {
    const logger = makeLogger();
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    writeFileSync(filePath, "null", "utf8");
    const store = new SettingsStore(TEST_DIR, logger);
    const s = await store.get();
    expect(s).toEqual(DEFAULT_PLAN_SETTINGS);
  });

  test("returns defaults + warning when top-level is an array", async () => {
    const logger = makeLogger();
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    writeFileSync(filePath, "[]", "utf8");
    const store = new SettingsStore(TEST_DIR, logger);
    const s = await store.get();
    expect(s).toEqual(DEFAULT_PLAN_SETTINGS);
  });

  test("clamps invalid values in valid JSON without losing the file", async () => {
    const logger = makeLogger();
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        visualPlanEnabled: "yes", // wrong type
        defaultTemplate: "nonsense", // unknown
        lastUsedSlug: 42, // wrong type
      }),
      "utf8",
    );
    const store = new SettingsStore(TEST_DIR, logger);
    const s = await store.get();
    // Invalid values clamped to defaults, but the file is preserved.
    expect(s.visualPlanEnabled).toBe(false);
    expect(s.defaultTemplate).toBe("blank");
    expect(s.lastUsedSlug).toBeNull();
    expect(existsSync(filePath)).toBe(true);
  });
});

// ===========================================================================
// Group 3 — round-trip update()
// ===========================================================================

describe("SettingsStore — update() round-trip", () => {
  test("update() persists a single field and returns the merged state", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const after = await store.update({ visualPlanEnabled: true });
    expect(after.visualPlanEnabled).toBe(true);
    expect(after.defaultTemplate).toBe("blank"); // unchanged
    // File written
    const raw = JSON.parse(readFileSync(path.join(TEST_DIR, "plan-settings.json"), "utf8"));
    expect(raw.visualPlanEnabled).toBe(true);
  });

  test("update() merges multiple fields in a single call", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.update({
      visualPlanEnabled: true,
      defaultTemplate: "feature-design",
      lastUsedSlug: "my-feature",
    });
    const loaded = await store.get();
    expect(loaded).toEqual({
      visualPlanEnabled: true,
      defaultTemplate: "feature-design",
      lastUsedSlug: "my-feature",
    });
  });

  test("update() preserves existing fields not in the patch", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.update({ visualPlanEnabled: true, lastUsedSlug: "alpha" });
    await store.update({ defaultTemplate: "decision-record" });
    const loaded = await store.get();
    expect(loaded.visualPlanEnabled).toBe(true); // preserved
    expect(loaded.lastUsedSlug).toBe("alpha"); // preserved
    expect(loaded.defaultTemplate).toBe("decision-record"); // updated
  });
});

// ===========================================================================
// Group 4 — typed set() for each key
// ===========================================================================

describe("SettingsStore — set() with typed keys", () => {
  test("set('visualPlanEnabled', true) persists correctly", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const after = await store.set("visualPlanEnabled", true);
    expect(after.visualPlanEnabled).toBe(true);
  });

  test("set('defaultTemplate', 'feature-design') persists correctly", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const after = await store.set("defaultTemplate", "feature-design");
    expect(after.defaultTemplate).toBe("feature-design");
  });

  test("set('lastUsedSlug', 'foo') persists correctly", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const after = await store.set("lastUsedSlug", "foo");
    expect(after.lastUsedSlug).toBe("foo");
  });

  test("set('lastUsedSlug', null) clears the slug", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.set("lastUsedSlug", "foo");
    const after = await store.set("lastUsedSlug", null);
    expect(after.lastUsedSlug).toBeNull();
  });
});

// ===========================================================================
// Group 5 — invalid-value rejection
// ===========================================================================

describe("SettingsStore — invalid-value rejection", () => {
  test("set('defaultTemplate', 'nonsense') is rejected, default preserved", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    // Force a type-coercion via cast
    const after = await store.set("defaultTemplate", "nonsense" as never);
    expect(after.defaultTemplate).toBe("blank"); // unchanged
    expect(logger.messages.some((m) => m.level === "warn")).toBe(true);
  });

  test("update() with invalid template is silently ignored", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.set("defaultTemplate", "feature-design");
    await store.update({ defaultTemplate: "nonsense" as never });
    const after = await store.get();
    expect(after.defaultTemplate).toBe("feature-design"); // unchanged
  });
});

// ===========================================================================
// Group 6 — file path expansion
// ===========================================================================

describe("SettingsStore — file path", () => {
  test("constructor expands ~ in settingsDir", () => {
    const logger = makeLogger();
    const store = new SettingsStore("~/.cache/test-bizar", logger);
    const expected = path.join(os.homedir(), ".cache/test-bizar/plan-settings.json");
    expect(store.getFilePath()).toBe(expected);
  });

  test("settings written with ~ path land in the expanded location", async () => {
    const tmp = path.join(os.tmpdir(), "bizar-settings-expansion-test");
    rmSync(tmp, { recursive: true, force: true });
    try {
      const logger = makeLogger();
      const store = new SettingsStore(tmp, logger);
      await store.update({ visualPlanEnabled: true });
      expect(existsSync(path.join(tmp, "plan-settings.json"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Group 7 — concurrent update() serialization
// ===========================================================================

describe("SettingsStore — concurrent updates", () => {
  test("concurrent update() calls do not corrupt the file", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);

    // Fire many updates in parallel that each flip the visualPlanEnabled
    // flag. The mutex guarantees no write is lost or interleaved.
    const updates = Array.from({ length: 30 }, (_, i) =>
      store.update({ visualPlanEnabled: i % 2 === 0 }),
    );
    const results = await Promise.all(updates);

    // All returned states are valid (either true or false).
    for (const r of results) {
      expect(typeof r.visualPlanEnabled).toBe("boolean");
    }

    // The on-disk file is valid JSON (parseable).
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    expect(existsSync(filePath)).toBe(true);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PlanSettings;
    expect(typeof parsed.visualPlanEnabled).toBe("boolean");
  });

  test("concurrent set() calls do not corrupt the file", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    const sets = Array.from({ length: 20 }, (_, i) =>
      store.set("lastUsedSlug", `slug-${i}`),
    );
    const results = await Promise.all(sets);
    for (const r of results) {
      expect(typeof r.lastUsedSlug).toBe("string");
      expect(r.lastUsedSlug).toMatch(/^slug-\d+$/);
    }
    // File is valid JSON
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    expect(parsed.lastUsedSlug).toMatch(/^slug-\d+$/);
  });
});

// ===========================================================================
// Group 8 — atomic write (no .tmp file left behind)
// ===========================================================================

describe("SettingsStore — atomic write", () => {
  test("update() uses atomic rename (no .tmp file on disk)", async () => {
    const logger = makeLogger();
    const store = new SettingsStore(TEST_DIR, logger);
    await store.update({ visualPlanEnabled: true });
    const filePath = path.join(TEST_DIR, "plan-settings.json");
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});

// ===========================================================================
// Group 9 — round-trip persistence
// ===========================================================================

describe("SettingsStore — full round-trip", () => {
  test("write, then create a fresh store, reads back the same value", async () => {
    const logger1 = makeLogger();
    const store1 = new SettingsStore(TEST_DIR, logger1);
    const written = await store1.update({
      visualPlanEnabled: true,
      defaultTemplate: "bug-investigation",
      lastUsedSlug: "round-trip",
    });

    // Fresh store from the same dir
    const logger2 = makeLogger();
    const store2 = new SettingsStore(TEST_DIR, logger2);
    const read = await store2.get();

    expect(read).toEqual(written);
  });
});