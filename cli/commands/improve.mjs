#!/usr/bin/env node
/**
 * cli/commands/improve.mjs — F-194 Phase C bounded self-edit framework.
 *
 * `bizar improve` lets Bizar (or the operator) apply a small, audited
 * configuration tweak to itself with a verifiable audit trail.
 *
 * Subcommands:
 *   propose  --file <path> --find <substr> --new <text> --verify <cmd>
 *             [--reason <why>] [--cwd <dir>]
 *             Emits a proposal JSON to stdout (and optionally to a file).
 *             The proposal freezes the current sha256 of the target so the
 *             later `run` can refuse if the file changed in the meantime.
 *
 *   run      --proposal <file.json> [--apply] [--yes]
 *             Default mode is dry-run: prints the planned diff, the
 *             verification command, the rollback plan, and the expected
 *             evidence-ledger row that *would* be written. With --apply,
 *             it actually writes the change, runs the verification, and
 *             appends a row to ~/.config/bizar/evidence/improve.jsonl
 *             (mode 0o700). With --yes, skips the interactive
 *             confirmation prompt (still requires the same floors:
 *             sha256 match + find-exactly-once + verification exit 0).
 *
 *   verify   --proposal <file.json>
 *             Runs the proposal's verification command without applying
 *             anything. Prints stdout/stderr summary + exit code.
 *
 *   rollback --proposal <file.json>
 *             For replace-back rollback: rewrites the target using the
 *             original `find`/`newText` pair (reverses the apply). For
 *             manual rollback: prints the manual command for the operator.
 *
 *   list     [--limit N]
 *             Prints the recent rows from ~/.config/bizar/evidence/improve.jsonl.
 *
 * Floor:
 *   - All four write paths (run/rollback with side-effects) append a
 *     row to improve.jsonl. The hook `git-workflow-guard.mjs` emits a
 *     `critical` advisory on every `bizar improve run --apply` so the
 *     operator sees the heads-up before the apply commits.
 *   - The proposal's `originalSha256` MUST match the file's current
 *     sha256 at apply time. If it does not, the apply refuses.
 *   - The proposal's `find` substring MUST match exactly once. Zero or
 *     more than one matches → refuse.
 *   - The verification command MUST exit 0. Non-zero exit → apply is
 *     rolled back, the row is recorded with status `rolled-back`,
 *     process exits 2.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureSecureDir } from './secure-dir.mjs';
import {
  newProposalId,
  planApply,
  planRollback,
  sha256Text,
  validateProposal,
} from './improve-proposal.mjs';

/** Name of the per-row evidence file under the BIZAR evidence dir. */
export const IMPROVE_LOG = 'improve.jsonl';

/** Frozen list of well-known keys the row MUST NOT carry. Mirrors
 *  F-194 behavior-capture policy: no prompt text or raw input bytes. */
export const FORBIDDEN_IMPROVE_KEYS = [
  'prompt', 'promptText', 'rawPrompt', 'promptRedacted', 'userInput',
  'rawInput', 'rawInputBytes', 'targetBytes',
];

/** Resolve the evidence dir using the shared secure-dir helper. */
export function resolveImproveEvidenceDir({ cwd = process.cwd(), env = process.env } = {}) {
  return ensureSecureDir({
    cwd, env,
    envOverride: 'BIZAR_EVIDENCE_DIR',
    envSubdir: 'BIZAR_HOME',
    subdir: 'evidence',
  });
}

/** Append one row to improve.jsonl. Returns the resolved path. */
export function appendImproveRow({ row, evidenceDir } = {}) {
  for (const k of Object.keys(row || {})) {
    if (FORBIDDEN_IMPROVE_KEYS.includes(k)) {
      throw new TypeError(`appendImproveRow: row contains forbidden key ${k}`);
    }
  }
  const dir = evidenceDir ?? resolveImproveEvidenceDir();
  const filePath = join(dir, IMPROVE_LOG);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', { mode: 0o600 });
  }
  appendFileSync(filePath, JSON.stringify(row) + '\n', { mode: 0o600 });
  return filePath;
}

/** Read all rows. Returns [] if the file does not exist. */
export function listImproveRows({ evidenceDir, limit = 20 } = {}) {
  const filePath = join(evidenceDir ?? resolveImproveEvidenceDir(), IMPROVE_LOG);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const rows = raw.split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return rows.slice(-Math.max(0, limit | 0));
}

// ─── subcommand implementations ─────────────────────────────────────────────

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readCurrentFile({ file, cwd }) {
  const abs = isAbsolute(file) ? file : resolve(cwd, file);
  if (!existsSync(abs)) {
    throw new Error(`target file does not exist: ${abs}`);
  }
  return { abs, bytes: readFileSync(abs, 'utf8') };
}

