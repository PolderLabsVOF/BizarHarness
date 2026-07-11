/**
 * federation/budget.test.ts — F-038 FederationBudget tests.
 *
 * Covers:
 *   - reserve/commit/release state machine.
 *   - setLimits overrides per-peer limits.
 *   - getOrCreate lazily creates peer records.
 *   - validateBudgetInput rejects invalid inputs.
 *   - Persistence: saveToDisk + loadFromDisk round-trip.
 *   - outstanding() tracks un-released reservations.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BUDGET_PATH,
  FederationBudget,
  MAX_TOKENS_CEILING,
  MAX_USD_CEILING,
  validateBudgetInput,
} from "../../src/federation/budget.js";

describe("federation/budget — validateBudgetInput", () => {
  test("accepts null → defaults", () => {
    const r = validateBudgetInput(null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.maxHops).toBe(8);
      expect(r.maxTokens).toBe(MAX_TOKENS_CEILING);
      expect(r.maxUsd).toBe(MAX_USD_CEILING);
    }
  });

  test("accepts a fully-specified budget", () => {
    const r = validateBudgetInput({ maxTokens: 1000, maxUsd: 0.5, maxHops: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.maxTokens).toBe(1000);
      expect(r.maxUsd).toBe(0.5);
      expect(r.maxHops).toBe(4);
    }
  });

  test("rejects non-object inputs", () => {
    expect(validateBudgetInput(42).ok).toBe(false);
    expect(validateBudgetInput("foo").ok).toBe(false);
    expect(validateBudgetInput([]).ok).toBe(false);
  });

  test("rejects maxHops out of range", () => {
    expect(validateBudgetInput({ maxHops: 100 }).ok).toBe(false);
    expect(validateBudgetInput({ maxHops: -1 }).ok).toBe(false);
  });

  test("rejects maxUsd out of range", () => {
    expect(validateBudgetInput({ maxUsd: -1 }).ok).toBe(false);
    expect(validateBudgetInput({ maxUsd: MAX_USD_CEILING + 1 }).ok).toBe(false);
  });

  test("rejects maxTokens out of range", () => {
    expect(validateBudgetInput({ maxTokens: -1 }).ok).toBe(false);
    expect(validateBudgetInput({ maxTokens: MAX_TOKENS_CEILING + 1 }).ok).toBe(false);
  });
});

describe("federation/budget — FederationBudget lifecycle", () => {
  let dir: string;
  let path: string;
  let budget: FederationBudget;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bizar-budget-"));
    path = join(dir, "federation-budget.json");
    budget = new FederationBudget({
      path,
      defaultMaxTokens: 10_000,
      defaultMaxUsd: 5,
      defaultMaxHops: 8,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("getOrCreate lazily creates a peer", () => {
    const peer = budget.getOrCreate("node-A");
    expect(peer.nodeId).toBe("node-A");
    expect(peer.maxTokens).toBe(10_000);
    expect(peer.maxUsd).toBe(5);
    expect(peer.spentTokens).toBe(0);
  });

  test("reserve + commit round-trip debits spent then refunds the diff", () => {
    const r = budget.reserve("node-A", 100, 0.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let peer = budget.getOrCreate("node-A");
    expect(peer.spentTokens).toBe(100);
    expect(peer.spentUsd).toBe(0.5);
    // Commit reports actual was lower than reserved.
    const ok = budget.commit(r.reservationId, { tokens: 60, usd: 0.2 });
    expect(ok).toBe(true);
    peer = budget.getOrCreate("node-A");
    expect(peer.spentTokens).toBe(60);
    expect(peer.spentUsd).toBe(0.2);
  });

  test("reserve + release round-trip refunds full reservation", () => {
    const r = budget.reserve("node-A", 100, 0.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    budget.release(r.reservationId);
    const peer = budget.getOrCreate("node-A");
    expect(peer.spentTokens).toBe(0);
    expect(peer.spentUsd).toBe(0);
  });

  test("reserve over budget denies", () => {
    budget.setLimits("node-A", { maxTokens: 50, maxUsd: 1 });
    const r = budget.reserve("node-A", 100, 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("peer_over_budget");
  });

  test("reserve with invalid amount denies", () => {
    const r = budget.reserve("node-A", Number.NaN, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_amount");

    const r2 = budget.reserve("node-A", -1, 0);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("invalid_amount");
  });

  test("outstanding() tracks un-released reservations", () => {
    const r = budget.reserve("node-A", 10, 0.1);
    expect(budget.outstanding().length).toBe(1);
    if (r.ok) budget.commit(r.reservationId);
    expect(budget.outstanding().length).toBe(0);
  });

  test("commit unknown reservation returns false", () => {
    expect(budget.commit("not-a-real-id")).toBe(false);
    expect(budget.release("not-a-real-id")).toBe(false);
  });

  test("saveToDisk + loadFromDisk round-trip", () => {
    budget.setLimits("node-A", { maxTokens: 999, maxUsd: 0.99, maxHops: 4 });
    expect(existsSync(path)).toBe(true);
    const fresh = new FederationBudget({ path });
    const peer = fresh.getOrCreate("node-A");
    expect(peer.maxTokens).toBe(999);
    expect(peer.maxUsd).toBe(0.99);
    expect(peer.maxHops).toBe(4);
  });

  test("snapshot returns every per-peer budget", () => {
    budget.getOrCreate("node-A");
    budget.getOrCreate("node-B");
    const snap = budget.snapshot();
    expect(snap.length).toBe(2);
    expect(new Set(snap.map((p) => p.nodeId))).toEqual(new Set(["node-A", "node-B"]));
  });

  test("toJSON returns the documented shape", () => {
    budget.setLimits("node-A", { maxTokens: 100, maxUsd: 0.5, maxHops: 2 });
    const json = budget.toJSON();
    expect(json.version).toBe(1);
    expect(json.perPeer.length).toBe(1);
    expect(json.perPeer[0].nodeId).toBe("node-A");
    expect(typeof json.updatedAt).toBe("string");
  });

  test("DEFAULT_BUDGET_PATH is the harness-local path", () => {
    expect(DEFAULT_BUDGET_PATH).toBe(".harness/federation-budget.json");
  });

  test("loadFromDisk is tolerant of malformed JSON", () => {
    // Write garbage, then construct a new instance — it should
    // not throw.
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "not json", "utf-8");
    const fresh = new FederationBudget({ path });
    expect(fresh.getOrCreate("node-A").maxTokens).toBe(MAX_TOKENS_CEILING);
  });
});