#!/usr/bin/env node
/**
 * scripts/bump-version.mjs
 *
 * Single source of truth for Bizar's release version computation.
 * Called by .github/workflows/{release-stable,release-beta,nightly-dev}.yml
 * and by the operator via `npm run release:bump -- --mode <mode>`.
 *
 * Modes:
 *   stable  Compute next stable X.Y.Z from conventional commits since the
 *           last chore(release) tag (uses git log + simple parsing).
 *           Output: X.Y.Z
 *
 *   beta    Compute next beta prerelease.
 *           Base defaults to (last stable on master) + minor bump if no
 *           explicit --base is provided. Counter increments past the most
 *           recent -beta.N tag. Output: X.Y.Z-beta.N
 *
 *   dev     Compute next dev prerelease.
 *           Variant `auto`    → X.Y.Z-dev.nightly.YYYYMMDD.<short-sha>
 *           Variant `manual`  → X.Y.Z-dev.manual.N
 *
 * Flags:
 *   --mode <stable|beta|dev>
 *   --variant <auto|manual>           dev mode only
 *   --base <X.Y.Z>                    beta + dev; overrides base detection
 *   --target <full-version-string>    if provided, use this exact version
 *                                     (still writes to all three files when
 *                                     --write is given)
 *   --write                           write to package.json,
 *                                     packages/sdk/package.json, and
 *                                     packages/sdk/src/version.ts
 *
 * Exit codes:
 *   0  — version computed (and optionally written)
 *   1  — invalid args / git error / no upstream to compare against
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const ROOT_PKG = resolve(repoRoot, 'package.json');
const SDK_PKG = resolve(repoRoot, 'packages/sdk/package.json');
const SDK_VERSION_TS = resolve(repoRoot, 'packages/sdk/src/version.ts');

function readPackageVersion(path) {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

function readSdkVersionConst() {
  const ts = readFileSync(SDK_VERSION_TS, 'utf8');
  const m = ts.match(/SDK_VERSION\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`Cannot parse SDK_VERSION from ${SDK_VERSION_TS}`);
  return m[1];
}

function readCurrentVersion() {
  // Prefer the SDK_VERSION constant — it is the single source of truth
  // documented in version.ts ("Keep synchronized with the workspace
  // package versions"). package.json values must match; if they don't,
  // surface a warning so the operator notices drift.
  const sdkConst = readSdkVersionConst();
  const rootVer = readPackageVersion(ROOT_PKG);
  const sdkVer = readPackageVersion(SDK_PKG);
  if (rootVer !== sdkConst || sdkVer !== sdkConst) {
    console.warn(
      `[bump-version] WARNING: version drift detected. SDK_VERSION=${sdkConst} ` +
      `package.json=${rootVer} packages/sdk/package.json=${sdkVer}. ` +
      `Using SDK_VERSION.`
    );
  }
  return sdkConst;
}

function writeVersion(version) {
  for (const p of [ROOT_PKG, SDK_PKG]) {
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    obj.version = version;
    writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  }
  const ts = readFileSync(SDK_VERSION_TS, 'utf8')
    .replace(/SDK_VERSION\s*=\s*"[^"]+"/, `SDK_VERSION = "${version}"`);
  writeFileSync(SDK_VERSION_TS, ts);
}

function git(...args) {
  try {
    return execSync(`git ${args.map(a => (a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    // swallow; caller checks for empty string
    return '';
  }
}

function conventionalBumpSinceLastRelease() {
  // Find the last chore(release) tag in history; if none, scan all history.
  const lastTag = git('describe', '--tags', '--match', 'v*.*.*', '--abbrev=0');
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const log = git('log', range, '--no-merges', '--pretty=format:%s');
  if (!log) return 'patch';   // no commits since last release → patch
  const lines = log.split('\n').filter(Boolean);
  let bump = 'patch';
  for (const line of lines) {
    if (/^BREAKING CHANGE:/.test(line) || /^[a-z]+(\([^)]+\))?!:/.test(line)) {
      bump = 'major';
      break;
    }
    if (/^feat(\([^)]+\))?:/.test(line) && bump !== 'major') {
      bump = 'minor';
    }
  }
  return bump;
}

function bumpSemver(version, kind) {
  const [maj, min, pat] = version.split('.').map(Number);
  switch (kind) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch': return `${maj}.${min}.${pat + 1}`;
    default: throw new Error(`Unknown bump kind: ${kind}`);
  }
}

function highestBetaCounter(base) {
  // Look at all tags matching v<base>-beta.* and return the highest counter.
  const tags = git('tag', '--list', `v${base}-beta.*`).split('\n').filter(Boolean);
  let max = 0;
  for (const t of tags) {
    const m = t.match(new RegExp(`^v${base.replace(/\./g, '\\.')}-beta\\.(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function todayUTC() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function shortSha() {
  return git('rev-parse', '--short', 'HEAD').slice(0, 7);
}

function highestDevManualCounter(base) {
  const tags = git('tag', '--list', `v${base}-dev.manual.*`).split('\n').filter(Boolean);
  let max = 0;
  for (const t of tags) {
    const m = t.match(new RegExp(`^v${base.replace(/\./g, '\\.')}-dev\\.manual\\.(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function computeNextBeta(baseArg) {
  const current = readCurrentVersion();
  let base;
  if (baseArg) {
    base = baseArg;
  } else if (/^\d+\.\d+\.\d+-beta\.\d+$/.test(current)) {
    // We're already on a beta prerelease — keep the same base.
    base = current.replace(/-beta\.\d+$/, '');
  } else {
    // Stable release → bump minor, take that as the next beta base.
    base = bumpSemver(current, 'minor');
  }
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(`Invalid beta base: ${base}`);
  }
  const counter = highestBetaCounter(base) + 1;
  return `${base}-beta.${counter}`;
}

function computeNextDev(variant, baseArg) {
  const current = readCurrentVersion();
  let base;
  if (baseArg) {
    base = baseArg;
  } else if (/^\d+\.\d+\.\d+-/.test(current)) {
    base = current.replace(/-.*$/, '');
  } else {
    base = bumpSemver(current, 'minor');
  }
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(`Invalid dev base: ${base}`);
  }
  if (variant === 'manual') {
    const counter = highestDevManualCounter(base) + 1;
    return `${base}-dev.manual.${counter}`;
  }
  // default: auto / nightly
  return `${base}-dev.nightly.${todayUTC()}.${shortSha()}`;
}

function computeNextStable() {
  const current = readCurrentVersion();
  if (/-\w+\.\d+$/.test(current)) {
    // Strip prerelease to get the next stable base.
    const base = current.replace(/-.*$/, '');
    return bumpSemver(base, conventionalBumpSinceLastRelease());
  }
  return bumpSemver(current, conventionalBumpSinceLastRelease());
}

function parseArgs(argv) {
  const args = { mode: null, variant: 'auto', base: null, target: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--mode': args.mode = argv[++i]; break;
      case '--variant': args.variant = argv[++i]; break;
      case '--base': args.base = argv[++i]; break;
      case '--target': args.target = argv[++i]; break;
      case '--write': args.write = true; break;
      case '-h': case '--help':
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n'));
        process.exit(0);
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
        else throw new Error(`Unexpected positional arg: ${a}`);
    }
  }
  if (!args.mode) throw new Error('--mode <stable|beta|dev> is required');
  return args;
}

import * as fs from 'node:fs';

function main() {
  const args = parseArgs(process.argv.slice(2));
  let version;
  if (args.target) {
    version = args.target;
  } else if (args.mode === 'stable') {
    version = computeNextStable();
  } else if (args.mode === 'beta') {
    version = computeNextBeta(args.base);
  } else if (args.mode === 'dev') {
    version = computeNextDev(args.variant, args.base);
  } else {
    throw new Error(`Unknown --mode: ${args.mode}`);
  }
  if (args.write) {
    writeVersion(version);
    console.error(`[bump-version] wrote ${version} to package.json + packages/sdk/package.json + packages/sdk/src/version.ts`);
  }
  // Always print the version on stdout so callers can `$(...)` it.
  process.stdout.write(version + '\n');
}

try {
  main();
} catch (e) {
  console.error(`[bump-version] ERROR: ${e.message}`);
  process.exit(1);
}
