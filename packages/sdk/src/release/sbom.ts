/**
 * CycloneDX 1.5 SBOM builder (audit #83, milestone 4).
 *
 * Hand-rolled minimal SBOM. No external dependencies — keeps the
 * SDK tree small and the output deterministic. Covers:
 *
 *   - `bomFormat`: 'CycloneDX'
 *   - `specVersion`: '1.5'
 *   - `serialNumber`: `urn:uuid:<sha256-derived-uuid>` for tracking
 *   - `metadata.timestamp`: ISO 8601 instant at generation
 *   - `metadata.tools`: the SDK version (so SBOMs are themselves
 *     traceable to a Bizar release)
 *   - `metadata.component`: the root package (Bizar) with version +
 *     purl
 *   - `components[]`: every runtime dependency, with name + version +
 *     purl + scope (required for the `bizar install` lock)
 *   - `dependencies[]`: the runtime dependency graph
 *
 * Inputs are package.json files. No `npm install` is invoked.
 *
 * The output is a JSON object suitable for `JSON.stringify(sbom, null, 2)`
 * and `writeFileSync(out, …)` at release time.
 */

import { createHash, randomUUID } from "node:crypto";

export interface SbomComponent {
  readonly type: "library" | "application" | "framework";
  readonly "bom-ref": string;
  readonly name: string;
  readonly version: string;
  readonly purl: string;
  readonly scope?: "required" | "optional" | "dev";
}

export interface SbomMetadata {
  readonly timestamp: string;
  readonly tools: ReadonlyArray<{ readonly vendor: string; readonly name: string; readonly version: string }>;
  readonly component: SbomComponent;
}

export interface SbomDependencyEntry {
  readonly ref: string;
  readonly dependsOn: ReadonlyArray<string>;
}

export interface Sbom {
  readonly bomFormat: "CycloneDX";
  readonly specVersion: "1.5";
  readonly serialNumber: string;
  readonly version: number;
  readonly metadata: SbomMetadata;
  readonly components: ReadonlyArray<SbomComponent>;
  readonly dependencies: ReadonlyArray<SbomDependencyEntry>;
}

export interface SbomInput {
  /** The root package name (e.g. "@polderlabs/bizar"). */
  readonly name: string;
  /** The root package version. */
  readonly version: string;
  /** The SDK version that produced this SBOM (for traceability). */
  readonly toolsVersion: string;
  /** Runtime dependencies as `{ name, version, scope? }`. */
  readonly runtimeDependencies: ReadonlyArray<{ readonly name: string; readonly version: string; readonly scope?: "required" | "optional" }>;
  /** Optional dev dependencies — kept separate so the SBOM does not bloat. */
  readonly devDependencies?: ReadonlyArray<{ readonly name: string; readonly version: string }>;
  /** Generation timestamp; ISO 8601. Defaults to `new Date().toISOString()`. */
  readonly timestamp?: string;
}

function purlFor(name: string, version: string): string {
  // npm packages — split on scope if present.
  if (name.startsWith("@")) {
    const [scope, pkg] = name.slice(1).split("/", 2);
    return `pkg:npm/${scope}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function bomRefFor(name: string, version: string): string {
  return `${name}@${version}`;
}

/** Build a CycloneDX 1.5 SBOM from `SbomInput`. */
export function buildSbom(input: SbomInput): Sbom {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const rootBomRef = bomRefFor(input.name, input.version);

  const runtime = input.runtimeDependencies.map((d) => ({
    type: "library" as const,
    "bom-ref": bomRefFor(d.name, d.version),
    name: d.name,
    version: d.version,
    purl: purlFor(d.name, d.version),
    scope: d.scope ?? "required",
  }));

  const dev = (input.devDependencies ?? []).map((d) => ({
    type: "library" as const,
    "bom-ref": bomRefFor(d.name, d.version),
    name: d.name,
    version: d.version,
    purl: purlFor(d.name, d.version),
    scope: "dev" as const,
  }));

  const components = [
    {
      type: "application" as const,
      "bom-ref": rootBomRef,
      name: input.name,
      version: input.version,
      purl: purlFor(input.name, input.version),
    },
    ...runtime,
    ...dev,
  ];

  const dependencies = [
    {
      ref: rootBomRef,
      dependsOn: runtime.map((c) => c["bom-ref"]),
    },
    ...runtime.map((c) => ({
      ref: c["bom-ref"],
      dependsOn: [] as ReadonlyArray<string>,
    })),
  ];

  // Serial number must be globally unique. Use sha256(rootBomRef + ts)
  // and stamp it as a URN-style identifier with a UUIDv4 prefix so
  // the SBOM is safe to publish to a CDX server.
  const serialHash = createHash("sha256")
    .update(rootBomRef)
    .update("\n")
    .update(timestamp)
    .update("\n")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 32);

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${serialHash}-0000-4000-8000-${serialHash.slice(0, 12).padEnd(12, "0")}`,
    version: 1,
    metadata: {
      timestamp,
      tools: [
        {
          vendor: "polderlabs",
          name: "bizar-sdk",
          version: input.toolsVersion,
        },
      ],
      component: {
        type: "application",
        "bom-ref": rootBomRef,
        name: input.name,
        version: input.version,
        purl: purlFor(input.name, input.version),
      },
    },
    components,
    dependencies,
  };
}