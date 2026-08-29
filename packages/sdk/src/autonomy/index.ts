/**
 * autonomy/index.ts — Barrel re-exports for the autonomy contract (Phase B.1, F-194).
 *
 * Re-exports every typed schema + factory needed by callers (MCP server,
 * CLI, worker-suggest, evidence ledger, audit) so they can `import { ... }
 * from "@polderlabs/bizar/sdk/autonomy"` without caring about the internal
 * file layout.
 */

export {
  type ObjectiveRun,
  type ObjectiveRunPhase,
  type ObjectiveRunStatus,
  type ObjectiveRunConstraints,
  type AllowedSideEffect,
  type Budget,
  newObjectiveRunId,
  createObjectiveRun,
} from "./objective-run.js";

export {
  type EvidenceBundle,
  type TestCounts,
  type TestReport,
  type ResourceUsage,
  SHA256_HEX_LENGTH,
  assertSha256Hex,
  canonicalize,
  signBundle,
  verifyBundleSignature,
  sha256Hex,
  newBundleId,
  createEvidenceBundle,
} from "./evidence-bundle.js";

export {
  type OutcomeLearnerOutcome,
  type PosteriorUpdate,
  createOutcomeLearnerOutcome,
  bundleRefersTo,
} from "./outcome-record.js";
