/**
 * cli/commands/improve-proposal.mjs — F-194 Phase C bounded self-edit
 * proposal schema.
 *
 * A Proposal captures one shippable tweak Bizar can apply to itself
 * (or to a config file the operator owns) with a verifiable audit trail.
 *
 * Why find/replace instead of a unified diff:
 *   - Unified diffs have format ambiguity (hunk counts, trailing whitespace,
 *     line-ending preservation). The hunk applies or doesn't.
 *   - `find` is the verbatim byte-substring that must exist in the file
 *     exactly once at apply time. If it appears zero times or more than
 *     once, the apply MUST refuse — silent multi-replace is the kind of
 *     regression that turns self-improvement into self-corruption.
 *   - Rollback is a one-line `replace(find, newText)` call: `find` was
 *     the pre-state, `newText` was the post-state, so reversing is the
 *     same find+replace in the opposite direction.
 *
 * `id` is server-stamped at `propose` time so two proposals never share
 * an identifier. `createdAt` is server-stamped too, so a replayed proposal
 * carries its origin timestamp.
 *
 * Mode:
 *   - `dryRun: true` → `bizar improve run` shows the diff + verification
 *     plan + asks for confirmation, but does NOT mutate the target.
 *   - `dryRun: false` → applies the change, runs the verification command,
 *     appends an EvidenceBundle row on success. On verification failure
 *     the apply is rolled back and a separate EvidenceBundle row records
 *     the failure.
 */

import { createHash } from 'node:crypto';

/** @typedef {{
 *   id: string,
 *   targetFile: string,
 *   originalSha256: string,
 *   find: string,
 *   newText: string,
 *   verification: { command: string, cwd?: string, timeoutMs?: number, expectedExitCode?: number },
 *   rollbackPlan: { kind: 'replace-back', note: string } | { kind: 'manual', note: string, manualCommand?: string },
 *   reason: string,
 *   createdAt: string,
 *   dryRun?: boolean,
 * }} Proposal
 */

/** Frozen FORBIDDEN proposal keys — anything that smells like prompt or
 *  raw bytes-of-the-target leaks operator content. Mirrors the F-194
 *  BehaviorRecord policy so a regression cannot start persisting
 *  decision-context to disk. */
export const FORBIDDEN_PROPOSAL_KEYS = ['prompt', 'promptRedacted', 'rawPrompt', 'promptText', 'userInput', 'rawInput', 'rawInputBytes'];

const PROPOSAL_KEYS = ['id', 'targetFile', 'originalSha256', 'find', 'newText', 'verification', 'rollbackPlan', 'reason', 'createdAt', 'dryRun'];

/**
 * @param {string} text
 * @returns {string} sha256 hex of `text`
 */
export function sha256Text(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/**
 * @param {string} targetFile
 * @param {string} cwd
 * @returns {string} unique proposal id for this apply window
 */
export function newProposalId({ targetFile, cwd }) {
  const seed = `${Date.now()}|${process.pid}|${targetFile}|${cwd}`;
  return `imp-${sha256Text(seed).slice(0, 12)}`;
}

/**
 * @param {object} raw
 * @returns {Proposal}
 */
export function validateProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Proposal must be an object');
  }
  for (const k of Object.keys(raw)) {
    if (FORBIDDEN_PROPOSAL_KEYS.includes(k)) {
      throw new TypeError(`Proposal must not contain forbidden key: ${k}`);
    }
    if (!PROPOSAL_KEYS.includes(k)) {
      throw new TypeError(`Proposal has unknown key: ${k}`);
    }
  }
  for (const required of ['targetFile', 'originalSha256', 'find', 'newText', 'verification', 'rollbackPlan', 'reason']) {
    if (typeof raw[required] !== 'string' && typeof raw[required] !== 'object') {
      throw new TypeError(`Proposal.${required} is required and must be string or object`);
    }
  }
  if (raw.find.length === 0) {
    throw new TypeError('Proposal.find must be a non-empty substring');
  }
  if (raw.find === raw.newText) {
    throw new TypeError('Proposal.newText must differ from Proposal.find');
  }
  if (typeof raw.verification !== 'object' || typeof raw.verification.command !== 'string' || raw.verification.command.length === 0) {
    throw new TypeError('Proposal.verification.command must be a non-empty string');
  }
  if (typeof raw.rollbackPlan !== 'object' || (raw.rollbackPlan.kind !== 'replace-back' && raw.rollbackPlan.kind !== 'manual')) {
    throw new TypeError('Proposal.rollbackPlan.kind must be "replace-back" or "manual"');
  }
  return /** @type {Proposal} */ (raw);
}

/**
 * Apply a Proposal to the target file's current bytes. Refuses if:
 *   - `originalSha256` does not match the file's current sha256 (file changed since propose)
 *   - `find` does not appear exactly once in the file
 *
 * @param {Proposal} proposal
 * @param {string} currentFileBytes  UTF-8 text of the target file as it stands now
 * @returns {{ ok: true, newBytes: string, originalBytes: string } | { ok: false, reason: string }}
 */
export function planApply(proposal, currentFileBytes) {
  const currentSha = sha256Text(currentFileBytes);
  if (currentSha !== proposal.originalSha256) {
    return { ok: false, reason: `target sha256 drift: expected ${proposal.originalSha256}, got ${currentSha}` };
  }
  let count = 0;
  let idx = 0;
  while ((idx = currentFileBytes.indexOf(proposal.find, idx)) !== -1) {
    count += 1;
    idx += proposal.find.length;
  }
  if (count !== 1) {
    return { ok: false, reason: `Proposal.find matched ${count} times in target; expected exactly 1` };
  }
  const newBytes = currentFileBytes.replace(proposal.find, proposal.newText);
  const newSha = sha256Text(newBytes);
  if (newSha === currentSha) {
    return { ok: false, reason: 'Proposal.apply produced no change (find == newText after canonicalization)' };
  }
  return { ok: true, newBytes, originalBytes: currentFileBytes };
}

/**
 * Compute the rollback bytes for a Proposal. For `replace-back` this is
 * the original bytes (already captured by planApply). For `manual`, the
 * caller is responsible for executing `manualCommand`.
 *
 * @param {Proposal} proposal
 * @param {string} currentBytes post-apply file bytes
 * @returns {{ kind: 'replace-back', newBytes: string } | { kind: 'manual', manualCommand?: string }}
 */
export function planRollback(proposal, currentBytes) {
  if (proposal.rollbackPlan.kind === 'replace-back') {
    return { kind: 'replace-back', newBytes: currentBytes.replace(proposal.newText, proposal.find) };
  }
  return { kind: 'manual', manualCommand: proposal.rollbackPlan.manualCommand };
}