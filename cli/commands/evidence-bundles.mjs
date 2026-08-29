/**
 * cli/commands/evidence-bundles.mjs — F-194 typed EvidenceBundle ledger.
 *
 * This is the durable on-disk store for typed `EvidenceBundle` records
 * (the observation that fills in an `ObjectiveRun`). It lives next to
 * the F-191 dispatch.jsonl ledger inside the same `~/.config/bizar/evidence/`
 * directory but uses a distinct per-run filename:
 *
 *   ~/.config/bizar/evidence/<objectiveRunId>.jsonl   one EvidenceBundle per line
 *   ~/.config/bizar/evidence/signatures.bundle       aggregate signature manifest
 *
 * Why a separate ledger file (and not the F-191 dispatch.jsonl):
 *   - F-191 is per-routing-decision (one row per dispatched model call).
 *   - F-194 is per-objective-run (typed observation after a real shell
 *     command ran, with command/cwd/exit/tests/revisions/sha256).
 *   - Same directory keeps mode=0o700 trivial; distinct filenames keep
 *     the two writers from racing on the same append handle.
 *
 * Why mode=0o700:
 *   - The bundle contents reveal operator-side git revisions,
 *     evaluator/rubric hashes, exit codes, token usage, and (via the
 *     eval digest) potentially sensitive environment fingerprints.
 *   - Only the operator should read them.
 *
 * Invariants:
 *   - `evidenceDir` is created lazily with mode `0o700`.
 *   - Each `appendBundle` call appends exactly one JSON line to the
 *     run's JSONL file and updates `signatures.bundle`.
 *   - `verifyBundles` MUST return `{ ok: true }` for any ledger produced
 *     by this module + the matching secret, and `{ ok: false, reason }`
 *     for any tampered row or missing manifest entry.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { verifyBundleSignature } from '../../packages/sdk/dist/autonomy/evidence-bundle.js';

/** Mode applied to the evidence directory and to every JSONL row file. */
export const EVIDENCE_DIR_MODE = 0o700;

/** Name of the per-run JSONL file when not provided. */
export const SIGNATURES_BUNDLE = 'signatures.bundle';

/**
 * Resolve the evidence directory with the precedence:
 *   1. `BIZAR_EVIDENCE_DIR` env (absolute or cwd-relative).
 *   2. `BIZAR_HOME/evidence` (BIZAR_HOME resolved the same way as provision.mjs).
 *   3. `~/.config/bizar/evidence` (XDG fallback).
 */
export function resolveEvidenceDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.BIZAR_EVIDENCE_DIR && typeof env.BIZAR_EVIDENCE_DIR === 'string') {
    return isAbsolute(env.BIZAR_EVIDENCE_DIR)
      ? env.BIZAR_EVIDENCE_DIR
      : resolve(cwd, env.BIZAR_EVIDENCE_DIR);
  }
  const home = env.BIZAR_HOME
    || (env.XDG_CONFIG_HOME ? `${env.XDG_CONFIG_HOME}/bizar` : null)
    || (env.HOME ? `${env.HOME}/.config/bizar` : null)
    || join(homedir(), '.config', 'bizar');
  return join(home, 'evidence');
}

/** Create the evidence dir if missing. Idempotent. Returns the path. */
export function ensureEvidenceDir({ cwd = process.cwd(), env = process.env } = {}) {
  const dir = resolveEvidenceDir({ cwd, env });
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: EVIDENCE_DIR_MODE });
  } else {
    // Tighten permissions on pre-existing dirs to avoid leaking prior installs.
    try {
      // Best-effort mode correction; ignored on Windows where chmod is limited.
      const cur = statSync(dir).mode & 0o777;
      if (cur !== EVIDENCE_DIR_MODE) {
        chmodSync(dir, EVIDENCE_DIR_MODE);
      }
    } catch { /* non-fatal */ }
  }
  return dir;
}

/** Path to a single run's JSONL file. */
export function bundleJsonlPath({ objectiveRunId, evidenceDir }) {
  if (typeof objectiveRunId !== 'string' || objectiveRunId.length === 0) {
    throw new TypeError('bundleJsonlPath: objectiveRunId must be a non-empty string');
  }
  // Sanitize: reject path separators + traversal.
  if (!/^[a-zA-Z0-9._-]+$/.test(objectiveRunId)) {
    throw new TypeError(`bundleJsonlPath: objectiveRunId has unsafe characters: ${objectiveRunId}`);
  }
  return join(evidenceDir, `${objectiveRunId}.jsonl`);
}

/** Path to the signatures.bundle aggregate file. */
export function signaturesBundlePath({ evidenceDir }) {
  return join(evidenceDir, SIGNATURES_BUNDLE);
}

/**
 * Append one signed EvidenceBundle to its run's JSONL file and
 * record its signature into signatures.bundle.
 *
 * Returns `{ ok: true, path, signature, recordedAt }`.
 *
 * Throws if `verifyBundleSignature(bundle, secret)` is false.
 */
