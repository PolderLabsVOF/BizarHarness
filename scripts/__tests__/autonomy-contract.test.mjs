import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETTINGS_PATH = join(REPO_ROOT, 'config', 'claude', 'settings.json');
const CONTRACT_PATH = join(REPO_ROOT, 'docs', 'decisions', 'AUTONOMY_CONTRACT.md');
const PERM_REQUEST_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'permission-request.mjs');
const PRETOOLUSE_BASH_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'pretooluse-bash.mjs');
const PRETOOLUSE_EDIT_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'pretooluse-editwrite.mjs');
const GIT_WORKFLOW_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'git-workflow-guard.mjs');
const SECURE_DIR_PATH = join(REPO_ROOT, 'cli', 'commands', 'secure-dir.mjs');
const EVIDENCE_BUNDLES_PATH = join(REPO_ROOT, 'cli', 'commands', 'evidence-bundles.mjs');
const LEARNING_BEHAVIOR_PATH = join(REPO_ROOT, 'cli', 'commands', 'learning-behavior.mjs');
const WORKER_SUGGEST_PATH = join(REPO_ROOT, 'config', 'claude', 'hooks', 'worker-suggest.mjs');
const PROVISION_PATH = join(REPO_ROOT, 'cli', 'provision.mjs');
const DISPATCHER_PATH = join(REPO_ROOT, 'cli', 'worker-dispatcher.mjs');
const PATTERNS_PATH = join(REPO_ROOT, 'config', 'trigger-patterns.json');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('AUTONOMY_CONTRACT.md exists and is non-empty', () => {
  assert.equal(existsSync(CONTRACT_PATH), true, `${CONTRACT_PATH} must exist`);
  const body = readFileSync(CONTRACT_PATH, 'utf8');
  assert.ok(body.length > 200, 'AUTONOMY_CONTRACT.md must have substantive content');
  assert.match(body, /^# AUTONOMY_CONTRACT/m, 'must start with the H1 title');
  assert.match(body, /\*\*Status:\*\*\s*Accepted/, 'must declare its status');
  for (const tier of ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']) {
    assert.match(body, new RegExp(tier), `must enumerate ${tier}`);
  }
});

test('settings.json satisfies the contract (allow=[], deny=[], ask=[], bypassPermissions)', () => {
  // F-176 (10.17.4): the SHIPPED template carries EMPTY `allow`, `deny`,
  // and `ask` arrays. The destructive floor (push/rebase/force/destructive
  // filesystem ops) is enforced by `permission-request.mjs` returning
  // `behavior: 'deny'` for Tier-4 shapes; everything else is gated by
  // the advisory hook chain (pretooluse-bash, pretooluse-editwrite,
  // git-workflow-guard) via `additionalContext`. Operators opt into
  // specific `allow` patterns by adding them to their live
  // `~/.claude/settings.json`; the union-merge in
  // `cli/provision.mjs:writeClaudeSettings` preserves them across
  // re-installs.
  const settings = readJSON(SETTINGS_PATH);
  const perms = settings.permissions || {};
  assert.deepEqual(perms.allow ?? null, [], 'permissions.allow must be [] (F-176)');
  assert.deepEqual(perms.deny ?? [], [], 'permissions.deny must be []');
  assert.deepEqual(perms.ask ?? [], [], 'permissions.ask must be []');
  assert.equal(perms.defaultMode, 'bypassPermissions', 'defaultMode must be bypassPermissions');
});

test('settings.json permissions.allow ships empty + dangerous patterns absent', () => {
  const settings = readJSON(SETTINGS_PATH);
  const allow = settings.permissions?.allow ?? [];
  assert.deepEqual(allow, [], 'shipped template must carry empty allow (F-176)');
  // F-176: the dangerous 8-pattern family and `mcp__*` wildcard must
  // NOT ship. The explicit `mcp__bizar__*` / `mcp__semble__*` /
  // `mcp__agent-browser__*` per-tool allowlist is enforced by hook
  // output (`additionalContext`) at run-time, not by static allow rules.
  for (const pattern of [
    'mcp__*',
    'Bash(git -C * commit *)',
    'Bash(git -C * commit)',
    'Bash(git --git-dir=* commit *)',
    'Bash(git --git-dir=* commit)',
    'Bash(git -C * commit --amend *)',
    'Bash(git -C * commit --amend)',
    'Bash(git --git-dir=* commit --amend *)',
    'Bash(git --git-dir=* commit --amend)',
  ]) {
    assert.ok(
      !allow.includes(pattern),
      `permissions.allow must NOT include ${pattern} (F-176)`,
    );
  }
});

test('permission-request.mjs hard-denies the Tier-4 destructive floor', () => {
  // PermissionRequest is the ONLY hook that still returns `deny` (the
  // Claude Code Prompt-flow fall-back). PreToolUse hooks are advisory
  // per F-176; this PermissionRequest hook IS the hard floor.
  const source = readFileSync(PERM_REQUEST_PATH, 'utf8');
  // The hook stores the regex as a string-literal source token, so the
  // literal text we assert is the raw `\b` escapes, not the regex
  // word-boundary semantics those escapes have at runtime.
  for (const token of [
    'git\\s+push',
    '--force',
    'git\\s+rebase',
    'rm\\s+-',
    'mkfs|shutdown|halt|poweroff|reboot',
  ]) {
    assert.ok(
      source.includes(token),
      `permission-request.mjs must enforce ${token}`,
    );
  }
  assert.match(source, /behavior:\s*['"]deny['"]/, 'permission-request must still return deny');
});

test('pretooluse-bash.mjs enumerates the Tier-3/4 dangerous patterns as advisories', () => {
  // Under F-176 every PreToolUse pattern is advisory (`allow` +
  // `additionalContext`). The contract guarantees the scanner still
  // names each dangerous shape so the agent sees the reminder.
  const source = readFileSync(PRETOOLUSE_BASH_PATH, 'utf8');
  for (const name of ['rm-rf-root', 'rm-rf-system', 'mkfs', 'sudo', 'dd-of-dev']) {
    assert.match(source, new RegExp(`name:\\s*['"]${name}['"]`), `pretooluse-bash must list ${name}`);
  }
  assert.match(source, /permissionDecision:\s*['"]allow['"]/, 'pretooluse-bash must return allow (F-176)');
});

test('pretooluse-editwrite.mjs advisories cover package-manager and env templates', () => {
  // Under F-176 the per-write secret guard moved to git-workflow-guard.mjs
  // (staged-diff scanner at commit time). Pre-edit only flags package-
  // manager directories; allow-list covers .env.example/sample/template
  // and lockfiles.
  const source = readFileSync(PRETOOLUSE_EDIT_PATH, 'utf8');
  assert.match(source, /node_modules/, 'pretooluse-editwrite must advisory-flag node_modules/');
  assert.match(source, /\.env\.(example|sample|template|dist)/i, 'pretooluse-editwrite must allow .env templates');
  assert.match(source, /permissionDecision:\s*['"]allow['"]/, 'pretooluse-editwrite must return allow (F-176)');
});

test('git-workflow-guard.mjs enumerates the Tier-3 HITL categories as advisories', () => {
  // Source-level guarantee: every category the contract names is watched,
  // even if every output is `allow + additionalContext` per F-176. The
  // hook builds its regexes via `hasGhCommand(command, 'pr', …)` and
  // `hasGhCommand(command, 'release', …)` so we check the literal tokens
  // the dispatch sites pass to those helpers.
  const source = readFileSync(GIT_WORKFLOW_PATH, 'utf8');
  assert.match(source, /hasGhCommand\(command, ['"]pr['"]/, 'git-workflow-guard must dispatch gh pr advisories');
  assert.match(source, /hasGhCommand\(command, ['"]release['"]/, 'git-workflow-guard must dispatch gh release advisories');
  assert.match(source, /\b(?:npm|bun|pnpm)\b[\s\S]*\bpublish\b/, 'git-workflow-guard must scan npm|bun|pnpm publish');
  assert.match(source, /\bvercel\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan vercel deploy');
  assert.match(source, /\bwrangler\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan wrangler deploy');
  assert.match(source, /\bflyctl\b[\s\S]*(?:\bdeploy\b|\bpublish\b|--prod\b)/, 'git-workflow-guard must scan flyctl deploy');
  assert.match(source, /--force/, 'git-workflow-guard must scan --force');
  assert.match(source, /['"]-f['"]/, 'git-workflow-guard must scan -f');
  assert.match(source, /findGitCommand\(command, ['"]rebase['"]/, 'git-workflow-guard must scan rebase');
  assert.match(source, /findGitCommand\(command, ['"]push['"]/, 'git-workflow-guard must scan push');
});

test('git-workflow-guard.mjs blocks secret paths at commit/push time', () => {
  // The Tier-4 secret guard moved here from pretooluse-editwrite.mjs after
  // F-200 — it scans `git add <secret>` and staged diffs for env/secrets/.
  const source = readFileSync(GIT_WORKFLOW_PATH, 'utf8');
  for (const secret of ['.env', '.envrc', 'secrets/', 'credentials/', '.pem', '.key']) {
    assert.ok(
      source.includes(secret),
      `git-workflow-guard must guard ${secret}`,
    );
  }
});

test('AUTONOMY_CONTRACT.md cross-references every enforcement surface', () => {
  const body = readFileSync(CONTRACT_PATH, 'utf8');
  for (const ref of [
    'permission-request.mjs',
    'git-workflow-guard.mjs',
    'pretooluse-bash.mjs',
    'pretooluse-editwrite.mjs',
    'simplify-guard.mjs',
    'content-style-guard.mjs',
    'agent-model-guard.mjs',
    'cli/commands/secure-dir.mjs',
    'packages/sdk/src/learning/behavior-capture.ts',
    'config/claude/hooks/worker-suggest.mjs',
    'AGENTS.md',
    'scripts/__tests__/autonomy-contract.test.mjs',
  ]) {
    assert.ok(body.includes(ref), `AUTONOMY_CONTRACT.md must reference ${ref}`);
  }
});

// ─── Audit (commit 2a283c1) Milestone alignment ───────────────────────────────
//
// The production-autonomy audit defines a 4-milestone implementation
// sequence. AUTONOMY_CONTRACT.md is the Milestone 1 surface; the contract
// must enumerate each milestone + the deliverables that close it so the
// drift between "what the contract says" and "what's actually shipped"
// stays measurable.
test('AUTONOMY_CONTRACT.md aligns to the 4-milestone audit sequence', () => {
  const body = readFileSync(CONTRACT_PATH, 'utf8');
  for (const milestone of [
    'Milestone 1: One source of truth',
    'Milestone 2: Resumable controller',
    'Milestone 3: Independent verification',
    'Milestone 4: Production operations',
  ]) {
    assert.match(body, new RegExp(milestone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `AUTONOMY_CONTRACT.md must reference ${milestone}`);
  }
  // The audit commit is the source of truth for the milestones; the
  // contract must point at it so a future reader can trace any drift.
  assert.match(body, /2a283c1/, 'contract must cite audit commit 2a283c1');
  // The shipped Milestone 1 deliverables must be enumerated so a future
  // reader can verify each is wired through the contract's tier model.
  for (const delivered of [
    'EvidenceBundle',
    'ObjectiveRun',
    'OutcomeLearnerOutcome',
    'bizar improve',
  ]) {
    assert.ok(body.includes(delivered),
      `AUTONOMY_CONTRACT.md Milestone 1 must mention ${delivered}`);
  }
});

// ─── Phase B.4 extension: F-194 secure-dir + learning/evidence contract ──────
//
// These tests pin the file-system-side autonomy contract for the F-194
// learning + evidence ledgers: mode 0o700, single source of truth via
// secure-dir.mjs, no prompt text ever written to disk, force-clean
// preserves both subtrees. Drift here means a regression can silently
// start writing operator state world-readable.

test('secure-dir.mjs exports the F-194 0o700 contract', async () => {
  const mod = await import('../../cli/commands/secure-dir.mjs');
  assert.equal(mod.SECURE_DIR_MODE, 0o700, 'SECURE_DIR_MODE must be 0o700');
  assert.equal(typeof mod.resolveSecureSubdir, 'function');
  assert.equal(typeof mod.ensureSecureDir, 'function');
});

test('evidence-bundles.mjs + learning-behavior.mjs share the secure-dir helper', () => {
  const evidenceSrc = readFileSync(EVIDENCE_BUNDLES_PATH, 'utf8');
  const learningSrc = readFileSync(LEARNING_BEHAVIOR_PATH, 'utf8');
  // Both must import from secure-dir — no duplicated mkdirSync + chmodSync + existsSync blocks.
  assert.match(evidenceSrc, /from ['"]\.\/secure-dir\.mjs['"]/);
  assert.match(learningSrc, /from ['"]\.\/secure-dir\.mjs['"]/);
  // Neither should carry a hand-rolled 0o700 mkdir + chmod tighten block.
  for (const src of [evidenceSrc, learningSrc]) {
    assert.equal(
      /mkdirSync\([^,]+,\s*\{\s*recursive:\s*true,\s*mode:\s*0o700\s*\}\)/.test(src),
      false,
      '0o700 mkdir must live in secure-dir.mjs, not duplicated at the call site',
    );
    assert.equal(
      /chmodSync\([^,]+,\s*0o700\)/.test(src),
      false,
      'chmod tighten must live in secure-dir.mjs, not duplicated at the call site',
    );
  }
});

test('behavior-capture.ts exposes BEHAVIOR_DIR_MODE=0o700 + FORBIDDEN_BEHAVIOR_KEYS', async () => {
  const mod = await import('../../packages/sdk/src/learning/behavior-capture.js')
    .catch(() => import('../../packages/sdk/dist/learning/behavior-capture.js'));
  assert.equal(mod.BEHAVIOR_DIR_MODE, 0o700);
  assert.ok(Array.isArray(mod.FORBIDDEN_BEHAVIOR_KEYS));
  for (const forbidden of ['prompt', 'promptRedacted', 'rawPrompt', 'promptText', 'userInput']) {
    assert.ok(
      mod.FORBIDDEN_BEHAVIOR_KEYS.includes(forbidden),
      `FORBIDDEN_BEHAVIOR_KEYS must include ${forbidden}`,
    );
  }
});

test('worker-suggest.mjs reads via buildLearningContext and never echoes a prompt field', () => {
  const src = readFileSync(WORKER_SUGGEST_PATH, 'utf8');
  assert.match(src, /buildLearningContext/);
  assert.match(src, /learning-behavior\.mjs/);
  // Q4 invariant: no prompt-shaped field name appears in the hook source.
  for (const forbidden of ['promptText', 'rawPrompt', 'promptRedacted']) {
    assert.equal(
      src.includes(forbidden),
      false,
      `worker-suggest.mjs must not reference ${forbidden}`,
    );
  }
});

test('provision.mjs:ensureBizarHome creates evidence/ + learning/ at 0o700 and preserves both', () => {
  const src = readFileSync(PROVISION_PATH, 'utf8');
  // Both subtrees must be wired through the shared secure-dir helper.
  assert.match(src, /ensureSecureDir\(\{[^}]*subdir:\s*'evidence'/);
  assert.match(src, /ensureSecureDir\(\{[^}]*subdir:\s*'learning'/);
  // forceCleanInstall preserves both — explicit push into preserved[].
  for (const dir of ['evidence', 'learning']) {
    const preservedBlock = src.match(
      new RegExp(`const ${dir}Dir = join\\(BIZAR_HOME\\(\\), '${dir}'\\);[\\s\\S]{0,400}preserved\\.push\\(${dir}Dir\\)`),
    );
    assert.ok(preservedBlock, `forceCleanInstall must push ${dir}Dir into preserved[]`);
  }
});

// F-194 Phase D: worker-suggest write side must persist fingerprint-only
// rows to behavior.jsonl so future sessions can learn from accept/reject.
test('worker-suggest.mjs: writes behavior.jsonl via appendWorkerSuggestion (Phase D)', () => {
  const hookSrc = readFileSync(WORKER_SUGGEST_PATH, 'utf8');
  const dispatchSrc = readFileSync(DISPATCHER_PATH, 'utf8');
  const learningSrc = readFileSync(LEARNING_BEHAVIOR_PATH, 'utf8');
  // Hook destructures recordSuggestion.
  assert.match(hookSrc, /\{\s*dispatch\s*,\s*recordSuggestion\s*\}/);
  // Dispatcher delegates to appendWorkerSuggestion.
  assert.match(dispatchSrc, /appendWorkerSuggestion\s*\(/);
  // Learning module validates and writes the row.
  assert.match(learningSrc, /export\s+function\s+appendWorkerSuggestion\s*\(/);
  assert.match(learningSrc, /validateBehaviorRecord\s*\(/);
  assert.match(learningSrc, /fingerprint64\s*\(/);
});

test('trigger-patterns.json: covers every shipped Bizar agent (Phase D v2)', () => {
  const patternsSrc = readFileSync(PATTERNS_PATH, 'utf8');
  const patterns = JSON.parse(patternsSrc);
  // 16 shipped agents + design-system / ui-review / qa-review workers.
  const requiredAgents = [
    'mike', 'brenda', 'greg', 'oscar', 'paul', 'linda',
    'todd', 'karen', 'pam', 'steve', 'susan', 'janet',
    'carl', 'kevin', 'brad', 'ria',
  ];
  const mapped = new Set();
  for (const w of patterns.workers) {
    if (typeof w.agent === 'string') mapped.add(w.agent);
  }
  for (const a of requiredAgents) {
    assert.ok(mapped.has(a), `trigger-patterns.json must surface ${a} as a worker agent`);
  }
  assert.ok(patterns.workers.length >= 27, `expected >=27 workers, got ${patterns.workers.length}`);
});
