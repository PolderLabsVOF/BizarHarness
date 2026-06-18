/**
 * commands.test.ts
 *
 * Tests for the pure `parseSlashCommand` function in src/commands.ts.
 *
 * The parser is a pure function — no I/O, no Date.now() — so all tests
 * just feed it text and assert on the returned descriptor.
 *
 * Groups:
 *   1. /visual-plan on/off/status
 *   2. /plan new (with and without template)
 *   3. /plan list
 *   4. /plan open
 *   5. /help / /commands
 *   6. non-slash messages → null
 *   7. unknown commands → error response
 *   8. invalid input → error response
 */

import { describe, test, expect } from "bun:test";
import { parseSlashCommand } from "../src/commands";
import {
  DEFAULT_PLAN_SETTINGS,
  type PlanSettings,
} from "../src/settings";

const baseCtx = {
  currentSettings: DEFAULT_PLAN_SETTINGS,
  availablePlanSlugs: [] as readonly string[],
  defaultPort: 4321,
};

function ctxWith(
  overrides: Partial<{
    currentSettings: PlanSettings;
    availablePlanSlugs: readonly string[];
    defaultPort: number;
  }> = {},
) {
  return {
    currentSettings: overrides.currentSettings ?? DEFAULT_PLAN_SETTINGS,
    availablePlanSlugs: overrides.availablePlanSlugs ?? [],
    defaultPort: overrides.defaultPort ?? 4321,
  };
}

// ===========================================================================
// Group 1 — /visual-plan on/off/status
// ===========================================================================

describe("parseSlashCommand — /visual-plan", () => {
  test("'/visual-plan on' returns settingsPatch: { visualPlanEnabled: true }", () => {
    const r = parseSlashCommand("/visual-plan on", baseCtx);
    expect(r).not.toBeNull();
    expect(r!.handled).toBe(true);
    expect(r!.settingsPatch).toEqual({ visualPlanEnabled: true });
    expect(r!.response).toMatch(/on/i);
  });

  test("'/visual-plan off' returns settingsPatch: { visualPlanEnabled: false }", () => {
    const r = parseSlashCommand("/visual-plan off", baseCtx);
    expect(r).not.toBeNull();
    expect(r!.settingsPatch).toEqual({ visualPlanEnabled: false });
    expect(r!.response).toMatch(/off/i);
  });

  test("'/visual-plan' (no arg) returns current state without mutation", () => {
    const on = ctxWith({ currentSettings: { ...DEFAULT_PLAN_SETTINGS, visualPlanEnabled: true } });
    const r = parseSlashCommand("/visual-plan", on);
    expect(r).not.toBeNull();
    expect(r!.settingsPatch).toBeUndefined();
    expect(r!.response).toMatch(/on/);
  });

  test("'/visual-plan' reflects off state correctly", () => {
    const off = ctxWith({ currentSettings: { ...DEFAULT_PLAN_SETTINGS, visualPlanEnabled: false } });
    const r = parseSlashCommand("/visual-plan", off);
    expect(r!.response).toMatch(/off/);
  });

  test("'/visual-plan status' returns status without mutation", () => {
    const r = parseSlashCommand("/visual-plan status", baseCtx);
    expect(r!.settingsPatch).toBeUndefined();
    expect(r!.response).toMatch(/off/);
  });

  test("'/visual-plan true' is treated like 'on'", () => {
    const r = parseSlashCommand("/visual-plan true", baseCtx);
    expect(r!.settingsPatch).toEqual({ visualPlanEnabled: true });
  });

  test("'/visual-plan false' is treated like 'off'", () => {
    const r = parseSlashCommand("/visual-plan false", baseCtx);
    expect(r!.settingsPatch).toEqual({ visualPlanEnabled: false });
  });

  test("'/visual-plan nonsense' returns an error response (still handled)", () => {
    const r = parseSlashCommand("/visual-plan nonsense", baseCtx);
    expect(r).not.toBeNull();
    expect(r!.handled).toBe(true);
    expect(r!.settingsPatch).toBeUndefined();
    expect(r!.response).toMatch(/Unknown argument/);
  });
});

// ===========================================================================
// Group 2 — /plan new
// ===========================================================================

