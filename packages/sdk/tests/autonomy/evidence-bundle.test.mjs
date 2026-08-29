/**
 * autonomy/evidence-bundle.test.mjs — Phase B.1 (F-194) unit tests for
 * the typed EvidenceBundle schema + HMAC-SHA256 signature. Verifies:
 *   - SHA-256 helpers produce 64-char lowercase hex
 *   - `assertSha256Hex` rejects malformed digests
 *   - `canonicalize` is stable across key orderings
 *   - `signBundle` + `verifyBundleSignature` round-trip; tampering flips to false
 *   - `createEvidenceBundle` fills in bundleId + createdAt + signature
 *   - The factory rejects any non-hex SHA field
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  SHA256_HEX_LENGTH,
  assertSha256Hex,
  canonicalize,
  sha256Hex,
  signBundle,
  verifyBundleSignature,
  newBundleId,
  createEvidenceBundle,
} from "../../src/autonomy/evidence-bundle.js";

const zeroSha = sha256Hex("");
const abcSha = sha256Hex("abc");

function fixtureFields() {
  return {
    objectiveRunId: "00000000-0000-4000-8000-000000000001",
    command: "npm test",
    cwd: "/tmp/run",
    envDigest: zeroSha,
    exitCode: 0,
    stdoutSha256: abcSha,
    stderrSha256: zeroSha,
    testCounts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    testReports: [
      { framework: "node:test", suite: "smoke", reportSha256: abcSha, durationMs: 12 },
    ],
    baselineRevision: "deadbeef",
    resultingRevision: "feedface",
    patchSha256: zeroSha,
    lockfileSha256: zeroSha,
    evaluatorVersion: "v1",
    evaluatorSha256: abcSha,
    rubricSha256: abcSha,
    resourceUsage: {
      wallClockMs: 12,
      peakMemoryMb: 256,
      costUsdMicroCents: 123_456,
      tokens: { input: 10, output: 20, cached: 5 },
    },
  };
}

describe("evidence-bundle schema", () => {
  it("SHA256_HEX_LENGTH is 64 and sha256Hex returns 64-char lowercase hex", () => {
    assert.equal(SHA256_HEX_LENGTH, 64);
    assert.match(abcSha, /^[0-9a-f]{64}$/);
    // known vector
    assert.equal(abcSha, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("assertSha256Hex accepts hex and rejects malformed values", () => {
    assertSha256Hex("ok", abcSha);
    assert.throws(() => assertSha256Hex("bad", "DEADBEEF"), /64-character lowercase hex/);
    assert.throws(() => assertSha256Hex("bad", `${abcSha}G`), /64-character lowercase hex/);
    assert.throws(() => assertSha256Hex("bad", 42), /64-character lowercase hex/);
    assert.throws(() => assertSha256Hex("bad", null), /64-character lowercase hex/);
  });

  it("canonicalize is stable across key orderings", () => {
    const a = canonicalize({ foo: 1, bar: 2, baz: { x: 1, y: 2 } });
    const b = canonicalize({ baz: { y: 2, x: 1 }, bar: 2, foo: 1 });
    assert.equal(a, b);
    // sorted keys: JSON.stringify emits no spaces, so the keys appear in alpha order
    assert.match(a, /^\{"bar":2,"baz":\{"x":1,"y":2\},"foo":1\}$/);
  });

  it("signBundle + verifyBundleSignature round-trip", () => {
    const fields = fixtureFields();
    const secret = "super-secret";
    const signed = signBundle({ ...fields, bundleId: newBundleId(), createdAt: new Date().toISOString() }, secret);
    assert.equal(signed.signature.length, 64);
    assert.equal(verifyBundleSignature(signed, secret), true);
  });

  it("verifyBundleSignature returns false when the bundle is tampered with", () => {
    const fields = fixtureFields();
    const signed = signBundle({ ...fields, bundleId: newBundleId(), createdAt: new Date().toISOString() }, "s1");
    const tampered = { ...signed, exitCode: 1 };
    assert.equal(verifyBundleSignature(tampered, "s1"), false);
  });

  it("verifyBundleSignature returns false under the wrong secret", () => {
    const fields = fixtureFields();
    const signed = signBundle({ ...fields, bundleId: newBundleId(), createdAt: new Date().toISOString() }, "good");
    assert.equal(verifyBundleSignature(signed, "bad"), false);
  });

  it("signBundle rejects an empty secret", () => {
    assert.throws(() => signBundle(fixtureFields(), ""), /secret must be a non-empty string/);
  });

  it("createEvidenceBundle fills in bundleId + createdAt + signature and asserts every SHA field", () => {
    const secret = "k";
    const bundle = createEvidenceBundle(fixtureFields(), secret);
    assert.equal(typeof bundle.bundleId, "string");
    assert.match(bundle.bundleId, /^[0-9a-f-]{36}$/);
    assert.equal(typeof bundle.createdAt, "string");
    assert.equal(bundle.signature.length, 64);
    assert.equal(verifyBundleSignature(bundle, secret), true);
  });

  it("createEvidenceBundle rejects malformed SHA fields", () => {
    const base = fixtureFields();
    assert.throws(() => createEvidenceBundle({ ...base, envDigest: "nope" }, "k"), /envDigest/);
    assert.throws(() => createEvidenceBundle({ ...base, stdoutSha256: "nope" }, "k"), /stdoutSha256/);
    assert.throws(() => createEvidenceBundle({ ...base, stderrSha256: "nope" }, "k"), /stderrSha256/);
    assert.throws(() => createEvidenceBundle({ ...base, patchSha256: "nope" }, "k"), /patchSha256/);
    assert.throws(() => createEvidenceBundle({ ...base, lockfileSha256: "nope" }, "k"), /lockfileSha256/);
    assert.throws(() => createEvidenceBundle({ ...base, evaluatorSha256: "nope" }, "k"), /evaluatorSha256/);
    assert.throws(() => createEvidenceBundle({ ...base, rubricSha256: "nope" }, "k"), /rubricSha256/);
  });
});
