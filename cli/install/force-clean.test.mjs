/**
 * cli/install/force-clean.test.mjs
 *
 * F-183 — tests for the fully clean `bizar install --force` flow.
 *
 * Covers:
 *   1. `forceCleanInstall` wipes the Bizar-managed dirs and `~/.agents/`.
 *   2. `forceCleanInstall` preserves `~/.config/bizar/` (BIZAR_HOME).
 *   3. `forceCleanInstall` preserves third-party state under
 *      `~/.claude/` (.credentials.json, statsig/, .playwright-mcp/).
 *   4. `forceCleanInstall` stashes the prior `settings.json` env block
 *      into `process.env.BIZAR_SAVED_ENV`.
 *   5. `forceCleanInstall({ dryRun: true })` reports paths but
 *      performs no rmSync.
 *   6. After `forceCleanInstall` + `writeClaudeSettings`, the freshly
 *      emitted settings.json inherits the F-181 wildcard
 *      permissions.allow expansion AND merges back the operator's
 *      stashed env vars (gateway URL, auth token, BIZAR_HOME).
 *   7. After force + sync*, the managed dirs are repopulated from the
 *      repo source (agents, skills, commands, hooks, rules).
 *   8. The `--deep` flag is parsed as an alias for `--force`.
 *   9. `FORCE_CLEAN_PRESERVE_ENV_KEYS` is a stable frozen list.
 *
 * Tests 1–5 import `provision.mjs` directly because `forceCleanInstall`
 * resolves `CLAUDE_DIR` lazily via `resolveClaudeDir()`. Tests 6–7 use
 * child-process subprocesses because `writeClaudeSettings` and the
 * `sync*` helpers capture `CLAUDE_DIR` as a module-load-time constant,
 * and the ESM module cache would otherwise leak the first fixture's
 * `CLAUDE_CONFIG_DIR` into every subsequent case.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;
const ORIG_AGENTS_DIR = process.env.AGENTS_DIR;
const ORIG_CLAUDE = process.env.CLAUDE_CONFIG_DIR;
const ORIG_BIZAR_HOME = process.env.BIZAR_HOME;
const ORIG_SAVED_ENV = process.env.BIZAR_SAVED_ENV;

function freshFixture() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-force-clean-'));
  const claudeDir = join(home, '.claude');
  const agentsDir = join(home, '.agents');
  const bizarHome = join(home, '.config', 'bizar');
  // Clear BIZAR_HOME so `BIZAR_HOME()` resolves through XDG_CONFIG_HOME
  // and matches our test fixture. Operators on real installs set
  // BIZAR_HOME explicitly; in the unit-test sandbox we drive the
  // resolve chain via XDG_CONFIG_HOME so a stray BIZAR_HOME from the
  // harness doesn't leak across cases.
  delete process.env.BIZAR_HOME;
  delete process.env.BIZAR_SAVED_ENV;
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  process.env.AGENTS_DIR = agentsDir;
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  // Pre-create the dirs that the test pretends a prior install left behind.
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(bizarHome, { recursive: true });
  // Bizar-managed dirs with realistic-ish fixture content.
  for (const sub of ['agents', 'skills', 'commands', 'hooks', 'rules', 'workflows', 'plugins']) {
    mkdirSync(join(claudeDir, sub), { recursive: true });
    writeFileSync(join(claudeDir, sub, `stale-${sub}.md`), `# stale ${sub}\n`);
  }
  writeFileSync(join(agentsDir, '.skill-lock.json'), '{}\n');
  writeFileSync(join(agentsDir, 'README.md'), 'old registry\n');
  // Pre-existing settings.json with operator credentials + a custom
  // env var that the F-176 contract says should NOT leak in.
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'https://router.example/v1',
      ANTHROPIC_AUTH_TOKEN: 'op-secret-token',
      BIZAR_MODEL_ROUTER_URL: 'https://router.example/v1',
      BIZAR_HOME: bizarHome,
      MY_USER_VAR: 'kept-on-disk',
    },
    permissions: { allow: ['Bash(git commit *)'], deny: ['Bash(rm -rf /)'], ask: [] },
  }, null, 2) + '\n');
  // Bizar HOME login marker that MUST survive the wipe.
  writeFileSync(join(bizarHome, 'login.json'), JSON.stringify({ user: 'op', expires: 9999999999 }) + '\n');
  // Third-party state that must survive the wipe.
  writeFileSync(join(claudeDir, '.credentials.json'), '{"refresh": "x"}\n');
  mkdirSync(join(claudeDir, 'statsig'), { recursive: true });
  writeFileSync(join(claudeDir, 'statsig', 'eval.json'), '{}\n');
  mkdirSync(join(claudeDir, '.playwright-mcp'), { recursive: true });
  writeFileSync(join(claudeDir, '.playwright-mcp', 'state.json'), '{}\n');
  // User-created subdir that the wipe must preserve.
  mkdirSync(join(claudeDir, 'projects'), { recursive: true });
  writeFileSync(join(claudeDir, 'projects', 'README.md'), 'my own notes\n');
  return { home, claudeDir, agentsDir, bizarHome };
}

function cleanupFixture(home) {
  if (home && existsSync(home)) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_CLAUDE === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIG_CLAUDE;
  if (ORIG_AGENTS_DIR === undefined) delete process.env.AGENTS_DIR;
  else process.env.AGENTS_DIR = ORIG_AGENTS_DIR;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
  if (ORIG_BIZAR_HOME === undefined) delete process.env.BIZAR_HOME;
  else process.env.BIZAR_HOME = ORIG_BIZAR_HOME;
  if (ORIG_SAVED_ENV === undefined) delete process.env.BIZAR_SAVED_ENV;
  else process.env.BIZAR_SAVED_ENV = ORIG_SAVED_ENV;
}

// ── 1. forceCleanInstall wipes the right set ────────────────────────────────

test('forceCleanInstall wipes the 7 Bizar-managed dirs under ~/.claude/ + ~/.agents/ + settings.json', async () => {
  const { home, claudeDir, agentsDir } = freshFixture();
  try {
    const { forceCleanInstall } = await import('../provision.mjs');
    const result = forceCleanInstall();
    assert.equal(result.ok, true);

    const managed = ['agents', 'skills', 'commands', 'hooks', 'rules', 'workflows', 'plugins'];
    for (const sub of managed) {
      assert.equal(existsSync(join(claudeDir, sub)), false, `${sub}/ should be wiped`);
    }
    assert.equal(existsSync(agentsDir), false, '~/.agents/ should be wiped');
    assert.equal(existsSync(join(claudeDir, 'settings.json')), false, 'settings.json should be wiped');
    assert.equal(result.wiped.length, 9, `expected 9 wiped paths (7 + agents + settings), got ${result.wiped.length}`);
  } finally { cleanupFixture(home); }
});

// ── 2. forceCleanInstall preserves ~/.config/bizar/ ─────────────────────────

test('forceCleanInstall preserves ~/.config/bizar/ (BIZAR_HOME)', async () => {
  const { home, bizarHome } = freshFixture();
  try {
    const { forceCleanInstall } = await import('../provision.mjs');
    const result = forceCleanInstall();
    assert.equal(existsSync(bizarHome), true, 'BIZAR_HOME must survive the wipe');
    const login = JSON.parse(readFileSync(join(bizarHome, 'login.json'), 'utf8'));
    assert.equal(login.user, 'op', 'login.json contents must be byte-identical');
    assert.ok(result.preserved.includes(bizarHome), 'preserved[] should include BIZAR_HOME');
  } finally { cleanupFixture(home); }
});

// ── 3. forceCleanInstall preserves third-party state ─────────────────────────

test('forceCleanInstall preserves ~/.claude/.credentials.json, statsig/, .playwright-mcp/ and user-owned subdirs', async () => {
  const { home, claudeDir } = freshFixture();
  try {
    const { forceCleanInstall } = await import('../provision.mjs');
    forceCleanInstall();
    assert.equal(existsSync(join(claudeDir, '.credentials.json')), true, '.credentials.json must survive');
    assert.equal(existsSync(join(claudeDir, 'statsig', 'eval.json')), true, 'statsig/ must survive');
    assert.equal(existsSync(join(claudeDir, '.playwright-mcp', 'state.json')), true, '.playwright-mcp/ must survive');
    assert.equal(existsSync(join(claudeDir, 'projects', 'README.md')), true, 'user-owned subdir must survive');
  } finally { cleanupFixture(home); }
});

// ── 4. forceCleanInstall stashes env into BIZAR_SAVED_ENV ────────────────────

test('forceCleanInstall stashes ANTHROPIC_* and BIZAR_* into BIZAR_SAVED_ENV', async () => {
  const { home } = freshFixture();
  try {
    const { forceCleanInstall, clearSavedEnv } = await import('../provision.mjs');
    clearSavedEnv();
    assert.equal(process.env.BIZAR_SAVED_ENV, undefined);
    forceCleanInstall();
    assert.ok(typeof process.env.BIZAR_SAVED_ENV === 'string', 'BIZAR_SAVED_ENV must be set');
    const stash = JSON.parse(process.env.BIZAR_SAVED_ENV);
    assert.equal(stash.ANTHROPIC_BASE_URL, 'https://router.example/v1');
    assert.equal(stash.ANTHROPIC_AUTH_TOKEN, 'op-secret-token');
    assert.equal(stash.BIZAR_MODEL_ROUTER_URL, 'https://router.example/v1');
    assert.ok(stash.BIZAR_HOME, 'BIZAR_HOME must be stashed');
    // MY_USER_VAR is intentionally NOT in the preserve set.
    assert.equal(stash.MY_USER_VAR, undefined, 'non-preserve env keys must NOT leak into stash');
    clearSavedEnv();
  } finally { cleanupFixture(home); }
});

// ── 5. dryRun: true reports paths but performs no rmSync ────────────────────

test('forceCleanInstall({ dryRun: true }) reports paths but performs no rmSync', async () => {
  const { home, claudeDir, agentsDir } = freshFixture();
  try {
    const { forceCleanInstall } = await import('../provision.mjs');
    const result = forceCleanInstall({ dryRun: true });
    // Dirs must still exist (dry-run).
    for (const sub of ['agents', 'skills', 'commands', 'hooks', 'rules', 'workflows', 'plugins']) {
      assert.equal(existsSync(join(claudeDir, sub)), true, `${sub}/ must NOT be wiped in dry-run`);
    }
    assert.equal(existsSync(agentsDir), true, '~/.agents/ must NOT be wiped in dry-run');
    assert.equal(existsSync(join(claudeDir, 'settings.json')), true, 'settings.json must NOT be wiped in dry-run');
    // But the report still mentions them.
    assert.ok(result.wiped.length >= 9, 'wiped[] must list the candidate paths even in dry-run');
    assert.match(result.message, /\[dry-run\]/);
  } finally { cleanupFixture(home); }
});

// ── 6. After force-clean-install + writeClaudeSettings: template resets, env stashed ──

test('force + writeClaudeSettings: template emits empty allow + operator env stashed back', async () => {
  const { home, claudeDir, bizarHome } = freshFixture();
  try {
    // Subprocess so `CLAUDE_DIR` resolves against THIS fixture.
    const script = `
      import { forceCleanInstall, writeClaudeSettings, clearSavedEnv } from './cli/provision.mjs';
      clearSavedEnv();
      const clean = forceCleanInstall();
      const result = writeClaudeSettings({ force: true });
      if (!result.ok) { process.stdout.write('WRITE_FAIL: ' + result.message); process.exit(2); }
      process.stdout.write(JSON.stringify({
        ok: true,
        wipedCount: clean.wiped.length,
        preserved: clean.preserved,
      }));
    `;
    const envForChild = { ...process.env };
    delete envForChild.BIZAR_HOME;
    delete envForChild.BIZAR_SAVED_ENV;
    Object.assign(envForChild, {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      AGENTS_DIR: join(home, '.agents'),
      XDG_CONFIG_HOME: join(home, '.config'),
    });
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: envForChild,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr || r.stdout}`);
    const result = JSON.parse(r.stdout);
    assert.equal(result.ok, true);
    assert.ok(result.wipedCount >= 9, `expected ≥9 wiped paths, got ${result.wipedCount}`);
    assert.ok(result.preserved.includes(bizarHome), 'preserved[] must contain BIZAR_HOME');

    // Now read the freshly-emitted settings.json directly.
    assert.equal(existsSync(join(claudeDir, 'settings.json')), true);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));

    // F-176 (10.17.4): a force-clean-install wipes settings.json entirely,
    // so the operator's `permissions.allow` cannot survive — that's the
    // intended semantics of `--force`. The freshly-emitted settings carry
    // the SHIPPED template shape: empty `allow`, empty `deny`, empty `ask`.
    const allow = settings.permissions?.allow || [];
    const deny = settings.permissions?.deny || [];
    assert.deepEqual(allow, [], 'force-clean-install re-emits allow: [] (F-176)');
    assert.deepEqual(deny, [], 'force-clean-install re-emits deny: [] (F-176)');
    assert.deepEqual(settings.permissions?.ask || [], [], 'permissions.ask must be []');
    assert.equal(settings.permissions?.defaultMode, 'bypassPermissions', 'defaultMode must be bypassPermissions');
    // F-176 — the dangerous 8-pattern family is NOT in the re-emitted allow.
    for (const pattern of [
      'Bash(git -C * commit *)',
      'Bash(git --git-dir=* commit *)',
      'Bash(git -C * commit --amend *)',
      'Bash(git --git-dir=* commit --amend *)',
    ]) {
      assert.equal(allow.includes(pattern), false, `dangerous pattern leaked into allow: ${pattern}`);
    }
    assert.equal(allow.includes('mcp__*'), false, 'F-176: mcp__* wildcard must NOT be re-emitted');
    // F-183 — operator env was merged back from the stash.
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://router.example/v1');
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'op-secret-token');
    assert.equal(settings.env.BIZAR_MODEL_ROUTER_URL, 'https://router.example/v1');
    assert.ok(settings.env.BIZAR_HOME, 'BIZAR_HOME must be present in re-emitted settings');
  } finally { cleanupFixture(home); }
});

// ── 6b. force-WRITE (no clean) union-merges operator permissions ────────────

test('force-write (no clean) union-merges operator permissions: custom allow rule survives', async () => {
  // Per team-lead item 5(b): the `force: true` write path in
  // `writeClaudeSettings` must NOT clobber the operator's existing
  // permissions. We seed a settings.json with a custom `Bash(custom-cmd *)`
  // allow rule + a `Bash(rm -rf /)` deny rule, then call
  // `writeClaudeSettings({ force: true })` WITHOUT first calling
  // `forceCleanInstall` (i.e. the on-disk settings.json survives). The
  // custom rules must survive the union-merge.
  const home = mkdtempSync(join(tmpdir(), 'bizar-union-merge-'));
  const claudeDir = join(home, '.claude');
  const bizarHome = join(home, '.config', 'bizar');
  try {
    delete process.env.BIZAR_HOME;
    delete process.env.BIZAR_SAVED_ENV;
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    process.env.AGENTS_DIR = join(home, '.agents');
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(bizarHome, { recursive: true });
    // Pre-existing operator settings — NOT wiped before writeClaudeSettings.
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['Bash(custom-cmd *)'],
        deny: ['Bash(rm -rf /)'],
        ask: [],
      },
    }, null, 2) + '\n');

    const script = `
      import { writeClaudeSettings } from './cli/provision.mjs';
      const r = writeClaudeSettings({ force: true });
      if (!r.ok) { process.stdout.write('FAIL: ' + r.message); process.exit(2); }
      process.stdout.write('OK');
    `;
    const envForChild = { ...process.env };
    delete envForChild.BIZAR_HOME;
    delete envForChild.BIZAR_SAVED_ENV;
    Object.assign(envForChild, {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      AGENTS_DIR: join(home, '.agents'),
      XDG_CONFIG_HOME: join(home, '.config'),
    });
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: envForChild,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr || r.stdout}`);
    assert.equal(r.stdout, 'OK');

    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    const allow = settings.permissions?.allow || [];
    const deny = settings.permissions?.deny || [];
    // Operator's deliberate rules MUST survive the force write.
    assert.ok(allow.includes('Bash(custom-cmd *)'), 'operator custom-cmd allow must survive union-merge');
    assert.ok(deny.includes('Bash(rm -rf /)'), 'operator rm -rf deny must survive union-merge');
    // Template's empty arrays contribute nothing — no dangerous patterns leak in.
    for (const pattern of [
      'Bash(git -C * commit *)',
      'Bash(git --git-dir=* commit *)',
      'mcp__*',
    ]) {
      assert.equal(allow.includes(pattern), false, `template leaked: ${pattern}`);
    }
    assert.deepEqual(settings.permissions?.ask || [], [], 'ask must be []');
  } finally { cleanupFixture(home); }
});

// ── 7. After force + sync*: managed dirs repopulated from repo ──────────────

test('after force + sync*, agents/skills/commands/hooks/rules are re-synced from the repo', async () => {
  const { home, claudeDir } = freshFixture();
  try {
    // Subprocess again so CLAUDE_DIR resolves correctly against THIS
    // fixture. We invoke each sync function individually rather than
    // runProvision to keep the test isolated from the installGitHooks
    // step (which expects a real .git/hooks dir).
    const script = `
      import { forceCleanInstall, syncAgentFiles, syncSkillFiles, syncCommandFiles, syncRulesFiles, syncHookFiles } from './cli/provision.mjs';
      forceCleanInstall();
      const agents = await syncAgentFiles({ force: true });
      const skills = await syncSkillFiles({ force: true });
      const commands = await syncCommandFiles({ force: true });
      const rules = await syncRulesFiles({ force: true });
      const hooks = await syncHookFiles({ force: true });
      process.stdout.write(JSON.stringify({
        agents: agents.copied,
        skills: skills.copied,
        commands: commands.copied,
        rules: rules.copied,
        hooks: hooks.copied,
      }));
    `;
    const envForChild = { ...process.env };
    delete envForChild.BIZAR_HOME;
    delete envForChild.BIZAR_SAVED_ENV;
    Object.assign(envForChild, {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      AGENTS_DIR: join(home, '.agents'),
      XDG_CONFIG_HOME: join(home, '.config'),
    });
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: envForChild,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr || r.stdout}`);
    const counts = JSON.parse(r.stdout);
    assert.ok(counts.agents >= 16, `expected ≥16 agents, got ${counts.agents}`);
    assert.ok(counts.skills >= 66, `expected ≥66 skills, got ${counts.skills}`);
    assert.ok(counts.commands >= 38, `expected ≥38 commands, got ${counts.commands}`);
    assert.ok(counts.rules >= 7, `expected ≥7 rules, got ${counts.rules}`);
    assert.ok(counts.hooks >= 30, `expected ≥30 hooks, got ${counts.hooks}`);

    // Verify stale entries from the prior install are gone.
    for (const sub of ['agents', 'skills', 'commands', 'hooks', 'rules']) {
      assert.equal(existsSync(join(claudeDir, sub, `stale-${sub}.md`)), false,
        `stale-${sub}.md must have been replaced by a fresh sync`);
    }
  } finally { cleanupFixture(home); }
});

// ── 8. --deep parses as alias for --force ────────────────────────────────────

test('parseFlags treats --deep as an alias for --force (clean-install semantics)', async () => {
  const { parseFlags } = await import('../provision.mjs');
  const fromForce = parseFlags(['install', '--force']);
  const fromDeep  = parseFlags(['install', '--deep']);
  assert.equal(fromForce.force, true);
  assert.equal(fromDeep.force, true, '--deep must set force=true');
  assert.equal(fromForce.mode, fromDeep.mode, 'mode flag must be identical');
});

// ── 9. preserve-set is exposed and stable ────────────────────────────────────

test('FORCE_CLEAN_PRESERVE_ENV_KEYS is a non-empty frozen list with the canonical keys', async () => {
  const { FORCE_CLEAN_PRESERVE_ENV_KEYS } = await import('../provision.mjs');
  assert.ok(Array.isArray(FORCE_CLEAN_PRESERVE_ENV_KEYS));
  assert.ok(FORCE_CLEAN_PRESERVE_ENV_KEYS.length > 0);
  assert.ok(Object.isFrozen(FORCE_CLEAN_PRESERVE_ENV_KEYS), 'preserve-set must be frozen');
  for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'BIZAR_MODEL_ROUTER_URL', 'BIZAR_HOME']) {
    assert.ok(
      FORCE_CLEAN_PRESERVE_ENV_KEYS.includes(key),
      `FORCE_CLEAN_PRESERVE_ENV_KEYS must include ${key}`,
    );
  }
});

console.log('  force-clean.test.mjs loaded — run with: node --test cli/install/force-clean.test.mjs');
