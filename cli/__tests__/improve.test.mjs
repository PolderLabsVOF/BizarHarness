/**
 * cli/__tests__/improve.test.mjs — F-194 Phase C functional tests.
 *
 * Exercises the `bizar improve` subcommands against a temp HOME so we
 * never touch the operator's real ~/.config/bizar/evidence/improve.jsonl.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const BIN = 'node';
const BIN_PATH = join(REPO_ROOT, 'cli', 'bin.mjs');

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-improve-'));
  // Make BIZAR_HOME explicit so evidence/ lands inside the temp.
  return home;
}

function runCli(args, { home, expectExit = 0 } = {}) {
  const env = {
    ...process.env,
    BIZAR_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
  };
  const r = spawnSync(BIN, [BIN_PATH, ...args], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ok: r.status === expectExit,
  };
}

let tmp;
test.beforeEach(() => {
  tmp = freshHome();
});
test.afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

test('improve --help prints subcommand usage and exits 0', () => {
  const r = runCli(['improve', '--help'], { home: tmp });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /bizar improve <subcommand>/);
  assert.match(r.stdout, /propose/);
  assert.match(r.stdout, /run/);
  assert.match(r.stdout, /verify/);
  assert.match(r.stdout, /rollback/);
  assert.match(r.stdout, /list/);
});

test('propose emits a proposal JSON with frozen sha256 + verification', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old-value\nrest\n');
  const r = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old-value',
    '--new', 'new-value',
    '--verify', 'true',
    '--reason', 'rename',
  ], { home: tmp });
  assert.equal(r.status, 0);
  const proposal = JSON.parse(r.stdout.trim());
  assert.match(proposal.id, /^imp-[0-9a-f]{12}$/);
  assert.equal(proposal.targetFile, target);
  assert.match(proposal.originalSha256, /^[0-9a-f]{64}$/);
  assert.equal(proposal.find, 'old-value');
  assert.equal(proposal.newText, 'new-value');
  assert.equal(proposal.verification.command, 'true');
  assert.equal(proposal.reason, 'rename');
  assert.match(proposal.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(proposal.dryRun, true);
});

test('run dry-run does not modify the target file or write an evidence row', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const runR = runCli(['improve', 'run', '--proposal', proposalPath], { home: tmp });
  assert.equal(runR.status, 0);
  const out = JSON.parse(runR.stdout.trim());
  assert.equal(out.mode, 'dry-run');
  assert.equal(out.ok, true);
  // File unchanged.
  assert.equal(readFileSync(target, 'utf8'), 'old\n');
  // No evidence row written.
  const evidenceDir = join(tmp, 'evidence');
  const logPath = join(evidenceDir, 'improve.jsonl');
  assert.equal(existsSync(logPath), false, 'dry-run must not write evidence rows');
});

test('run --apply --yes mutates target, runs verification, appends evidence row', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const runR = runCli([
    'improve', 'run', '--proposal', proposalPath, '--apply', '--yes',
  ], { home: tmp });
  assert.equal(runR.status, 0);
  const out = JSON.parse(runR.stdout.trim());
  assert.equal(out.mode, 'apply');
  assert.equal(out.ok, true);
  // File mutated.
  assert.equal(readFileSync(target, 'utf8'), 'new\n');
  // Evidence row written.
  const logPath = join(join(tmp, 'evidence'), 'improve.jsonl');
  assert.equal(existsSync(logPath), true);
  const rows = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'improve-apply');
  assert.equal(rows[0].status, 'applied');
  assert.equal(rows[0].beforeSha256, sha256Hex('old\n'));
  assert.equal(rows[0].afterSha256, sha256Hex('new\n'));
  assert.equal(rows[0].verification.exitCode, 0);
});

test('run refuses if target sha256 drifted since propose', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  // Mutate the target after propose.
  writeFileSync(target, 'changed-by-another-process\n');
  const runR = runCli([
    'improve', 'run', '--proposal', proposalPath, '--apply', '--yes',
  ], { home: tmp, expectExit: 2 });
  assert.equal(runR.status, 2);
  assert.match(runR.stderr, /sha256 drift/);
});

test('run refuses if find matches zero or more than once', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'no-match-here\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'something-not-present',
    '--new', 'replacement',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const runR = runCli([
    'improve', 'run', '--proposal', proposalPath, '--apply', '--yes',
  ], { home: tmp, expectExit: 2 });
  assert.equal(runR.status, 2);
  assert.match(runR.stderr, /matched 0 times/);
});

test('run rolls back when verification exits non-zero', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'false',  // /bin/false exits 1
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const runR = runCli([
    'improve', 'run', '--proposal', proposalPath, '--apply', '--yes',
  ], { home: tmp, expectExit: 2 });
  assert.equal(runR.status, 2);
  assert.match(runR.stderr, /verification failed/);
  // File rolled back to original.
  assert.equal(readFileSync(target, 'utf8'), 'old\n');
  // Evidence row written with status rolled-back.
  const logPath = join(join(tmp, 'evidence'), 'improve.jsonl');
  const rows = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].status, 'rolled-back');
  assert.equal(rows[0].verification.exitCode, 1);
});

test('run refuses --apply without --yes', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const runR = runCli([
    'improve', 'run', '--proposal', proposalPath, '--apply',
  ], { home: tmp, expectExit: 2 });
  assert.equal(runR.status, 2);
  assert.match(runR.stderr, /requires\s*--yes/);
  // File unchanged.
  assert.equal(readFileSync(target, 'utf8'), 'old\n');
});

test('verify runs the verification command without applying anything', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'echo hello',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  const verifyR = runCli(['improve', 'verify', '--proposal', proposalPath], { home: tmp });
  assert.equal(verifyR.status, 0);
  const out = JSON.parse(verifyR.stdout.trim());
  assert.equal(out.ok, true);
  assert.equal(out.exitCode, 0);
  assert.match(out.stdoutTail, /hello/);
  // File unchanged.
  assert.equal(readFileSync(target, 'utf8'), 'old\n');
});

test('rollback restores the original bytes and records a row', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());

  // Apply first.
  runCli(['improve', 'run', '--proposal', proposalPath, '--apply', '--yes'], { home: tmp });
  assert.equal(readFileSync(target, 'utf8'), 'new\n');

  // Roll back.
  const rollbackR = runCli([
    'improve', 'rollback', '--proposal', proposalPath, '--yes',
  ], { home: tmp });
  assert.equal(rollbackR.status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'old\n');

  const logPath = join(join(tmp, 'evidence'), 'improve.jsonl');
  const rows = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // Apply row + rollback row.
  assert.equal(rows.length, 2);
  assert.equal(rows[1].kind, 'improve-rollback');
  assert.equal(rows[1].status, 'applied');
});

test('list returns recent evidence rows', () => {
  const target = join(tmp, 'config.txt');
  writeFileSync(target, 'old\n');
  const proposeR = runCli([
    'improve', 'propose',
    '--file', target,
    '--find', 'old',
    '--new', 'new',
    '--verify', 'true',
  ], { home: tmp });
  const proposalPath = join(tmp, 'proposal.json');
  writeFileSync(proposalPath, proposeR.stdout.trim());
  runCli(['improve', 'run', '--proposal', proposalPath, '--apply', '--yes'], { home: tmp });

  const listR = runCli(['improve', 'list', '--limit', '5'], { home: tmp });
  assert.equal(listR.status, 0);
  const out = JSON.parse(listR.stdout.trim());
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);
  assert.equal(out.rows[0].kind, 'improve-apply');
});

test('appendImproveRow refuses rows carrying FORBIDDEN keys', async () => {
  const mod = await import('../commands/improve.mjs');
  const tmpEvidenceDir = join(tmp, 'evidence');
  mkdirSync(tmpEvidenceDir, { recursive: true, mode: 0o700 });
  assert.throws(
    () => mod.appendImproveRow({ row: { kind: 'improve-apply', prompt: 'leak' }, evidenceDir: tmpEvidenceDir }),
    /forbidden key prompt/,
  );
  assert.throws(
    () => mod.appendImproveRow({ row: { kind: 'improve-apply', rawInput: 'leak' }, evidenceDir: tmpEvidenceDir }),
    /forbidden key rawInput/,
  );
});

function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
