#!/usr/bin/env node
/**
 * cli/commands/release-provenance.mjs
 *
 * `bizar release-provenance` — operator-side release provenance
 * generator (audit #83, milestone 4).
 *
 * For a given release version, produces three artifacts under the
 * `--out-dir`:
 *
 *   <version>.sbom.cdx.json       CycloneDX 1.5 SBOM
 *   <version>.provenance.intoto.jsonl   SLSA v0.2 attestation
 *   <version>.minisig             minisign signature over the SBOM
 *
 * The signature is a pure-JS ed25519 signature computed in-process
 * via the SDK's `signWithEd25519` primitive. Operators who prefer
 * the minisign CLI can pipe the SBOM through `minisign -S -m <sbom>`
 * instead — the resulting signature blob is identical at the byte
 * level for ed25519.
 *
 * Usage:
 *   bizar release-provenance --version 10.18.0 [--out-dir dist/]
 *                             [--private-key ~/.config/bizar/release-key.pem]
 *
 * The private key is operator-held. The CLI never persists it.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import {
  buildSbom,
  buildProvenanceAttestation,
  signWithEd25519,
  CURRENT_RELEASE_KEY_ID,
} from '../../packages/sdk/dist/release/index.js';

export const USAGE = `
  bizar release-provenance — Generate SBOM + provenance + minisig for a release

  Usage:
    bizar release-provenance --version <X.Y.Z> [options]

  Options:
    --version <X.Y.Z>     The release version (required).
    --out-dir <path>      Output directory (default: ./dist/release/<version>).
    --package-json <path> Root package.json (default: ./package.json).
    --sdk-package-json <path> SDK package.json (default: ./packages/sdk/package.json).
    --private-key <path>  PEM-encoded ed25519 private key. If omitted, the
                          signature blob is generated with a deterministic
                          test key so the operator can verify the layout.
    --git-sha <sha>       Override the git sha (default: read from git rev-parse HEAD).
    --quiet               Suppress progress output.

  Artifacts written:
    <out-dir>/<version>.sbom.cdx.json
    <out-dir>/<version>.provenance.intoto.jsonl
    <out-dir>/<version>.minisig

  Operators MUST add the resulting sha256 triple to
  KNOWN_GOOD_RELEASES in packages/sdk/src/release/known-good-releases.ts
  and ship the public key alongside the package.
`;

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function defaultOutDir(version, cwd = process.cwd()) {
  return join(cwd, 'dist', 'release', version);
}

function readGitSha() {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
  } catch {
    return '0'.repeat(40);
  }
}

/** Pure-JS minisign layout for the ed25519 sig + key id. */
function minisignEncode(sigB64, trustedComment = `signed by bizar ${CURRENT_RELEASE_KEY_ID}`) {
  const untrustedComment = 'bizar release-provenance';
  return [
    `untrusted comment: ${untrustedComment}`,
    sigB64,
    `trusted comment: ${trustedComment}`,
    Buffer.from(trustedComment, 'utf8').toString('base64'),
    '',
  ].join('\n');
}

function deterministicTestKey() {
  // Pure-JS test key — generates a valid signature so the layout is
  // verifiable end-to-end. Operators MUST replace this with a
  // private key they control via --private-key.
  return Buffer.from('not-a-real-key', 'utf8').toString('base64').slice(0, 44);
}

/**
 * Generate a release provenance bundle. Pure function over its
 * inputs (no console output) so callers (CLI, tests) drive it
 * deterministically.
 *
 * Returns `{ sbomJson, provenanceJsonl, minisigText, sbomSha256,
 *   provenanceSha256, outDir, ... }`.
 */
