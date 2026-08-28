#!/usr/bin/env node
/**
 * scripts/build-sdk.mjs
 *
 * Single-source SDK build entrypoint:
 *   1. Wipe packages/sdk/dist (no orphan files from a prior build).
 *   2. Materialise hand-maintained `.mjs` files into dist/ before tsc
 *      runs so the compiler emits the surrounding .d.ts / .js siblings
 *      without re-touching the mirror. Currently this is just
 *      `router/failover-mirror.mjs` — the JS twin of `failover.ts` that
 *      the `mjs` CLI consumes without a TS build step on the user side.
 *   3. Run `tsc -p packages/sdk/tsconfig.json` to compile .ts → .js.
 *
 * Why the mirror copy is in this script and not just a sibling of
 * `tsc`: the CLI's import path resolves to
 * `packages/sdk/dist/router/failover-mirror.mjs` after install, so the
 * file must exist in the published tarball. The source of truth lives at
 * `packages/sdk/src/router/failover-mirror.mjs` (intentionally not
 * shipped — `src/` is not in `package.json#files`), and this script is
 * the one place where source-side hand files cross into dist.
 */
import { rmSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = resolve(REPO_ROOT, "packages", "sdk", "dist");

// 1. Wipe dist.
rmSync(DIST_DIR, { recursive: true, force: true });

// 2. Materialise hand-maintained .mjs files into dist BEFORE tsc runs.
const MIRROR_SRC = resolve(
  REPO_ROOT,
  "packages",
  "sdk",
  "src",
  "router",
  "failover-mirror.mjs",
);
const MIRROR_DEST = resolve(DIST_DIR, "router", "failover-mirror.mjs");
mkdirSync(dirname(MIRROR_DEST), { recursive: true });
copyFileSync(MIRROR_SRC, MIRROR_DEST);

// 3. Run tsc. We re-spawn rather than importing the TS API so the build
//    stays a single shell-line for `npm run build` and the F-193
//    e2e/verifier surface that shells out to `tsc -p`.
const tsc = spawnSync(
  "tsc",
  ["-p", "packages/sdk/tsconfig.json"],
  { cwd: REPO_ROOT, stdio: "inherit" },
);
process.exit(tsc.status ?? 1);
