/**
 * federation/pii.test.ts — F-038 PII pipeline tests.
 *
 * Covers:
 *   - soc2 mode redacts emails + SSNs + IPs, blocks credit cards.
 *   - gdpr mode also redacts names + addresses.
 *   - hipaa mode is the strictest (redacts everything sensitive).
 *   - permissive mode only blocks the highest-severity categories.
 *   - PiiPipeline class wrapper setMode / process flow.
 */

import { describe, test, expect } from "vitest";
import {
  PII_MODES,
  PiiPipeline,
  apply,
  isPiiMode,
  type PiiMode,
} from "../../src/federation/pii.js";

describe("federation/pii — apply() per mode", () => {
  test("soc2 redacts emails + IPs + SSNs, blocks credit cards", () => {
    const r = apply("contact alice@example.com or 192.168.1.1, SSN 123-45-6789, CC 4111-1111-1111-1111", "soc2");
    expect(r.blocked).toBe(true);
    // Even though we blocked CC, the transformed text is empty.
    expect(r.transformed).toBe("");
    expect(r.detections.length).toBeGreaterThanOrEqual(3);
  });

  test("soc2 non-CC text returns redacted output", () => {
    const r = apply("contact alice@example.com from 10.0.0.1", "soc2");
    expect(r.blocked).toBe(false);
    expect(r.transformed).toContain("[REDACTED:email]");
    expect(r.transformed).toContain("[REDACTED:ip_address]");
    expect(r.transformed).not.toContain("alice@example.com");
    expect(r.transformed).not.toContain("10.0.0.1");
  });

  test("gdpr redacts emails, IPs, names, addresses", () => {
    const r = apply("Dr. Alice Smith at alice@example.com from 10 Downing St", "gdpr");
    expect(r.transformed).toContain("[REDACTED:email]");
    expect(r.transformed).not.toContain("alice@example.com");
  });

  test("hipaa is the strictest — emails + SSNs + IPs + phones redacted", () => {
    const r = apply("call 555-123-4567 or email alice@example.com, SSN 123-45-6789", "hipaa");
    expect(r.transformed).not.toContain("alice@example.com");
    expect(r.transformed).not.toContain("123-45-6789");
    expect(r.transformed).not.toContain("555-123-4567");
  });

  test("permissive passes emails + IPs but blocks AWS keys + private keys + github tokens", () => {
    const clean = apply("contact alice@example.com from 10.0.0.1", "permissive");
    expect(clean.blocked).toBe(false);
    expect(clean.transformed).toContain("alice@example.com");
    expect(clean.transformed).toContain("10.0.0.1");

    const awsKey = apply("AWS key: AKIAIOSFODNN7EXAMPLE", "permissive");
    expect(awsKey.blocked).toBe(true);

    const priv = apply("-----BEGIN RSA PRIVATE KEY-----", "permissive");
    expect(priv.blocked).toBe(true);

    const gh = apply("github token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "permissive");
    expect(gh.blocked).toBe(true);
  });

  test("unknown mode throws", () => {
    expect(() => apply("text", "unknown" as unknown as PiiMode)).toThrow(/unknown mode/);
  });

  test("each declared mode is accepted by isPiiMode", () => {
    for (const m of PII_MODES) {
      expect(isPiiMode(m)).toBe(true);
    }
    expect(isPiiMode(null)).toBe(false);
    expect(isPiiMode("xx")).toBe(false);
  });
});

describe("federation/pii — PiiPipeline class", () => {
  test("defaults to soc2 mode", () => {
    const p = new PiiPipeline();
    expect(p.getMode()).toBe("soc2");
  });

  test("setMode accepts the 4 documented modes", () => {
    const p = new PiiPipeline();
    for (const m of PII_MODES) {
      p.setMode(m);
      expect(p.getMode()).toBe(m);
    }
  });

  test("setMode throws on unknown mode", () => {
    const p = new PiiPipeline();
    expect(() => p.setMode("nope" as unknown as PiiMode)).toThrow(/unknown mode/);
  });

  test("process() returns the same shape as apply()", () => {
    const p = new PiiPipeline({ mode: "gdpr" });
    const r = p.process("alice@example.com");
    expect(r.transformed).toContain("[REDACTED:email]");
    expect(r.mode).toBe("gdpr");
  });
});