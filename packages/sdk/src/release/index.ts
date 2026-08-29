/**
 * Release provenance surface (audit #83, milestone 4).
 *
 * Public exports:
 *
 *   - buildSbom / Sbom              — CycloneDX 1.5 SBOM builder
 *   - buildProvenanceAttestation    — SLSA v0.2 intoto statement
 *   - parseMinisign / verifyMinisign — pure-JS minisign parser + verifier
 *   - signWithEd25519               — operator-side pure-JS signing helper
 *   - KNOWN_GOOD_RELEASES / lookupKnownGoodRelease / listKnownGoodVersions — allowlist
 *   - verifyRelease                 — full release artifact verification entry point
 *
 * Stable API contract. Breaking changes require a major SDK version
 * bump and a corresponding `KNOWN_GOOD_RELEASES` migration note.
 */

export { buildSbom, type Sbom, type SbomComponent, type SbomInput } from "./sbom.js";
export {
  buildProvenanceAttestation,
  BIZAR_BUILDER_ID,
  BIZAR_BUILD_TYPE,
  type ProvenanceStatement,
  type ProvenanceInput,
} from "./provenance.js";
export {
  parseMinisign,
  signWithEd25519,
  verifyMinisign,
  type MinisignSignature,
  type SignatureVerificationResult,
} from "./signature.js";
export {
  KNOWN_GOOD_RELEASES,
  CURRENT_RELEASE_KEY_ID,
  lookupKnownGoodRelease,
  listKnownGoodVersions,
  verifyRelease,
  type KnownGoodRelease,
  type VerifyReleaseInput,
  type VerifyReleaseResult,
} from "./known-good-releases.js";