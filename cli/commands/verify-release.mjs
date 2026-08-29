#!/usr/bin/env node
/**
 * cli/commands/verify-release.mjs
 *
 * `bizar verify-release` — verify a release artifact set against
 * the pinned KNOWN_GOOD_RELEASES allowlist (audit #83, milestone 4).
 *
 * Inputs (all required):
 *   --version <X.Y.Z>
 *   --tarball <path>            Path to the npm tarball (.tgz)
 *   --sbom <path>               Path to the CycloneDX SBOM JSON
 *   --provenance <path>         Path to the SLSA provenance JSONL
 *   --minisig <path>            Path to the minisig text file
 *
 * Exit codes:
 *   0  Verified against KNOWN_GOOD_RELEASES
 *   1  Verification failed (UNKNOWN_RELEASE / TARBALL_HASH_MISMATCH / etc.)
 *   2  CLI misuse (missing flag, missing file)
 */

import { readFileSync, existsSync } from 'node:fs';

import { verifyRelease } from '../../packages/sdk/dist/release/index.js';

export const USAGE = `
  bizar verify-release — Verify a release artifact set against the pinned allowlist

  Usage:
    bizar verify-release --version <X.Y.Z> [options]

  Required:
    --version <X.Y.Z>     The version being verified
    --tarball <path>      Path to the npm tarball
    --sbom <path>         Path to the CycloneDX SBOM
    --provenance <path>   Path to the SLSA provenance JSONL
    --minisig <path>      Path to the minisig text file

  Optional:
    --json                Emit machine-readable JSON to stdout
`;

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
  const required = ['version', 'tarball', 'sbom', 'provenance', 'minisig'];
  for (const k of required) {
    if (!flags[k]) {
      console.error(`error: --${k} is required`);
      console.log(USAGE);
      return 2;
    }
    if (!existsSync(String(flags[k]))) {
      console.error(`error: --${k} path does not exist: ${flags[k]}`);
      return 2;
    }
  }

  const input = {
    version: String(flags.version),
    tarballBytes: readFileSync(String(flags.tarball)),
    sbomJson: readFileSync(String(flags.sbom), 'utf8'),
    provenanceJsonl: readFileSync(String(flags.provenance), 'utf8'),
    minisigText: readFileSync(String(flags.minisig), 'utf8'),
  };
  const result = verifyRelease(input);
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok) {
      console.log(`✓ release ${result.version} verified`);
      console.log(`  git sha: ${result.gitSha}`);
      console.log(`  signed by key id: ${result.minisignKeyId}`);
    } else {
      console.error(`✗ verification failed: ${result.reason}`);
      if (result.detail) console.error(`  ${result.detail}`);
    }
  }
  return result.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
