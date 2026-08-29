/**
 * SLSA v0.2 provenance attestation builder (audit #83, milestone 4).
 *
 * Output is the `intoto.jsonl` line layout — one JSON object per line.
 * Each line carries:
 *
 *   _type           "https://in-toto.io/Statement/v0.1"
 *   predicateType   "https://slsa.dev/provenance/v0.2"
 *   subject[]       [{ name, digest.sha256 }]
 *   predicate       { builder, buildType, invocation, materials }
 *
 * The predicate is a minimal SLSA v0.2 shape — the builder is the
 * release machine, the buildType is a custom URI
 * `https://polderlabs.dev/bizar/release@v1`, the invocation is the
 * command that produced the artifact, and materials is the source
 * git commit (and optionally a tarball the builder took as input).
 *
 * The attestation is plain JSON; signing happens separately (the
 * `bizar release-provenance` CLI shells out to `minisign` for the
 * detached signature). `bizar verify-release` then verifies the
 * detached signature against the pinned pubkey in
 * `KNOWN_GOOD_RELEASES`.
 */

export interface ProvenanceSubject {
  readonly name: string;
  readonly digest: { readonly sha256: string };
}

export interface ProvenanceInvocation {
  /** The command line that produced the artifact (no shell expansion). */
  readonly command: ReadonlyArray<string>;
  /** Environment variables captured at build time (subset, never secrets). */
  readonly env: Readonly<Record<string, string>>;
}

export interface ProvenanceMaterial {
  readonly uri: string;
  readonly digest: { readonly sha256: string };
}

export interface ProvenancePredicate {
  readonly builder: { readonly id: string };
  readonly buildType: string;
  readonly invocation: ProvenanceInvocation;
  readonly materials: ReadonlyArray<ProvenanceMaterial>;
}

export interface ProvenanceStatement {
  readonly _type: "https://in-toto.io/Statement/v0.1";
  readonly predicateType: "https://slsa.dev/provenance/v0.2";
  readonly subject: ReadonlyArray<ProvenanceSubject>;
  readonly predicate: ProvenancePredicate;
}

export interface ProvenanceInput {
  /** The artifact name (e.g. "polderlabs-bizar-10.18.0.tgz"). */
  readonly artifactName: string;
  /** sha256 of the artifact. */
  readonly artifactSha256: string;
  /** The version being released. */
  readonly version: string;
  /** The git sha the artifact was built from. */
  readonly gitSha: string;
  /** Optional commit timestamp (ISO 8601). */
  readonly gitCommitTs?: string;
  /** Optional builder id (e.g. `release-machine-001`). */
  readonly builderId?: string;
  /** Optional command line that produced the artifact. */
  readonly command?: ReadonlyArray<string>;
  /** Optional env subset. NEVER include secrets. */
  readonly env?: Readonly<Record<string, string>>;
  /** Optional tarball/material digest (for "this tarball was built from that source"). */
  readonly materialSha256?: string;
  /** Optional material uri (e.g. `git+https://github.com/DrB0rk/BizarHarness@${gitSha}`). */
  readonly materialUri?: string;
}

export const BIZAR_BUILDER_ID = "https://polderlabs.dev/bizar/release@v1";
export const BIZAR_BUILD_TYPE = "https://polderlabs.dev/bizar/release@v1";

/** Build a SLSA v0.2 provenance statement. */
export function buildProvenanceAttestation(input: ProvenanceInput): ProvenanceStatement {
  const builderId = input.builderId ?? BIZAR_BUILDER_ID;
  const materialUri = input.materialUri ?? `git+https://github.com/DrB0rk/BizarHarness@${input.gitSha}`;
  const materials: ProvenanceMaterial[] = [
    {
      uri: materialUri,
      digest: { sha256: input.gitSha },
    },
  ];
  if (input.materialSha256) {
    materials.push({
      uri: `pkg:npm/@polderlabs/bizar@${input.version}-source`,
      digest: { sha256: input.materialSha256 },
    });
  }

  return {
    _type: "https://in-toto.io/Statement/v0.1",
    predicateType: "https://slsa.dev/provenance/v0.2",
    subject: [
      {
        name: input.artifactName,
        digest: { sha256: input.artifactSha256 },
      },
    ],
    predicate: {
      builder: { id: builderId },
      buildType: BIZAR_BUILD_TYPE,
      invocation: {
        command: input.command ?? [`bizar release-provenance --version ${input.version}`],
        env: input.env ?? { BIZAR_VERSION: input.version },
      },
      materials,
    },
  };
}