/**
 * cli/provision.test.mjs
 *
 * Tests for provision idempotency and Claude Code configuration sync.
 */
import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// F-169 + F-180: path to the wrapper script that ships in the repo.
// Tests copy it into the temp claudeDir/hooks/ directory to simulate
// an installed user environment before calling `writeClaudeSettings`.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER_SRC = join(REPO_ROOT, 'config', 'claude', 'hooks', 'bizar-hook-wrapper.sh');

// Mock HOME for all tests
const ORIG_HOME = process.env.HOME;
const ORIG_XDG = process.env.XDG_CONFIG_HOME;

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'bizar-provision-'));
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  return home;
}

function restoreHome() {
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
  if (ORIG_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIG_XDG;
}

after(() => {
  restoreHome();
});

// ── Idempotency marker ────────────────────────────────────────────────────────

describe('install marker (installed.json)', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.BIZAR_HOME;
  });

  afterEach(() => {
    restoreHome();
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  test('readInstallMarker returns null when no marker file', async () => {
    // HOME is fresh tmpdir — no marker should exist
    const { readInstallMarker } = await import('./provision.mjs');
    const marker = readInstallMarker();
    assert.equal(marker, null);
  });

  test('writeInstallMarker returns ok=true and marker has correct shape', async () => {
    // Note: ESM module caching means BIZAR_HOME was computed at first module load.
    // This test verifies the function returns the correct shape when called.
    const { writeInstallMarker } = await import('./provision.mjs');
    const result = writeInstallMarker({ version: '5.0.0', repoPath: '/test/repo' });
    assert.equal(result.ok, true);
    assert.equal(result.marker.version, '5.0.0');
    assert.equal(result.marker.repoPath, '/test/repo');
    assert.ok(result.marker.installedAt);
  });

  test('readInstallMarker returns existing marker from BIZAR_HOME', async () => {
    const { writeInstallMarker, readInstallMarker } = await import('./provision.mjs');
    // Write first (this uses the fresh HOME's .config/bizar)
    writeInstallMarker({ version: '1.2.3', repoPath: '/foo' });
    // Read back
    const marker = readInstallMarker();
    assert.ok(marker !== null);
    assert.equal(marker.version, '1.2.3');
    assert.equal(marker.repoPath, '/foo');
  });
});

test('provisioner reports the root package version', async () => {
  const { BIZAR_VERSION, REPO_ROOT } = await import('./provision.mjs');
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(BIZAR_VERSION, pkg.version);
});

test('configured model metadata supplies Claude Code context-window enforcement', async () => {
  const { configuredModelContextTokens } = await import('./provision.mjs');
  const router = { userSelected: { profiles: { 'provider/model': { limits: { contextTokens: 1048576 } } } } };
  assert.equal(configuredModelContextTokens(router, 'provider/model'), 1048576);
  assert.equal(configuredModelContextTokens(router, 'provider/missing'), undefined);
});

test('recognized Claude override keys retain configured gateway values', async () => {
  const { buildClaudeModelOverrides } = await import('./commands/models.mjs');
  const ids = ['cx/gpt-5.6-luna', 'minimax/MiniMax-M3'];
  const mapped = buildClaudeModelOverrides(ids);
  assert.deepEqual(Object.values(mapped), ids);
  assert.ok(Object.keys(mapped).every((id) => id.startsWith('claude-')));
  assert.equal(mapped['cx/gpt-5.6-luna'], undefined);
});

test('model router ownership recognizes Bizar schemas and preserves foreign schemas', async () => {
  const { isBizarManagedModelRouter } = await import('./provision.mjs');
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://bizar.dev/schema/model-router.v1.json' }), true);
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://bizar.dev/schema/model-router.v2.json' }), true);
  assert.equal(isBizarManagedModelRouter({ $schema: 'https://example.test/custom-router.json' }), false);
  assert.equal(isBizarManagedModelRouter(null), false);
});

