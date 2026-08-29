/**
 * cli/commands/secure-dir.mjs — shared 0o700 directory helpers.
 *
 * Both the F-194 evidence ledger (cli/commands/evidence-bundles.mjs) and
 * the F-194 Phase B.3 learning ledger (cli/commands/learning-behavior.mjs)
 * need to resolve the BIZAR_HOME-managed subtree and create it at mode
 * 0o700, tightening any pre-existing loose dir. This module centralizes
 * the pattern so the two ledgers cannot drift on:
 *   - the precedence (env override > BIZAR_HOME > XDG > ~/.config/bizar)
 *   - the 0o700 tightening semantics (mkdir 0o700 OR chmod to 0o700)
 *   - the Windows non-fatal ignore
 *
 * Keep this surface tiny — it is path resolution + atomic permission
 * tightening, nothing more. Higher-level reading/writing lives in the
 * ledger modules that import this.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Mode applied to every BIZAR_HOME-managed operator-only subtree. */
export const SECURE_DIR_MODE = 0o700;

/**
 * Resolve a BIZAR_HOME subtree with the precedence:
 *   1. `envOverride` (e.g. `BIZAR_EVIDENCE_DIR` / `BIZAR_LEARNING_DIR`)
 *      if non-empty, absolute-or-cwd-relative.
 *   2. `BIZAR_HOME/<subdir>` (BIZAR_HOME resolved the same way as provision.mjs).
 *   3. `~/.config/bizar/<subdir>` (XDG / HOME fallback).
 */
export function resolveSecureSubdir({
  cwd = process.cwd(),
  env = process.env,
  envOverride,
  envSubdir,
  subdir,
} = {}) {
  if (!subdir || typeof subdir !== 'string') {
    throw new TypeError('resolveSecureSubdir: subdir must be a non-empty string');
  }
  if (envOverride && env[envOverride] && typeof env[envOverride] === 'string') {
    const v = env[envOverride];
    return isAbsolute(v) ? v : resolve(cwd, v);
  }
  const home = env[envSubdir]
    || (env.XDG_CONFIG_HOME ? `${env.XDG_CONFIG_HOME}/bizar` : null)
    || (env.HOME ? `${env.HOME}/.config/bizar` : null)
    || join(homedir(), '.config', 'bizar');
  return join(home, subdir);
}

/**
 * Ensure a BIZAR_HOME subtree exists with mode 0o700. Idempotent.
 * Returns the resolved path. Pre-existing loose dirs are re-tightened
 * (best-effort — Windows ignores chmod failures, which is non-fatal).
 */
export function ensureSecureDir({
  cwd = process.cwd(),
  env = process.env,
  envOverride,
  envSubdir,
  subdir,
  mode = SECURE_DIR_MODE,
} = {}) {
  const dir = resolveSecureSubdir({ cwd, env, envOverride, envSubdir, subdir });
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode });
  } else {
    try {
      const cur = statSync(dir).mode & 0o777;
      if (cur !== mode) chmodSync(dir, mode);
    } catch { /* non-fatal on Windows */ }
  }
  return dir;
}
