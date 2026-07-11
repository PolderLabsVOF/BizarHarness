/**
 * Tests for codemod intent detection (F-033).
 *
 * 5+ positive prompts per deterministic intent (var-to-const,
 * remove-console, add-logging) plus 5+ negatives that should NOT
 * be codemod-eligible (the caller falls through to the bandit).
 */

import { describe, test, expect } from "vitest";
import { detectCodemodIntent } from "../src/router/codemod-intent.js";

describe("detectCodemodIntent — var-to-const", () => {
  test("matches canonical phrasing", () => {
    const hit = detectCodemodIntent("convert var to const");
    expect(hit).not.toBeNull();
    expect(hit?.intent).toBe("var-to-const");
    expect(hit?.confidence).toBeGreaterThan(0);
  });

  test.each([
    "change var to const in this file",
    "replace var with const",
    "use const instead of var",
    "var to const for all declarations",
    "convert var declarations to const",
    "change var declarations to const everywhere",
  ])("matches var-to-const phrasing: %s", (prompt) => {
    const hit = detectCodemodIntent(prompt);
    expect(hit?.intent).toBe("var-to-const");
  });
});

describe("detectCodemodIntent — remove-console", () => {
  test.each([
    "remove console.log calls",
    "delete console statements",
    "strip console logs",
    "clean up console",
    "remove all debug logs",
    "remove console.log statements everywhere",
  ])("matches remove-console phrasing: %s", (prompt) => {
    const hit = detectCodemodIntent(prompt);
    expect(hit?.intent).toBe("remove-console");
  });
});

describe("detectCodemodIntent — add-logging", () => {
  test.each([
    "add logging to the handler",
    "add console.log statements",
    "add debug logs to the module",
    "log this function for diagnostics",
    "add trace logging",
    "instrument with logs",
  ])("matches add-logging phrasing: %s", (prompt) => {
    const hit = detectCodemodIntent(prompt);
    expect(hit?.intent).toBe("add-logging");
  });
});

describe("detectCodemodIntent — negatives", () => {
  test.each([
    "design a database schema for inventory",
    "implement OAuth2 PKCE flow with refresh-token rotation",
    "debug a memory leak in the cache",
    "explain what this function does",
    "refactor the http client to use async await",
    "add type annotations to the API",
    "wrap the parser in try/catch",
  ])("rejects non-codemod prompt: %s", (prompt) => {
    expect(detectCodemodIntent(prompt)).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(detectCodemodIntent("")).toBeNull();
  });

  test("returns null for non-string input", () => {
    expect(detectCodemodIntent(null)).toBeNull();
    expect(detectCodemodIntent(undefined)).toBeNull();
    expect(detectCodemodIntent(42)).toBeNull();
  });
});

describe("detectCodemodIntent — confidence ordering", () => {
  test("multi-match returns the highest-confidence intent", () => {
    const hit = detectCodemodIntent("convert var to const, replace var with const, change var declarations to const");
    expect(hit?.intent).toBe("var-to-const");
    expect(hit?.confidence).toBeGreaterThan(0.4);
  });
});
