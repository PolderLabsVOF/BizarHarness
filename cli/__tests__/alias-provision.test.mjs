/**
 * cli/__tests__/alias-provision.test.mjs
 *
 * Behavior-lock test for the provision step after the OmniRoute
 * alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md).
 *
 * After implementation, `cli/provision.mjs:writeClaudeSettings` MUST
 * preserve the static alias map from the shipped template, MUST NOT
 * require or read `model-router.json`, and MUST NOT project generated
 * model-agent frontmatter into `~/.claude/agents/`.
 *
 * These tests currently FAIL against the pre-implementation tree
 * because the live code still reads the legacy router file and
 * rewrites the model + modelOverrides from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runProvision(env) {
  const home = mkdtempSync(join(tmpdir(), 'bizar-alias-provision-'));
  const claudeDir = join(home, '.claude');
  const bizarHome = join(home, '.config', 'bizar');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(bizarHome, { recursive: true });
  // F-169 + F-180: install the wrapper shim so the test mirrors a real install.
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  const wrapperSrc = join(REPO_ROOT, 'config', 'claude', 'hooks', 'bizar-hook-wrapper.sh');
  writeFileSync(join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'), readFileSync(wrapperSrc));
  try { chmodSync(join(claudeDir, 'hooks', 'bizar-hook-wrapper.sh'), 0o755); } catch {}

  const script = `
    import { writeClaudeSettings } from './cli/provision.mjs';
    const result = writeClaudeSettings({ force: true });
    if (!result.ok) process.exit(1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      BIZAR_HOME: bizarHome,
      ...env,
    },
    encoding: 'utf8',
  });
  return { result, home, claudeDir, bizarHome };
}

test('alias-provision: provisioned settings.json preserves static alias env map', () => {
  const { result, claudeDir, home } = runProvision({});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  try {
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'default');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'common');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'hard');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL, 'fable');
    assert.equal(settings.model, 'sonnet');
    assert.equal(settings.env.ANTHROPIC_MODEL, undefined);
    assert.equal(settings.env.CLAUDE_CODE_SUBAGENT_MODEL, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('alias-provision: provisioned settings.json does NOT require model-router.json', () => {
  const { result, claudeDir, bizarHome, home } = runProvision({});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  try {
    // After implementation, the provisioner MUST NOT require or read
    // `~/.claude/model-router.json`. We assert this by checking that
    // no router file was created in the user dir during the run, and
    // that the resulting settings still contain the static alias map.
    const routerPath = join(claudeDir, 'model-router.json');
    assert.equal(existsSync(routerPath), false,
      `provisioner created ${routerPath}; static alias contract must not write or require a model-router file`);
    const bizarRouter = join(bizarHome, 'model-router.json');
    assert.equal(existsSync(bizarRouter), false,
      `provisioner created ${bizarRouter}; static alias contract must not write or require a model-router file`);

    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'default');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'common');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'hard');
    assert.equal(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL, 'fable');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('alias-provision: provisioner does NOT project generated model-agent frontmatter', () => {
  const { result, claudeDir, home } = runProvision({});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  try {
    const agentsDir = join(claudeDir, 'agents');
    if (existsSync(agentsDir)) {
      const entries = readdirSync(agentsDir);
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const text = readFileSync(join(agentsDir, entry), 'utf8');
        assert.ok(
          !/^\s*model\s*:/m.test(text),
          `generated model-agent frontmatter detected in ${entry}; static alias contract must not project model frontmatter into agents`,
        );
      }
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
