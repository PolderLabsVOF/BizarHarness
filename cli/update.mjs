/**
 * update.mjs — `bizar update` subcommand (v4.4.7 — thin wrapper).
 *
 * The full update logic now lives in `cli/provision.mjs:runProvision`.
 * `bizar install` and `bizar update` are the same code path with
 * different `mode` flags. This file just re-exports the API the rest of
 * the codebase expects.
 *
 * Why a thin wrapper:
 *   - One source of truth. Install + update used to drift apart (and
 *     did — install.mjs and update.mjs each grew their own copy of
 *     "copy plugin, patch cline.json, sync skills, run doctor").
 *     Now both call the same function.
 *   - Easier to maintain. Adding a new step means editing provision.mjs
 *     once; both `install` and `update` pick it up.
 *   - Same idempotency guarantees. Both modes probe existing state
 *     first and skip work that's already done.
 *
 * Backward-compatible: `runUpdate` is still exported with the same
 * signature (`runUpdate(subargs: string[])`).
 */

export {
  runUpdate,
  runProvision,
  detectState,
  readLivePid,
  killAndWait,
} from './provision.mjs';