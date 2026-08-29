/**
 * KNOWN_GOOD_RELEASES — release allowlist (audit #83, milestone 4).
 *
 * The single source of truth that `bizar verify-release` consults
 * before applying a tarball. Each entry pins:
 *
 *   - `version`         The npm tag this release was published under
 *   - `tarballSha256`   sha256 of the published npm tarball
 *   - `sbomSha256`      sha256 of the CycloneDX SBOM
 *   - `provenanceSha256` sha256 of the SLSA provenance attestation
 *   - `gitSha`          The commit the release was cut from
 *   - `minisignKeyId`   The 8-byte ed25519 key id that signed the artifact
 *   - `publicKeyPem`    The pinned ed25519 SPKI PEM (verification key)
 *   - `releasedAt`      ISO 8601 timestamp the entry was merged
 *
 * To add a new release:
 *   1. Build the tarball + SBOM + provenance attestation.
 *   2. Sign with minisign (`bizar release-provenance --version X`).
 *   3. Compute the sha256 of all three artifacts.
 *   4. Append a new entry below.
 *
 * Releases are immutable — never edit an existing entry. To revoke
 * a release, add a `revokedAt` field in a separate patch and make
 * the verify path check it.
 */

import { createHash } from "node:crypto";
import type { ProvenanceStatement } from "./provenance.js";
import { parseMinisign, verifyMinisign, type SignatureVerificationResult } from "./signature.js";

export interface KnownGoodRelease {
  readonly version: string;
  readonly tarballSha256: string;
  readonly sbomSha256: string;
  readonly provenanceSha256: string;
  readonly gitSha: string;
  readonly minisignKeyId: string;
  readonly publicKeyPem: string;
  readonly releasedAt: string;
  readonly revokedAt?: string;
}

/**
 * The 10.18.0 entry. This is the bootstrap pin — a future release
 * adds the next entry below it.
 *
 * The publicKeyPem below is the Bizar release signing key. The
 * private key is held by the release operator. Rotate by adding a
 * new key id and updating `CURRENT_RELEASE_KEY_ID`.
 */
const BIZAR_RELEASE_PUBKEY_10_18_0 =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ4w7lshhHQmbY0ROk5Yghz9KqEc=\n" +
  "-----END PUBLIC KEY-----\n";

/**
 * The single current release key id. Future releases with a
 * rotated key add a new entry and update this constant.
 */
export const CURRENT_RELEASE_KEY_ID = "b1zar0a8300";

/**
 * The pinned allowlist. New releases append at the bottom. Never
 * delete or mutate an entry — `KNOWN_GOOD_RELEASES` is append-only.
 */
export const KNOWN_GOOD_RELEASES: ReadonlyArray<KnownGoodRelease> = Object.freeze([
  {
    version: "10.18.0",
    // Pinned at the 10.18.0 mega-release rollup commit
    // (1c2cdfe chore(release): bump to v10.18.0 (mega-release rollup)).
    // The sha256 below is the placeholder used at this audit
    // milestone — operators rotate it by appending a new entry
    // once the real tarball sha is published.
    tarballSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    sbomSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    provenanceSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    gitSha: "1c2cdfe",
    minisignKeyId: CURRENT_RELEASE_KEY_ID,
    publicKeyPem: BIZAR_RELEASE_PUBKEY_10_18_0,
    releasedAt: "2026-08-26T00:00:00.000Z",
  },
]);

/** Look up a pinned release by version. Returns null if unknown. */
export function lookupKnownGoodRelease(version: string): KnownGoodRelease | null {
  return KNOWN_GOOD_RELEASES.find((r) => r.version === version) ?? null;
}

/** All pinned versions, newest-first. */
export function listKnownGoodVersions(): ReadonlyArray<string> {
  return [...KNOWN_GOOD_RELEASES]
    .sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0))
    .map((r) => r.version);
}

// ── Verification entry points ─────────────────────────────────────────────────

export type VerifyReleaseOk = {
  readonly ok: true;
  readonly version: string;
  readonly gitSha: string;
  readonly minisignKeyId: string;
};

export type VerifyReleaseFail = {
  readonly ok: false;
  readonly reason:
    | "UNKNOWN_RELEASE"
    | "TARBALL_HASH_MISMATCH"
    | "SBOM_HASH_MISMATCH"
    | "PROVENANCE_HASH_MISMATCH"
    | "RELEASE_REVOKED"
    | "SIGNATURE_INVALID";
  readonly detail?: string;
};

export type VerifyReleaseResult = VerifyReleaseOk | VerifyReleaseFail;

export interface VerifyReleaseInput {
  /** The version being verified (e.g. "10.18.0"). */
  readonly version: string;
  /** Raw tarball bytes. */
  readonly tarballBytes: Buffer;
  /** Raw SBOM JSON string. */
  readonly sbomJson: string;
  /** Raw provenance attestation JSONL string. */
  readonly provenanceJsonl: string;
  /** Raw minisig signature text. */
  readonly minisigText: string;
}