function doPropose({ flags, cwd }) {
  if (!flags.file || !flags.find || !flags.new || !flags.verify) {
    process.stderr.write('usage: bizar improve propose --file <path> --find <substr> --new <text> --verify <cmd> [--reason <why>]\n');
    process.exit(2);
  }
  const { abs, bytes } = readCurrentFile({ file: flags.file, cwd });
  const proposal = {
    id: newProposalId({ targetFile: abs, cwd }),
    targetFile: abs,
    originalSha256: sha256Text(bytes),
    find: flags.find,
    newText: flags.new,
    verification: { command: flags.verify, cwd, expectedExitCode: 0 },
    rollbackPlan: { kind: 'replace-back', note: `Reverse the find/newText swap on ${abs}` },
    reason: String(flags.reason ?? '(no reason supplied)'),
    createdAt: new Date().toISOString(),
    dryRun: !(flags.apply === true),
  };
  const text = JSON.stringify(proposal, null, 2) + '\n';
  if (flags.out) {
    const outAbs = isAbsolute(flags.out) ? flags.out : resolve(cwd, flags.out);
    if (!existsSync(dirname(outAbs))) {
      mkdirSync(dirname(outAbs), { recursive: true });
    }
    writeFileSync(outAbs, text, { mode: 0o600 });
    process.stdout.write(`proposal → ${outAbs}\n`);
  } else {
    process.stdout.write(text);
  }
  return proposal;
}

function doRun({ flags, cwd }) {
  if (!flags.proposal) {
    process.stderr.write('usage: bizar improve run --proposal <file.json> [--apply] [--yes]\n');
    process.exit(2);
  }
  const proposalPath = isAbsolute(flags.proposal) ? flags.proposal : resolve(cwd, flags.proposal);
  const raw = readFileSync(proposalPath, 'utf8');
  const proposal = validateProposal(JSON.parse(raw));
  const apply = flags.apply === true;
  const { abs, bytes } = readCurrentFile({ file: proposal.targetFile, cwd });
  const plan = planApply(proposal, bytes);
  if (!plan.ok) {
    process.stderr.write(`refuse: ${plan.reason}\n`);
    process.exit(2);
  }

  const summary = {
    proposalId: proposal.id,
    proposalPath,
    targetFile: abs,
    beforeSha256: sha256Text(bytes),
    afterSha256: sha256Text(plan.newBytes),
    diffBytes: plan.newBytes.length - bytes.length,
    verification: proposal.verification,
    rollbackKind: proposal.rollbackPlan.kind,
  };

  if (!apply) {
    process.stdout.write(JSON.stringify({ ok: true, mode: 'dry-run', ...summary }, null, 2) + '\n');
    return;
  }

  if (!flags.yes) {
    process.stderr.write('refuse: --apply requires --yes (the apply path is intentionally loud)\n');
    process.exit(2);
  }

  // Apply.
  writeFileSync(abs, plan.newBytes, { mode: statSync(abs).mode & 0o777 });

  // Verify.
  const verifyCwd = proposal.verification.cwd || cwd;
  const verify = spawnSync('sh', ['-c', proposal.verification.command], {
    cwd: verifyCwd,
    encoding: 'utf8',
    timeout: Number(proposal.verification.timeoutMs) || 60_000,
  });
  const verifyExit = verify.status ?? -1;
  const verifyStdoutSha = sha256Text(verify.stdout ?? '');
  const verifyStderrSha = sha256Text(verify.stderr ?? '');

  if (verifyExit !== (proposal.verification.expectedExitCode ?? 0)) {
    // Roll back.
    const rollback = planRollback(proposal, plan.newBytes);
    if (rollback.kind === 'replace-back') {
      writeFileSync(abs, rollback.newBytes, { mode: statSync(abs).mode & 0o777 });
    }
    const row = {
      kind: 'improve-apply',
      status: 'rolled-back',
      appliedAt: new Date().toISOString(),
      proposalId: proposal.id,
      targetFile: abs,
      beforeSha256: summary.beforeSha256,
      attemptedSha256: summary.afterSha256,
      rolledBackSha256: rollback.kind === 'replace-back' ? sha256Text(rollback.newBytes) : null,
      verification: {
        command: proposal.verification.command,
        cwd: verifyCwd,
        exitCode: verifyExit,
        stdoutSha256: verifyStdoutSha,
        stderrSha256: verifyStderrSha,
      },
      reason: proposal.reason,
    };
    appendImproveRow({ row });
    process.stderr.write(`verification failed (exit=${verifyExit}); rolled back; row recorded\n`);
    process.exit(2);
  }

  // Apply succeeded and verified.
  const row = {
    kind: 'improve-apply',
    status: 'applied',
    appliedAt: new Date().toISOString(),
    proposalId: proposal.id,
    targetFile: abs,
    beforeSha256: summary.beforeSha256,
    afterSha256: summary.afterSha256,
    verification: {
      command: proposal.verification.command,
      cwd: verifyCwd,
      exitCode: verifyExit,
      stdoutSha256: verifyStdoutSha,
      stderrSha256: verifyStderrSha,
    },
    reason: proposal.reason,
  };
  appendImproveRow({ row });
  process.stdout.write(JSON.stringify({ ok: true, mode: 'apply', row, ...summary }, null, 2) + '\n');
}

