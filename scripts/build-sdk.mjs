#!/usr/bin/env node
/**
 * scripts/build-sdk.mjs
 *
 * Single-source SDK build entrypoint:
 *   1. Wipe packages/sdk/dist (no orphan files from a prior build).
 *   2. Run `tsc -p packages/sdk/tsconfig.json` to compile .ts → .js.
 *
 * Why so minimal: with the model-selection SDK dependencies gone, the
 * SDK no longer ships any hand-maintained `.mjs` mirrors. The full
 * surface compiles cleanly from `packages/sdk/src/` via `tsc` alone.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = resolve(REPO_ROOT, "packages", "sdk", "dist");

// 1. Wipe dist.
rmSync(DIST_DIR, { recursive: true, force: true });

// 2. Run tsc. We re-spawn rather than importing the TS API so the build
//    stays a single shell-line for `npm run build` and the F-193
//    e2e/verifier surface that shells out to `tsc -p`.
const tsc = spawnSync(
  "tsc",
  ["-p", "packages/sdk/tsconfig.json"],
  { cwd: REPO_ROOT, stdio: "inherit" },
);
process.exit(tsc.status ?? 1);