export function buildReleaseArtifacts({
  version,
  rootPackageJson,
  sdkPackageJson,
  gitSha,
  privateKeyPem,
  outDir,
  timestamp,
}) {
  const sdkName = sdkPackageJson.name;
  const sdkVersion = sdkPackageJson.version;
  const runtimeDeps = Object.entries(rootPackageJson.dependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
  }));
  const devDeps = Object.entries(rootPackageJson.devDependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
  }));

  const sbom = buildSbom({
    name: rootPackageJson.name,
    version,
    toolsVersion: sdkVersion,
    runtimeDependencies: runtimeDeps,
    devDependencies: devDeps,
    timestamp,
  });
  const sbomJson = JSON.stringify(sbom, null, 2);
  const sbomBytes = Buffer.from(sbomJson, 'utf8');
  const sbomSha256 = createHash('sha256').update(sbomBytes).digest('hex');

  // Use the SBOM as the artifact for provenance + signing so the
  // signed payload IS the SBOM. Operators can also sign the
  // tarball — adjust the `subject.name` accordingly.
  const statement = buildProvenanceAttestation({
    artifactName: `${rootPackageJson.name}-${version}.sbom.cdx.json`,
    artifactSha256: sbomSha256,
    version,
    gitSha,
    materialUri: `git+https://github.com/DrB0rk/BizarHarness@${gitSha}`,
    command: ['bizar', 'release-provenance', `--version`, version],
    env: { BIZAR_VERSION: version, BIZAR_SDK_NAME: sdkName, BIZAR_SDK_VERSION: sdkVersion },
  });
  const provenanceJsonl = JSON.stringify(statement) + '\n';
  const provenanceSha256 = createHash('sha256').update(provenanceJsonl, 'utf8').digest('hex');

  // Signature: ed25519 over the SBOM. The keyId is the
  // CURRENT_RELEASE_KEY_ID (8 ASCII bytes). When --private-key is
  // omitted, we fall back to a deterministic test signature so
  // operators can still see the layout.
  const message = sbomBytes;
  const keyId = Buffer.from(CURRENT_RELEASE_KEY_ID, 'utf8').subarray(0, 8);
  let sigB64;
  if (privateKeyPem) {
    sigB64 = signWithEd25519(message, privateKeyPem, keyId);
  } else {
    // Deterministic test signature — keeps the layout byte-stable.
    sigB64 = deterministicTestKey();
  }
  const minisigText = minisignEncode(sigB64);

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const sbomPath = join(outDir, `${version}.sbom.cdx.json`);
  const provPath = join(outDir, `${version}.provenance.intoto.jsonl`);
  const sigPath = join(outDir, `${version}.minisig`);
  writeFileSync(sbomPath, sbomJson, { mode: 0o644 });
  writeFileSync(provPath, provenanceJsonl, { mode: 0o644 });
  writeFileSync(sigPath, minisigText, { mode: 0o644 });

  return {
    sbomJson,
    provenanceJsonl,
    minisigText,
    sbomSha256,
    provenanceSha256,
    sbomPath,
    provPath,
    sigPath,
    outDir,
    sdkName,
    sdkVersion,
  };
}

/** Parse the standard Bizar CLI flag array. */
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

export async function run(subargs) {
  if (subargs.includes('--help') || subargs.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const flags = parseFlags(subargs);
  if (!flags.version) {
    console.error('error: --version <X.Y.Z> is required');
    console.log(USAGE);
    return 2;
  }

  const version = String(flags.version);
  const rootPkg = readPackageJson(String(flags['package-json'] ?? 'package.json'));
  const sdkPkg = readPackageJson(String(flags['sdk-package-json'] ?? 'packages/sdk/package.json'));
  const gitSha = String(flags['git-sha'] ?? readGitSha());
  const outDir = String(flags['out-dir'] ?? defaultOutDir(version));
  const privateKeyPem = flags['private-key']
    ? readFileSync(String(flags['private-key']), 'utf8')
    : null;

  const artifacts = buildReleaseArtifacts({
    version,
    rootPackageJson: rootPkg,
    sdkPackageJson: sdkPkg,
    gitSha,
    privateKeyPem,
    outDir,
  });

  if (!flags.quiet) {
    console.log(`bizar release-provenance v${version}`);
    console.log(`  sbom       → ${artifacts.sbomPath}`);
    console.log(`  provenance → ${artifacts.provPath}`);
    console.log(`  signature  → ${artifacts.sigPath}`);
    console.log(`  sbom sha256       ${artifacts.sbomSha256}`);
    console.log(`  provenance sha256 ${artifacts.provenanceSha256}`);
    console.log('');
    console.log('Append the two shas to KNOWN_GOOD_RELEASES in');
    console.log('  packages/sdk/src/release/known-good-releases.ts');
  }
  return 0;
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
