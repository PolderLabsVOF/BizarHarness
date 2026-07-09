/**
 * cli/commands/validate.test.mjs
 *
 * v6.2.0 — Unit tests for the new `bizar validate` subcommand.
 *
 * We exercise `runValidate()` directly. CLINE_DIR is mocked via
 * `process.env.CLINE_DIR`; a minimal-but-complete Bizar install is
 * staged inside a tmpdir. We then progressively delete files to
 * verify each check fails with a sensible message.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

const { runValidate } = await import('./validate.mjs');

const ORIG_CLINE_DIR = process.env.CLINE_DIR;
const ORIG_HOME = process.env.HOME;

let workDir;

function freshWorkDir() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-validate-'));
  process.env.CLINE_DIR = root;
  return root;
}

function makeFakeClineInstall(root) {
  writeFileSync(
    join(root, 'cline.json'),
    JSON.stringify({
      $schema: 'https://docs.cline.bot/config.json',
      plugin: [[
        './plugins/bizar',
        { loopThresholdWarn: 5, loopThresholdEscalate: 8, loopThresholdBlock: 12, loopWindowSize: 10 },
      ]],
      default_agent: 'odin',
      permission: 'allow',
      snapshot: false,
      instructions: ['.cline/instructions/bizar-tools.md'],
      provider: {
        '9router': {
          baseUrl: 'http://localhost:20128/v1',
          apiKey: '${env:NINEROUTER_KEY}',
          models: { 'minimax/MiniMax-M3': { reasoning: true } },
        },
        minimax: { models: {} },
      },
    }, null, 2),
  );
  const agentsDir = join(root, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const f of [
    'odin.md', 'vor.md', 'frigg.md', 'quick.md',
    'mimir.md', 'heimdall.md', 'hermod.md', 'thor.md', 'baldr.md',
    'tyr.md', 'vidarr.md', 'forseti.md',
    'semble-search.md', 'agent-browser.md',
  ]) {
    writeFileSync(join(agentsDir, f), '# fake agent');
  }
  writeFileSync(join(agentsDir, 'odin.yaml'), 'name: odin\ndescription: odin\n');
  const cmdsDir = join(root, 'commands');
  mkdirSync(cmdsDir, { recursive: true });
  for (const f of [
    'audit.md', 'bizar.md', 'explain.md', 'init.md', 'learn.md',
    'plan.md', 'plow-through.md', 'pr-review.md', 'tailscale-serve.md',
    'visual-plan.md',
    'team.md', 'test.md', 'validate.md',
  ]) {
    writeFileSync(join(cmdsDir, f), '# fake command');
  }
  const skillsDir = join(root, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const skill of ['9router', 'bizar', 'obsidian']) {
    mkdirSync(join(skillsDir, skill), { recursive: true });
    writeFileSync(join(skillsDir, skill, 'SKILL.md'), '# fake skill');
  }
  const rulesDir = join(root, 'rules');
  mkdirSync(rulesDir, { recursive: true });
  for (const r of ['general.md', 'git.md', 'javascript.md', 'python.md', 'testing.md', 'thinking.md', 'uncertainty.md']) {
    writeFileSync(join(rulesDir, r), '# fake rule');
  }
  const hooksDir = join(root, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  for (const h of ['pre-tool-use.md', 'post-tool-use.md', 'README.md']) {
    writeFileSync(join(hooksDir, h), '# fake hook');
  }
  const pluginDir = join(root, 'plugins', 'bizar');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'index.ts'), '// fake plugin entry — >100 bytes to pass size check\n'.repeat(10));
  mkdirSync(join(pluginDir, 'src'), { recursive: true });
  writeFileSync(
    join(pluginDir, 'src', 'clineruntime.ts'),
    'export class ClineRuntime { config = { enableAgentTeams: true }; }\n',
  );
  // node_modules with the required runtime deps
  const nmDir = join(pluginDir, 'node_modules');
  mkdirSync(nmDir, { recursive: true });
  mkdirSync(join(nmDir, 'zod'), { recursive: true });
  writeFileSync(join(nmDir, 'zod', 'package.json'), '{}');
  mkdirSync(join(nmDir, '@cline'), { recursive: true });
  for (const dep of ['@cline/sdk', '@cline/core', '@cline/shared']) {
    mkdirSync(join(nmDir, dep), { recursive: true });
    writeFileSync(join(nmDir, dep, 'package.json'), '{}');
  }
}

beforeEach(() => {
  workDir = freshWorkDir();
  makeFakeClineInstall(workDir);
});

afterEach(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  if (ORIG_CLINE_DIR === undefined) delete process.env.CLINE_DIR;
  else process.env.CLINE_DIR = ORIG_CLINE_DIR;
  if (ORIG_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIG_HOME;
});

/**
 * Capture stdout + exit code for a single runValidate() call.
 * The test runner writes its own progress to stdout, so we swap
 * process.stdout for a sink Writable during the call.
 */