describe('syncConfigExtras() — native workflows', () => {
  test('dry-run reports workflow support', async () => {
    const { syncConfigExtras } = await import('./provision.mjs');
    const result = await syncConfigExtras({ dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(typeof result.counts.workflows, 'number');
    assert.match(result.message, /workflow/);
  });

  test('real install copies all shipped workflows and ultracode surfaces', () => {
    const home = mkdtempSync(join(tmpdir(), 'bizar-workflows-'));
    const claudeDir = join(home, '.claude');
    try {
      const script = `
        import { syncConfigExtras } from './cli/provision.mjs';
        const result = await syncConfigExtras();
        if (!result.ok) process.exit(1);
        console.log(JSON.stringify(result.counts));
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: claudeDir },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      for (const workflow of ['ultracode.js', 'ultracode-review.js', 'ultracode-research.js']) {
        assert.equal(existsSync(join(claudeDir, 'workflows', workflow)), true, workflow);
      }
      assert.equal(existsSync(join(claudeDir, 'skills', 'ultracode', 'SKILL.md')), true);
      assert.equal(existsSync(join(claudeDir, 'commands', 'ultracode.md')), true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('syncConfigExtras() — rules sync (v6.0.1)', () => {
  let home;

  beforeEach(() => {
    home = freshHome();
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    restoreHome();
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  test('dryRun: message mentions rules', async () => {
    const { syncConfigExtras } = await import('./provision.mjs');
    const result = await syncConfigExtras({ dryRun: true });
    assert.equal(result.ok, true);
    assert.ok(
      result.message.includes('rules'),
      `expected message to mention 'rules', got: ${result.message}`,
    );
    assert.ok(result.message.includes('[dry-run]'));
  });

  test('counts object exposes rules key (number)', async () => {
    const { syncConfigExtras } = await import('./provision.mjs');
    const result = await syncConfigExtras({ dryRun: true });
    assert.ok(result.counts && typeof result.counts === 'object');
    assert.equal(typeof result.counts.rules, 'number');
  });

  // The dry-run test and message-format assertion prove the rules-sync
  // code path is wired without touching a user's real Claude config.
});

test('generated Claude settings contain guarded autonomy and current runtime paths', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-settings-'));
  const claudeDir = join(home, '.claude');
  const bizarHome = join(home, '.config', 'bizar');
  const routerPath = join(bizarHome, 'config', 'claude', 'model-router.json');
  // F-169 + F-180: install the wrapper shim into the test claudeDir so
  // `resolveHookCommand` emits the wrapper-path command (its executable
  // form). `syncConfigExtras` does this on real installs.
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  copyFileSync(WRAPPER_SRC, join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'));
  chmodSync(join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'), 0o755);
  mkdirSync(dirname(routerPath), { recursive: true });
  writeFileSync(routerPath, JSON.stringify({
    userSelected: { models: ['cx/gpt-5.6-luna', 'minimax/MiniMax-M3'] },
  }));
  try {
    const script = `
      import { writeClaudeSettings } from './cli/provision.mjs';
      const result = writeClaudeSettings({ force: true });
      if (!result.ok) process.exit(1);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_CONFIG_DIR: claudeDir,
        BIZAR_HOME: bizarHome,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(settings.permissions.defaultMode, 'bypassPermissions');
    assert.equal(settings.worktree.bgIsolation, 'worktree');
    assert.equal(settings.enableWorkflows, true);
    assert.equal(settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
    assert.equal(settings.hooks.TaskCreated[0].hooks[0].command, `${join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh')} task-created`);
    assert.equal(settings.hooks.TaskCompleted[0].hooks[0].command, `${join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh')} task-completed`);
    assert.equal(settings.hooks.TeammateIdle[0].hooks[0].command, `${join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh')} teammate-idle`);
    assert.equal(settings.mcpServers['agent-browser'].command, 'agent-browser');
    assert.equal(settings.env.BIZAR_HOME, bizarHome);
    assert.equal(settings.model, 'cx/gpt-5.6-luna');
    assert.deepEqual(Object.values(settings.modelOverrides), [
      'cx/gpt-5.6-luna', 'minimax/MiniMax-M3',
    ]);
    assert.equal(settings.modelOverrides['cx/gpt-5.6-luna'], undefined);
    assert.equal(settings.disableAutoCompact, false);
    assert.ok(settings.autoMode.soft_deny.some((rule) => rule.includes('pull-request mutations')));
    // F-176: full permissions by default — deny/ask ship empty; external
    // actions are gated by policy text and advisory hooks, not prompts.
    assert.deepEqual(settings.permissions.deny, []);
    assert.deepEqual(settings.permissions.ask, []);
    // F-176 (10.17.4): the SHIPPED template carries `permissions.allow: []`.
    // On a fresh install the union-merge of an empty existing set against
    // the empty template still yields []. The F-181 wildcards + the
    // explicit `mcp__bizar__*` per-tool allowlist are NOT shipped here —
    // they live in the operator's pre-existing settings (union-merged)
    // or in the permission-request.mjs hook floor.
    assert.deepEqual(settings.permissions.allow, []);
    assert.equal(settings.permissions.allow.includes('Bash(git -C * commit *)'), false);
    assert.equal(settings.permissions.allow.includes('Bash(git --git-dir=* commit *)'), false);
    assert.equal(settings.permissions.allow.includes('mcp__*'), false);
    assert.equal(settings.permissions.allow.some((rule) => /git push|gh (?:pr|release)|publish|deploy/.test(rule)), false);

    const hookText = JSON.stringify(settings.hooks);
    // Bare `bizar hook` invocations are forbidden: Claude Code's stripped PATH
    // drops them silently. Every hook must route through the wrapper.
    assert.equal(/bizar hook [a-z0-9-]+/.test(hookText), false);
    for (const hook of [
      'bizar-hook-wrapper.sh user-prompt-submit',
      'bizar-hook-wrapper.sh session-start',
      'bizar-hook-wrapper.sh pre-tool-use',
      'bizar-hook-wrapper.sh permission-request',
      'bizar-hook-wrapper.sh post-tool-use-failure',
      'bizar-hook-wrapper.sh subagent-stop',
      'bizar-hook-wrapper.sh pre-compact',
      'bizar-hook-wrapper.sh stop',
    ]) {
      assert.match(hookText, new RegExp(hook.replace(/\./g, '\\.')));
    }
    assert.equal(settings.hooks.SubagentStart[0].matcher, undefined);
    assert.equal(
      settings.hooks.SubagentStart[0].hooks[0].command,
      `${join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh')} subagent-start`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── writeBizarSkillLock (v6.2.5) ──────────────────────────────────────────────
//
// The shared skills registry reads `~/.agents/.skill-lock.json` to decide
// whether a skill is installed. These tests pin the compatibility lock
// contract used by the installer.

describe('writeBizarSkillLock() — shared registry compatibility', () => {
  let home, skillsSrc, agentsDir;

  beforeEach(() => {
    home = freshHome();
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    skillsSrc = join(home, 'config', 'skills');
    agentsDir = join(home, '.agents');
    mkdirSync(skillsSrc, { recursive: true });
    mkdirSync(join(skillsSrc, 'bizar'), { recursive: true });
    writeFileSync(join(skillsSrc, 'bizar', 'SKILL.md'), '# Bizar skill');
    mkdirSync(join(skillsSrc, 'other-skill'), { recursive: true });
    writeFileSync(join(skillsSrc, 'other-skill', 'SKILL.md'), '# other skill');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    restoreHome();
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  test('writes lock file with all skills as bizar/builtin', async () => {
    const { writeBizarSkillLock } = await import('./provision.mjs');
    const result = writeBizarSkillLock({ skillsSrc, agentsDir });
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);

    const lockPath = join(agentsDir, '.skill-lock.json');
    assert.ok(existsSync(lockPath));
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.ok(lock.skills.bizar, 'bizar entry should exist');
    assert.ok(lock.skills['other-skill'], 'other-skill entry should exist');
    assert.equal(lock.skills.bizar.source, 'bizar/builtin');
    assert.equal(lock.skills['other-skill'].source, 'bizar/builtin');
    assert.equal(lock.skills.bizar.pluginName, 'bizar');
    assert.ok(lock.skills.bizar.installedAt);
    assert.ok(lock.skills.bizar.updatedAt);
  });

  test('preserves user-installed skills (does not overwrite non-bizar source)', async () => {
    const lockPath = join(agentsDir, '.skill-lock.json');
    const preExisting = {
      version: 3,
      skills: {
        'user-installed-skill': {
          source: 'vercel-labs/agent-skills',
          sourceType: 'github',
          sourceUrl: 'https://github.com/vercel-labs/agent-skills.git',
          skillPath: 'skills/foo/SKILL.md',
          installedAt: '2026-06-13T10:03:13.744Z',
          updatedAt: '2026-06-13T10:03:13.744Z',
        },
      },
    };
    writeFileSync(lockPath, JSON.stringify(preExisting));

    const { writeBizarSkillLock } = await import('./provision.mjs');
    writeBizarSkillLock({ skillsSrc, agentsDir });

    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.ok(lock.skills['user-installed-skill'], 'user skill must remain');
    assert.equal(
      lock.skills['user-installed-skill'].source,
      'vercel-labs/agent-skills',
      'user skill source must NOT be overwritten',
    );
    assert.ok(lock.skills.bizar, 'bizar entry should be added');
  });

  test('is idempotent — re-running updates timestamps, does not duplicate', async () => {
    const { writeBizarSkillLock } = await import('./provision.mjs');
    writeBizarSkillLock({ skillsSrc, agentsDir });
    const lock1 = JSON.parse(readFileSync(join(agentsDir, '.skill-lock.json'), 'utf8'));
    const firstInstalledAt = lock1.skills.bizar.installedAt;

    // tiny delay to make updatedAt observable
    await new Promise((r) => setTimeout(r, 10));
    writeBizarSkillLock({ skillsSrc, agentsDir });
    const lock2 = JSON.parse(readFileSync(join(agentsDir, '.skill-lock.json'), 'utf8'));
    assert.equal(lock2.skills.bizar.installedAt, firstInstalledAt);
    assert.notEqual(lock2.skills.bizar.updatedAt, lock1.skills.bizar.updatedAt);
  });

  test('returns ok=true with count=0 if skillsSrc missing', async () => {
    rmSync(skillsSrc, { recursive: true, force: true });
    const { writeBizarSkillLock } = await import('./provision.mjs');
    const result = writeBizarSkillLock({ skillsSrc, agentsDir });
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
  });
});

describe('writeClaudeSettings — hook wrapper path (F-169 + F-180)', () => {
  let home;
  let claudeDir;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'bizar-hooks-wrapper-'));
    claudeDir = join(home, '.claude');
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_DIR;
  });

  afterEach(() => {
    restoreHome();
    if (home && existsSync(home)) rmSync(home, { recursive: true, force: true });
  });

  // F-180 helper: install the wrapper shim into the test claudeDir so
  // `resolveHookCommand` emits the wrapper-path command. Mirrors what
  // `syncConfigExtras` does during a real install. Test B explicitly
  // skips this helper to exercise the sh -c fallback path.
  function installWrapper() {
    mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
    copyFileSync(WRAPPER_SRC, join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'));
    chmodSync(join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'), 0o755);
  }

  function runWriteClaudeSettings() {
    const script = `
      import { writeClaudeSettings } from './cli/provision.mjs';
      const result = writeClaudeSettings({ force: true });
      if (!result.ok) process.exit(1);
    `;
    return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_CONFIG_DIR: claudeDir,
        BIZAR_HOME: join(home, '.config', 'bizar'),
      },
      encoding: 'utf8',
    });
  }

  test('emitted settings.json contains no bare `bizar hook` commands', () => {
    installWrapper();
    const result = runWriteClaudeSettings();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settingsPath = join(claudeDir, 'settings.json');
    assert.equal(existsSync(settingsPath), true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    const allCommands = [];
    for (const groups of Object.values(settings.hooks || {})) {
      for (const group of groups || []) {
        for (const hook of group.hooks || []) {
          if (typeof hook.command === 'string') allCommands.push(hook.command);
        }
      }
    }
    assert.ok(allCommands.length > 0, 'expected hook commands to be present');
    for (const cmd of allCommands) {
      assert.equal(
        /bizar hook [a-z0-9-]+/.test(cmd),
        false,
        `bare "bizar hook" forbidden in emitted settings: ${cmd}`,
      );
      assert.match(
        cmd,
        /bizar-hook-wrapper\.sh [a-z0-9-]+/,
        `expected wrapper path in command: ${cmd}`,
      );
    }
  });

  test('emitted settings.json enables automatic compaction', () => {
    installWrapper();
    runWriteClaudeSettings();
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(settings.disableAutoCompact, false);
  });

  // ── F-180 ────────────────────────────────────────────────────────────

  test('F-180 test A: wrapper executable → absolute-path wrapper command', () => {
    installWrapper();
    const result = runWriteClaudeSettings();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    const expected = `${join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh')} user-prompt-submit`;
    assert.equal(
      settings.hooks.UserPromptSubmit[0].hooks[0].command,
      expected,
    );
  });

  test('F-180 test B: wrapper absent → POSIX sh -c fallback', () => {
    // Deliberately skip installWrapper() — wrapper does not exist.
    const result = runWriteClaudeSettings();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    const cmd = settings.hooks.UserPromptSubmit[0].hooks[0].command;
    assert.equal(
      cmd.includes('bizar-hook-wrapper.sh'),
      false,
      `wrapper substring must be absent when wrapper is not installed: ${cmd}`,
    );
    assert.ok(cmd.startsWith('sh -c '), `expected sh -c fallback: ${cmd}`);
    assert.ok(cmd.includes('user-prompt-submit'), `expected sub in fallback: ${cmd}`);
  });

  test('F-180 test C: HARD_MUTATION_ALLOW is non-empty and normalization-safe', () => {
    installWrapper();
    const script = `
      import { HARD_MUTATION_ALLOW, normalizePermissionLists } from './cli/provision.mjs';
      // Each entry, if added to permissions.allow via normalization,
      // must survive the round-trip without mutation.
      const out = normalizePermissionLists({}, { allow: HARD_MUTATION_ALLOW });
      process.stdout.write(JSON.stringify({ list: HARD_MUTATION_ALLOW, allow: out.allow }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.list), 'HARD_MUTATION_ALLOW must be an array');
    assert.ok(parsed.list.length > 0, 'HARD_MUTATION_ALLOW must be non-empty');
    for (const entry of parsed.list) {
      assert.ok(
        parsed.allow.includes(entry),
        `entry failed normalization round-trip: ${entry}`,
      );
    }
    // Sanity: surface covers all 9 hard-approval categories from AGENTS.md.
    const flat = parsed.list.join(' ');
    const categories = [
      /git push/,
      /gh pr/,
      /gh release/,
      /npm publish/,
      /vercel deploy/,
      /wrangler deploy/,
      /flyctl deploy/,
      /rm -rf/,
      /sudo/,
    ];
    for (const re of categories) {
      assert.ok(re.test(flat), `category ${re} missing from HARD_MUTATION_ALLOW`);
    }
  });

  test('F-180 test D: byte-for-byte factory invariant (no permissions.ask/deny fallback)', () => {
    const source = readFileSync(
      join(import.meta.dirname, 'provision.mjs'),
      'utf8',
    );
    // The factory must NOT carry a fallback `permissions.ask` or
    // `permissions.deny` literal. The shipped template is the single
    // source of truth; the factory just spreads `shipped.permissions`.
    assert.equal(
      /\|\|\s*\{\s*defaultMode:[^}]*ask:\s*\[/.test(source),
      false,
      'factory must not contain a permissions.ask fallback literal',
    );
    assert.equal(
      /deny:\s*\[\s*'Bash\(rm -rf/.test(source),
      false,
      'factory must not contain a permissions.deny rm -rf fallback literal',
    );
    assert.match(source, /permissions:\s*shipped\.permissions/);
  });
});

console.log('  provision.mjs tests loaded — run with: node --test cli/provision.test.mjs');