/**
 * Verify a release artifact set against the KNOWN_GOOD_RELEASES
 * allowlist. The function is pure and side-effect-free so it can
 * be called from `bizar verify-release`, `bizar update`, or any
 * post-install hook.
 *
 * Order of checks:
 *   1. Version is in the allowlist (UNKNOWN_RELEASE otherwise).
 *   2. Release is not revoked (RELEASE_REVOKED otherwise).
 *   3. Tarball sha256 matches the pin (TARBALL_HASH_MISMATCH otherwise).
 *   4. SBOM sha256 matches the pin (SBOM_HASH_MISMATCH otherwise).
 *   5. Provenance attestation sha256 matches (PROVENANCE_HASH_MISMATCH).
 *   6. Provenance attestation's subject digest matches the tarball
 *      sha256 (defense-in-depth: the SBOM and tarball must agree).
 *   7. Provenance attestation's material digest matches the pinned
 *      git sha (PROVENANCE_HASH_MISMATCH otherwise).
 *   8. Minisig signature verifies against the pinned public key.
 *
 * The function returns at the FIRST failure. The `detail` field
 * contains a human-readable explanation suitable for an operator
 * `bizar install` failure log.
 */
export function verifyRelease(input: VerifyReleaseInput): VerifyReleaseResult {
  const pinned = lookupKnownGoodRelease(input.version);
  if (!pinned) {
    return {
      ok: false,
      reason: "UNKNOWN_RELEASE",
      detail: `version ${input.version} is not in KNOWN_GOOD_RELEASES (known: ${listKnownGoodVersions().join(", ")})`,
    };
  }
  if (pinned.revokedAt) {
    return {
      ok: false,
      reason: "RELEASE_REVOKED",
      detail: `version ${input.version} was revoked at ${pinned.revokedAt}`,
    };
  }

  const tarballHash = sha256Hex(input.tarballBytes);
  if (tarballHash !== pinned.tarballSha256) {
    return {
      ok: false,
      reason: "TARBALL_HASH_MISMATCH",
      detail: `expected ${pinned.tarballSha256}, got ${tarballHash}`,
    };
  }

  const sbomHash = sha256Hex(Buffer.from(input.sbomJson, "utf8"));
  if (sbomHash !== pinned.sbomSha256) {
    return {
      ok: false,
      reason: "SBOM_HASH_MISMATCH",
      detail: `expected ${pinned.sbomSha256}, got ${sbomHash}`,
    };
  }

  const provHash = sha256Hex(Buffer.from(input.provenanceJsonl, "utf8"));
  if (provHash !== pinned.provenanceSha256) {
    return {
      ok: false,
      reason: "PROVENANCE_HASH_MISMATCH",
      detail: `expected ${pinned.provenanceSha256}, got ${provHash}`,
    };
  }

  // Parse the attestation JSONL — one statement per line.
  const provLines = input.provenanceJsonl
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (provLines.length === 0) {
    return { ok: false, reason: "SIGNATURE_INVALID", detail: "provenance attestation is empty" };
  }
  let statement: ProvenanceStatement;
  try {
    statement = JSON.parse(provLines[0]) as ProvenanceStatement;
  } catch (err) {
    return {
      ok: false,
      reason: "SIGNATURE_INVALID",
      detail: `provenance attestation is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const subject = statement.subject?.[0];
  if (!subject || subject.digest.sha256 !== tarballHash) {
    return {
      ok: false,
      reason: "PROVENANCE_HASH_MISMATCH",
      detail: `provenance subject digest ${subject?.digest.sha256 ?? "<missing>"} does not match tarball sha256 ${tarballHash}`,
    };
  }
  const material = statement.predicate?.materials?.[0];
  if (!material || material.digest.sha256 !== pinned.gitSha) {
    return {
      ok: false,
      reason: "PROVENANCE_HASH_MISMATCH",
      detail: `provenance material digest ${material?.digest.sha256 ?? "<missing>"} does not match pinned git sha ${pinned.gitSha}`,
    };
  }

  // Signature verification — pure JS so we don't depend on `minisign`.
  const sig = parseMinisign(input.minisigText);
  if (!("keyId" in sig)) {
    return { ok: false, reason: "SIGNATURE_INVALID", detail: sig.reason };
  }
  if (sig.keyId !== pinned.minisignKeyId) {
    return {
      ok: false,
      reason: "SIGNATURE_INVALID",
      detail: `signature key id ${sig.keyId} does not match pinned ${pinned.minisignKeyId}`,
    };
  }
  const sigResult: SignatureVerificationResult = verifyMinisign(input.tarballBytes, sig, pinned.publicKeyPem);
  if (!sigResult.ok) {
    return { ok: false, reason: "SIGNATURE_INVALID", detail: `${sigResult.reason}: ${sigResult.detail ?? ""}` };
  }

  return {
    ok: true,
    version: pinned.version,
    gitSha: pinned.gitSha,
    minisignKeyId: sig.keyId,
  };
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Convenience: re-export the attestation builder so callers do not need two imports. */
export { buildProvenanceAttestation } from "./provenance.js";
export type { ProvenanceStatement, ProvenanceSubject, ProvenancePredicate } from "./provenance.js";