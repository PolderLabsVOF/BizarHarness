/**
 * autonomy/evidence-bundle.ts — Typed EvidenceBundle (Phase B.1, F-194).
 *
 * An `EvidenceBundle` is the typed observation that fills in an
 * `ObjectiveRun`. It captures the command that ran, the working
 * directory, the env digest, the exit code, the SHA-256 of the stdout
 * and stderr streams, the test counts and reports, the git revisions
 * before and after, the patch and lockfile hashes, the evaluator +
 * rubric SHA-256s, and the resource usage.
 *
 * The bundle is signed with `signBundle` and verified with
 * `verifyBundleSignature`. The signature is computed over the
 * canonicalized JSON of all non-signature fields so a third party can
 * replay it offline and confirm no field was tampered with after the
 * fact.
 *
 * Invariants:
 *   - Every SHA-256 field is a 64-character lowercase hex string.
 *   - `bundleId` is server-stamped via `randomUUID()`.
 *   - `signature` is computed via `signBundle`; the signature input
 *     is the JSON.stringify of the bundle with the signature field
 *     stripped, re-parsed, and the keys sorted.
 *   - `verifyBundleSignature` MUST return `true` for any bundle
 *     produced by `signBundle` and `false` for any tampered bundle.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Schema version of `EvidenceBundle` (audit #84, P2 spec-sprawl reduction).
 * Bump on ANY breaking change to the schema (new required field, removed
 * field, or semantic change). Additive changes (new optional field) bump
 * the minor version.
 */
export const EVIDENCE_BUNDLE_SCHEMA_VERSION = "1.0.0";

/** Test-count summary embedded in an evidence bundle. */
export interface TestCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** Test report metadata for a single test framework invocation. */
export interface TestReport {
  /** Framework identifier (e.g. `node:test`, `vitest`). */
  readonly framework: string;
  /** Suite name or path the report belongs to. */
  readonly suite: string;
  /** SHA-256 of the full report file (hex). */
  readonly reportSha256: string;
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;
}

/** Resource-usage sample attached to an evidence bundle. */
export interface ResourceUsage {
  readonly wallClockMs: number;
  readonly peakMemoryMb: number;
  /** USD cost in micro-cents (1 USD = 1_000_000 uSD). */
  readonly costUsdMicroCents: number;
  /** Token usage breakdown by role. */
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cached?: number;
  };
}

/** The typed observation that fills in an `ObjectiveRun`. */
export interface EvidenceBundle {
  readonly bundleId: string;
  /** Run this bundle belongs to. */
  readonly objectiveRunId: string;
  /** Optional parent run id if this bundle nests under another run. */
  readonly runId?: string;
  /** Absolute path to the command run. */
  readonly command: string;
  /** Working directory of the command. */
  readonly cwd: string;
  /** SHA-256 of the canonicalized env vars present at run time. */
  readonly envDigest: string;
  /** Exit code of the command (negative if killed by signal). */
  readonly exitCode: number;
  /** SHA-256 of the captured stdout (hex). */
  readonly stdoutSha256: string;
  /** SHA-256 of the captured stderr (hex). */
  readonly stderrSha256: string;
  /** Aggregate test counts for the run. */
  readonly testCounts: TestCounts;
  /** Per-framework test reports. */
  readonly testReports: ReadonlyArray<TestReport>;
  /** Git revision at the start of the run. */
  readonly baselineRevision: string;
  /** Git revision at the end of the run. */
  readonly resultingRevision: string;
  /** SHA-256 of the patch produced by the run (hex). */
  readonly patchSha256: string;
  /** SHA-256 of the lockfile at the end of the run (hex). */
  readonly lockfileSha256: string;
  /** Version string of the evaluator that produced this bundle. */
  readonly evaluatorVersion: string;
  /** SHA-256 of the evaluator binary or container image (hex). */
  readonly evaluatorSha256: string;
  /** SHA-256 of the rubric that scored this run (hex). */
  readonly rubricSha256: string;
  /** Resource usage sample. */
  readonly resourceUsage: ResourceUsage;
  /** HMAC-SHA256 signature over the canonical JSON of all other fields. */
  readonly signature: string;
  /** Server-stamped ISO 8601 timestamp. */
  readonly createdAt: string;
  /** Schema version that produced this record (audit #84). */
  readonly schemaVersion: string;
}

/** Length in characters of a SHA-256 hex digest. */
export const SHA256_HEX_LENGTH = 64;

/** Assert a value is a 64-char lowercase hex SHA-256 string. */
export function assertSha256Hex(field: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length !== SHA256_HEX_LENGTH || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a 64-character lowercase hex SHA-256 string; got ${typeof value === "string" ? `len=${value.length}` : typeof value}`);
  }
}

/** Compute a deterministic signature payload from the bundle minus the signature field. */
export function canonicalize(bundle: Omit<EvidenceBundle, "signature">): string {
  return JSON.stringify(deepSortKeys(bundle));
}

/** Recursively sort object keys so the JSON form is input-order independent. */
function deepSortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => deepSortKeys(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = deepSortKeys(src[key]);
    }
    return out as T;
  }
  return value;
}

/** Sign a bundle with the supplied secret and return the signed bundle. */
export function signBundle(
  bundle: Omit<EvidenceBundle, "signature">,
  secret: string,
): EvidenceBundle {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("signBundle: secret must be a non-empty string");
  }
  const signature = createHmac("sha256", secret).update(canonicalize(bundle)).digest("hex");
  return { ...bundle, signature };
}

/** Verify the signature on a bundle. Returns true iff the HMAC matches. */
export function verifyBundleSignature(bundle: EvidenceBundle, secret: string): boolean {
  const { signature, ...rest } = bundle;
  const expected = createHmac("sha256", secret).update(canonicalize(rest)).digest("hex");
  return signature === expected;
}

/** SHA-256 a buffer or string and return the lowercase hex digest. */
export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Generate a new server-stamped `bundleId`. */
export function newBundleId(): string {
  return randomUUID();
}

/** Convenience constructor that fills in server-stamped ids + timestamp + signature. */
export function createEvidenceBundle(
  fields: Omit<EvidenceBundle, "bundleId" | "signature" | "createdAt" | "schemaVersion">,
  secret: string,
): EvidenceBundle {
  assertSha256Hex("envDigest", fields.envDigest);
  assertSha256Hex("stdoutSha256", fields.stdoutSha256);
  assertSha256Hex("stderrSha256", fields.stderrSha256);
  assertSha256Hex("patchSha256", fields.patchSha256);
  assertSha256Hex("lockfileSha256", fields.lockfileSha256);
  assertSha256Hex("evaluatorSha256", fields.evaluatorSha256);
  assertSha256Hex("rubricSha256", fields.rubricSha256);
  const base = {
    ...fields,
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    bundleId: newBundleId(),
    createdAt: new Date().toISOString(),
  };
  return signBundle(base, secret);
}