async function captureRun(opts) {
  const captured = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      captured.push(Buffer.from(chunk));
      cb();
    },
  });
  const origStdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout');
  const origExit = process.exit;
  let exitCode = null;
  Object.defineProperty(process, 'stdout', { value: sink, configurable: true, writable: true });
  process.exit = (code) => { exitCode = code; };
  try {
    await runValidate(opts);
  } finally {
    if (origStdoutDescriptor) Object.defineProperty(process, 'stdout', origStdoutDescriptor);
    process.exit = origExit;
  }
  return { stdout: Buffer.concat(captured).toString('utf8'), exitCode };
}

describe('runValidate() — JSON output', () => {
  test('returns structured JSON with passed/failed/results', async () => {
    const { stdout, exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 0, 'should exit 0 on success');
    const parsed = JSON.parse(stdout);
    assert.equal(typeof parsed.passed, 'number');
    assert.equal(typeof parsed.failed, 'number');
    assert.ok(Array.isArray(parsed.results));
    assert.ok(parsed.results.length >= 18, 'expected at least 18 checks');
    for (const r of parsed.results) {
      assert.ok(typeof r.name === 'string');
      assert.ok(typeof r.ok === 'boolean');
      assert.ok(typeof r.message === 'string');
    }
  });

  test('fails on missing team command', async () => {
    rmSync(join(workDir, 'commands', 'team.md'));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1, 'should exit 1 on team-command-present failure');
  });

  test('fails on missing test command', async () => {
    rmSync(join(workDir, 'commands', 'test.md'));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1);
  });

  test('fails on missing validate command', async () => {
    rmSync(join(workDir, 'commands', 'validate.md'));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1);
  });

  test('fails on missing agent file', async () => {
    rmSync(join(workDir, 'agents', 'mimir.md'));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1);
  });

  test('fails when cline.json missing', async () => {
    rmSync(join(workDir, 'cline.json'));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1);
  });

  test('fails when enableAgentTeams is false in clineruntime.ts', async () => {
    writeFileSync(
      join(workDir, 'plugins', 'bizar', 'src', 'clineruntime.ts'),
      'export class ClineRuntime { config = { enableAgentTeams: false }; }\n',
    );
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1, 'should fail when enableAgentTeams is false');
  });

  test('fails when provider config is missing', async () => {
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    delete cfg.provider;
    writeFileSync(join(workDir, 'cline.json'), JSON.stringify(cfg, null, 2));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 1);
  });

  test('passes when only 9router is configured (no minimax)', async () => {
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    delete cfg.provider.minimax;
    writeFileSync(join(workDir, 'cline.json'), JSON.stringify(cfg, null, 2));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 0);
  });

  test('passes when only minimax is configured (no 9router)', async () => {
    const cfg = JSON.parse(readFileSync(join(workDir, 'cline.json'), 'utf8'));
    delete cfg.provider['9router'];
    writeFileSync(join(workDir, 'cline.json'), JSON.stringify(cfg, null, 2));
    const { exitCode } = await captureRun({ json: true });
    assert.equal(exitCode, 0);
  });

  test('default mode is lenient on 9router-unreachable', async () => {
    const { stdout, exitCode } = await captureRun({ json: true });
    const parsed = JSON.parse(stdout);
    const nineR = parsed.results.find((r) => r.name === '9router-reachable');
    assert.ok(nineR, '9router-reachable check should be present');
    if (!nineR.ok) {
      // 9router is not running. Default mode must be lenient.
      assert.equal(exitCode, 0, 'default mode should be lenient when 9router is down');
    } else {
      // 9router is running (some test envs have it). Just confirm the
      // check is in the list and exit code is sane.
      assert.equal(exitCode, 0, 'expected exit 0 when all critical checks pass');
    }
  });

  test('--strict fails when 9router is unreachable', async () => {
    // We can't easily kill 9router in a test, but we can prove that
    // --strict mode would fail if 9router were down: set NINEROUTER_URL
    // to a port nothing is listening on.
    const origUrl = process.env.NINEROUTER_URL;
    process.env.NINEROUTER_URL = 'http://127.0.0.1:1';  // nothing here
    try {
      const { exitCode } = await captureRun({ json: true, strict: true });
      assert.equal(exitCode, 1, 'strict mode should fail when 9router is unreachable');
    } finally {
      if (origUrl === undefined) delete process.env.NINEROUTER_URL;
      else process.env.NINEROUTER_URL = origUrl;
    }
  });

  test('--only filters to a single check', async () => {
    const { stdout, exitCode } = await captureRun({ json: true, only: 'team-command-present' });
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].name, 'team-command-present');
    assert.equal(parsed.results[0].ok, true);
  });

  test('--only on a missing file fails with exit 1', async () => {
    rmSync(join(workDir, 'commands', 'team.md'));
    const { exitCode } = await captureRun({ json: true, only: 'team-command-present' });
    assert.equal(exitCode, 1);
  });

  test('--only with an unknown name exits 2', async () => {
    const { exitCode } = await captureRun({ json: true, only: 'this-does-not-exist' });
    assert.equal(exitCode, 2);
  });
});