describe("parseSlashCommand — /plan new", () => {
  test("'/plan new foo' returns success response + sideEffect=create_plan", () => {
    const r = parseSlashCommand("/plan new foo", baseCtx);
    expect(r).not.toBeNull();
    expect(r!.handled).toBe(true);
    expect(r!.sideEffect).toEqual({
      kind: "create_plan",
      slug: "foo",
      template: null,
    });
    expect(r!.settingsPatch).toEqual({ lastUsedSlug: "foo" });
    expect(r!.response).toMatch(/foo/);
  });

  test("'/plan new foo feature-design' uses the named template", () => {
    const r = parseSlashCommand("/plan new foo feature-design", baseCtx);
    expect(r!.sideEffect).toEqual({
      kind: "create_plan",
      slug: "foo",
      template: "feature-design",
    });
    expect(r!.response).toMatch(/feature-design/);
  });

  test("'/plan new foo decision-record' uses the decision-record template", () => {
    const r = parseSlashCommand("/plan new foo decision-record", baseCtx);
    expect(r!.sideEffect).toEqual({
      kind: "create_plan",
      slug: "foo",
      template: "decision-record",
    });
  });

  test("'/plan new foo unknown-template' returns an error response", () => {
    const r = parseSlashCommand("/plan new foo unknown-template", baseCtx);
    expect(r!.handled).toBe(true);
    expect(r!.sideEffect).toBeUndefined();
    expect(r!.response).toMatch(/Unknown template/);
  });

  test("'/plan new' (no slug) returns a usage message", () => {
    const r = parseSlashCommand("/plan new", baseCtx);
    expect(r!.response).toMatch(/Usage/);
    expect(r!.sideEffect).toBeUndefined();
  });

  test("'/plan new UPPERCASE' rejects invalid slug", () => {
    const r = parseSlashCommand("/plan new UPPERCASE", baseCtx);
    expect(r!.response).toMatch(/Invalid slug/);
    expect(r!.sideEffect).toBeUndefined();
  });

  test("'/plan new my-feature' (with hyphen) is accepted", () => {
    const r = parseSlashCommand("/plan new my-feature", baseCtx);
    expect(r!.sideEffect).toEqual({
      kind: "create_plan",
      slug: "my-feature",
      template: null,
    });
  });

  test("'/plan new' falls back to currentSettings.defaultTemplate", () => {
    const ctx = ctxWith({
      currentSettings: { ...DEFAULT_PLAN_SETTINGS, defaultTemplate: "bug-investigation" },
    });
    const r = parseSlashCommand("/plan new foo", ctx);
    expect(r!.response).toMatch(/bug-investigation/);
    expect(r!.sideEffect).toEqual({
      kind: "create_plan",
      slug: "foo",
      template: null, // null in sideEffect; the template name in the response reflects the default
    });
  });
});

// ===========================================================================
// Group 3 — /plan list
// ===========================================================================

describe("parseSlashCommand — /plan list", () => {
  test("'/plan list' with no plans returns 'no plans found' message", () => {
    const r = parseSlashCommand("/plan list", baseCtx);
    expect(r!.sideEffect).toEqual({ kind: "list_plans" });
    expect(r!.response).toMatch(/No plans found/);
  });

  test("'/plan list' with available plans lists them", () => {
    const ctx = ctxWith({ availablePlanSlugs: ["alpha", "beta", "gamma"] });
    const r = parseSlashCommand("/plan list", ctx);
    expect(r!.sideEffect).toEqual({ kind: "list_plans" });
    expect(r!.response).toContain("alpha");
    expect(r!.response).toContain("beta");
    expect(r!.response).toContain("gamma");
    expect(r!.response).toContain("(3)");
  });

  test("'/plan ls' is accepted as alias for list", () => {
    const r = parseSlashCommand("/plan ls", baseCtx);
    expect(r!.sideEffect).toEqual({ kind: "list_plans" });
  });
});

// ===========================================================================
// Group 4 — /plan open
// ===========================================================================

