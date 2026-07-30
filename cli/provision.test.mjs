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
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
        BIZAR_HOME: join(home, '.config', 'bizar'),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(settings.permissions.defaultMode, 'acceptEdits');
    assert.equal(settings.mcpServers['agent-browser'].command, 'agent-browser');
    assert.equal(settings.env.BIZAR_HOME, join(home, '.config', 'bizar'));
    assert.ok(settings.autoMode.soft_deny.some((rule) => rule.includes('pull-request mutations')));

    const hookText = JSON.stringify(settings.hooks);
    for (const hook of [
      'git-workflow-guard.mjs',
      'content-style-guard.mjs',
      'simplify-guard.mjs',
      'advisor-context.mjs',
      'telemetry.mjs',
      'precompact-priorities.sh',
    ]) {
      assert.match(hookText, new RegExp(hook.replace('.', '\\.')));
    }
    assert.match(settings.hooks.SubagentStart[0].matcher, /linda/);
    assert.match(settings.hooks.SubagentStart[0].matcher, /carl/);
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
    mkdirSync(join(skillsSrc, '9router'), { recursive: true });
    writeFileSync(join(skillsSrc, '9router', 'SKILL.md'), '# 9router skill');
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
    assert.ok(lock.skills['9router'], '9router entry should exist');
    assert.equal(lock.skills.bizar.source, 'bizar/builtin');
    assert.equal(lock.skills['9router'].source, 'bizar/builtin');
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

console.log('  provision.mjs tests loaded — run with: node --test cli/provision.test.mjs');