export function appendBundle({ bundle, secret, evidenceDir }) {
  if (!bundle || typeof bundle !== 'object') {
    throw new TypeError('appendBundle: bundle must be an object');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('appendBundle: secret must be a non-empty string');
  }
  // Validate objectiveRunId first so path-traversal can't sneak a row
  // past the signature gate via a different error message.
  bundleJsonlPath({ objectiveRunId: bundle.objectiveRunId, evidenceDir: evidenceDir ?? resolveEvidenceDir() });
  const dir = ensureEvidenceDir({ env: { ...process.env, BIZAR_EVIDENCE_DIR: evidenceDir } });
  if (!verifyBundleSignature(bundle, secret)) {
    throw new Error('appendBundle: bundle signature failed verification (wrong secret or tampered row)');
  }
  const path = bundleJsonlPath({ objectiveRunId: bundle.objectiveRunId, evidenceDir: dir });
  const line = JSON.stringify(bundle) + '\n';
  appendFileSync(path, line, { mode: EVIDENCE_DIR_MODE });
  const recordedAt = new Date().toISOString();
  const sigPath = signaturesBundlePath({ evidenceDir: dir });
  let sigs = {};
  if (existsSync(sigPath)) {
    try { sigs = JSON.parse(readFileSync(sigPath, 'utf8')); } catch { sigs = {}; }
  }
  const runSigs = Array.isArray(sigs[bundle.objectiveRunId]) ? sigs[bundle.objectiveRunId] : [];
  runSigs.push({
    bundleId: bundle.bundleId,
    signature: bundle.signature,
    recordedAt,
    sha256BundleLine: createHash('sha256').update(line).digest('hex'),
  });
  sigs[bundle.objectiveRunId] = runSigs;
  writeFileSync(sigPath, JSON.stringify(sigs, null, 2) + '\n', { mode: EVIDENCE_DIR_MODE });
  return { ok: true, path, signature: bundle.signature, recordedAt };
}

/**
 * List every per-run JSONL in the evidence dir, with row counts and
 * last-appended timestamp. Excludes `signatures.bundle` itself.
 */
export function listBundles(opts = {}) {
  const dir = opts.evidenceDir ?? resolveEvidenceDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.jsonl')) continue;
    const path = join(dir, entry.name);
    const objectiveRunId = entry.name.slice(0, -'.jsonl'.length);
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    let lastAppendedAt = null;
    if (lines.length > 0) {
      try {
        const last = JSON.parse(lines[lines.length - 1]);
        lastAppendedAt = last.createdAt ?? null;
      } catch { /* ignore */ }
    }
    out.push({
      objectiveRunId,
      path,
      rowCount: lines.length,
      lastAppendedAt,
    });
  }
  out.sort((a, b) => a.objectiveRunId.localeCompare(b.objectiveRunId));
  return out;
}

/**
 * Re-verify every signed bundle in every run's JSONL file, then
 * cross-check the signatures.bundle manifest. Returns:
 *   - `{ ok: true, verifiedRuns, totalRows }` on success.
 *   - `{ ok: false, reason, runId?, bundleId? }` on any mismatch.
 *
 * `reason` is a stable machine-readable string for scripting.
 */
export function verifyBundles(opts = {}) {
  const { secret, evidenceDir } = opts;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('verifyBundles: secret must be a non-empty string');
  }
  const dir = evidenceDir ?? resolveEvidenceDir();
  if (!existsSync(dir)) {
    return { ok: false, reason: 'evidence-dir-missing' };
  }
  const entries = listBundles({ evidenceDir: dir });
  let totalRows = 0;
  for (const { objectiveRunId, path } of entries) {
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      totalRows += 1;
      let row;
      try { row = JSON.parse(line); } catch {
        return { ok: false, reason: 'malformed-jsonl-line', runId: objectiveRunId };
      }
      if (!verifyBundleSignature(row, secret)) {
        return {
          ok: false,
          reason: 'bundle-signature-mismatch',
          runId: objectiveRunId,
          bundleId: row.bundleId,
        };
      }
    }
  }
  // Cross-check the aggregate manifest if present.
  const sigPath = signaturesBundlePath({ evidenceDir: dir });
  if (existsSync(sigPath)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(sigPath, 'utf8')); }
    catch { return { ok: false, reason: 'signatures-bundle-malformed' }; }
    for (const [runId, sigs] of Object.entries(manifest)) {
      if (!Array.isArray(sigs)) {
        return { ok: false, reason: 'signatures-bundle-shape', runId };
      }
      const runFile = join(dir, `${runId}.jsonl`);
      if (!existsSync(runFile)) {
        return { ok: false, reason: 'signatures-bundle-orphan', runId };
      }
      const lines = readFileSync(runFile, 'utf8').split('\n').filter((l) => l.trim().length > 0);
      if (sigs.length !== lines.length) {
        return {
          ok: false,
          reason: 'signatures-bundle-count-mismatch',
          runId,
          manifestCount: sigs.length,
          jsonlCount: lines.length,
        };
      }
    }
  }
  return { ok: true, verifiedRuns: entries.length, totalRows };
}