describe("parseSlashCommand — /plan open", () => {
  test("'/plan open foo' returns the URL and updates lastUsedSlug", () => {
    const r = parseSlashCommand("/plan open foo", baseCtx);
    expect(r!.handled).toBe(true);
    expect(r!.sideEffect).toEqual({ kind: "open_plan_url", slug: "foo" });
    expect(r!.settingsPatch).toEqual({ lastUsedSlug: "foo" });
    expect(r!.response).toContain("http://localhost:4321/foo/");
  });

  test("'/plan open' (no slug) returns a usage message", () => {
    const r = parseSlashCommand("/plan open", baseCtx);
    expect(r!.response).toMatch(/Usage/);
    expect(r!.sideEffect).toBeUndefined();
  });

  test("'/plan open UPPERCASE' rejects invalid slug", () => {
    const r = parseSlashCommand("/plan open UPPERCASE", baseCtx);
    expect(r!.response).toMatch(/Invalid slug/);
    expect(r!.sideEffect).toBeUndefined();
  });

  test("'/plan open' respects custom defaultPort in context", () => {
    const ctx = ctxWith({ defaultPort: 5555 });
    const r = parseSlashCommand("/plan open foo", ctx);
    expect(r!.response).toContain("http://localhost:5555/foo/");
  });
});

// ===========================================================================
// Group 5 — /help / /commands
// ===========================================================================

describe("parseSlashCommand — /help", () => {
  test("'/help' returns the help text", () => {
    const r = parseSlashCommand("/help", baseCtx);
    expect(r!.handled).toBe(true);
    expect(r!.response).toMatch(/Available commands/);
    expect(r!.response).toMatch(/visual-plan/);
    expect(r!.response).toMatch(/plan new/);
  });

  test("'/commands' is an alias for /help", () => {
    const r = parseSlashCommand("/commands", baseCtx);
    expect(r!.response).toMatch(/Available commands/);
  });
});

// ===========================================================================
// Group 6 — non-slash messages return null
// ===========================================================================

describe("parseSlashCommand — non-slash messages", () => {
  test("regular text returns null", () => {
    expect(parseSlashCommand("hello world", baseCtx)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(parseSlashCommand("", baseCtx)).toBeNull();
  });

  test("whitespace-only returns null", () => {
    expect(parseSlashCommand("   \t\n  ", baseCtx)).toBeNull();
  });

  test("just a slash returns null", () => {
    expect(parseSlashCommand("/", baseCtx)).toBeNull();
  });

  test("just whitespace and a slash returns null", () => {
    expect(parseSlashCommand("  /  ", baseCtx)).toBeNull();
  });

  test("non-string input returns null", () => {
    expect(parseSlashCommand(null as never, baseCtx)).toBeNull();
    expect(parseSlashCommand(undefined as never, baseCtx)).toBeNull();
    expect(parseSlashCommand(42 as never, baseCtx)).toBeNull();
  });
});

// ===========================================================================
// Group 7 — unknown commands return error response (still handled)
// ===========================================================================

describe("parseSlashCommand — unknown commands", () => {
  test("'/unknown' returns error response (handled, not null)", () => {
    const r = parseSlashCommand("/unknown", baseCtx);
    expect(r).not.toBeNull();
    expect(r!.handled).toBe(true);
    expect(r!.response).toMatch(/Unknown command/);
    expect(r!.response).toContain("/unknown");
  });

  test("'/foo bar baz' returns error response", () => {
    const r = parseSlashCommand("/foo bar baz", baseCtx);
    expect(r!.response).toMatch(/Unknown command/);
  });

  test("'/plan delete' (unsupported in MVP) returns error response", () => {
    const r = parseSlashCommand("/plan delete foo", baseCtx);
    expect(r!.response).toMatch(/Unknown \/plan subcommand/);
  });
});

// ===========================================================================
// Group 8 — case-insensitivity
// ===========================================================================

describe("parseSlashCommand — case-insensitivity", () => {
  test("'/VISUAL-PLAN ON' (uppercase) is treated like '/visual-plan on'", () => {
    const r = parseSlashCommand("/VISUAL-PLAN ON", baseCtx);
    expect(r!.settingsPatch).toEqual({ visualPlanEnabled: true });
  });

  test("'/Help' (mixed case) is treated like '/help'", () => {
    const r = parseSlashCommand("/Help", baseCtx);
    expect(r!.response).toMatch(/Available commands/);
  });
});

// ===========================================================================
// Group 9 — /plan (no subcommand) shows usage
// ===========================================================================

describe("parseSlashCommand — /plan usage", () => {
  test("'/plan' (no subcommand) shows usage", () => {
    const r = parseSlashCommand("/plan", baseCtx);
    expect(r!.response).toMatch(/Plan commands:/);
    expect(r!.response).toMatch(/\/plan new/);
    expect(r!.response).toMatch(/\/plan list/);
  });
});