function doVerify({ flags, cwd }) {
  if (!flags.proposal) {
    process.stderr.write('usage: bizar improve verify --proposal <file.json>\n');
    process.exit(2);
  }
  const proposalPath = isAbsolute(flags.proposal) ? flags.proposal : resolve(cwd, flags.proposal);
  const proposal = validateProposal(JSON.parse(readFileSync(proposalPath, 'utf8')));
  const verify = spawnSync('sh', ['-c', proposal.verification.command], {
    cwd: proposal.verification.cwd || cwd,
    encoding: 'utf8',
    timeout: Number(proposal.verification.timeoutMs) || 60_000,
  });
  process.stdout.write(JSON.stringify({
    ok: (verify.status ?? -1) === (proposal.verification.expectedExitCode ?? 0),
    exitCode: verify.status ?? -1,
    stdoutTail: (verify.stdout ?? '').slice(-2000),
    stderrTail: (verify.stderr ?? '').slice(-2000),
  }, null, 2) + '\n');
}

function doRollback({ flags, cwd }) {
  if (!flags.proposal) {
    process.stderr.write('usage: bizar improve rollback --proposal <file.json> [--yes]\n');
    process.exit(2);
  }
  const proposalPath = isAbsolute(flags.proposal) ? flags.proposal : resolve(cwd, flags.proposal);
  const proposal = validateProposal(JSON.parse(readFileSync(proposalPath, 'utf8')));
  const { abs, bytes } = readCurrentFile({ file: proposal.targetFile, cwd });
  const rollback = planRollback(proposal, bytes);
  if (rollback.kind === 'manual') {
    process.stdout.write(JSON.stringify({
      ok: false,
      kind: 'manual',
      message: `manual rollback required for ${abs}`,
      command: rollback.manualCommand ?? '(no manual command supplied)',
    }, null, 2) + '\n');
    process.exit(2);
  }
  if (!flags.yes) {
    process.stderr.write('refuse: rollback requires --yes\n');
    process.exit(2);
  }
  writeFileSync(abs, rollback.newBytes, { mode: statSync(abs).mode & 0o777 });
  const row = {
    kind: 'improve-rollback',
    status: 'applied',
    appliedAt: new Date().toISOString(),
    proposalId: proposal.id,
    targetFile: abs,
    beforeSha256: sha256Text(bytes),
    afterSha256: sha256Text(rollback.newBytes),
    reason: proposal.reason,
  };
  appendImproveRow({ row });
  process.stdout.write(JSON.stringify({ ok: true, ...row }, null, 2) + '\n');
}

function doList({ flags }) {
  const rows = listImproveRows({ limit: Number(flags.limit) || 20 });
  process.stdout.write(JSON.stringify({ ok: true, count: rows.length, rows }, null, 2) + '\n');
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

export async function run(cmd, args, isHelp) {
  if (cmd !== 'improve') return false;
  if (isHelp || args.length === 0) {
    process.stdout.write(USAGE);
    return true;
  }
  const cwd = process.cwd();
  const sub = args[0];
  const flags = parseFlags(args.slice(1));
  try {
    if (sub === 'propose') doPropose({ flags, cwd });
    else if (sub === 'run') doRun({ flags, cwd });
    else if (sub === 'verify') doVerify({ flags, cwd });
    else if (sub === 'rollback') doRollback({ flags, cwd });
    else if (sub === 'list') doList({ flags });
    else {
      process.stderr.write(`unknown subcommand: ${sub}\n${USAGE}`);
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`improve ${sub} failed: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
  return true;
}

export const USAGE = `
bizar improve <subcommand> [flags]

Subcommands:
  propose    Emit a Proposal JSON. Required: --file --find --new --verify [--reason] [--out <file>]
  run        Dry-run by default. With --apply --yes: applies, verifies, appends an evidence row.
  verify     Runs the proposal's verification command without applying anything.
  rollback   Reverses a prior apply. With --yes for replace-back rollbacks.
  list       Recent rows from ~/.config/bizar/evidence/improve.jsonl.

Floor: --apply requires --yes. --rollback requires --yes. The hook emits a
critical advisory on every "bizar improve run --apply" so the operator sees
the heads-up before the apply runs.
`;
