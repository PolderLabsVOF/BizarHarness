/**
 * mod-instructions.node.test.mjs — Node-compatible test runner.
 *
 * Bun's homedir() doesn't pick up process.env.HOME changes at import
 * time, so we run this suite with `node --test` instead, where env
 * overrides work as expected.
 *
 * Run with:  node --test tests/mod-instructions.node.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// ── Sandbox HOME before importing the loader ─────────────────────
const SANDBOX_HOME = join(tmpdir(), `bizar-mod-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.HOME = SANDBOX_HOME;
process.env.XDG_CONFIG_HOME = join(SANDBOX_HOME, '.config');

const REPO = resolve(import.meta.dirname, '..');
const LOADER = join(REPO, 'src/server/mods-loader.mjs');
// Import AFTER HOME is set so the loader resolves constants correctly.
const loaderModule = await import(LOADER);
const { modsLoader } = loaderModule;

const TEST_MOD_ID = 'testmod';

function buildTestMod() {
  const modDir = join(SANDBOX_HOME, '.config/bizar/mods', TEST_MOD_ID);
  rmSync(modDir, { recursive: true, force: true });
  mkdirSync(modDir, { recursive: true });
  writeFileSync(join(modDir, 'mod.json'), JSON.stringify({
    id: TEST_MOD_ID,
    name: 'Test Mod',
    version: '1.0.0',
    description: 'A test mod for the instructions installer.',
    permissions: [],
  }, null, 2));
  mkdirSync(join(modDir, 'agents'), { recursive: true });
  writeFileSync(join(modDir, 'agents', 'thor.md'), '---\ndescription: test thor\n---\n# Thor override\n');
  writeFileSync(join(modDir, 'agents', 'tyr.md'), '---\ndescription: test tyr\n---\n# Tyr override\n');
  mkdirSync(join(modDir, 'commands'), { recursive: true });
  writeFileSync(join(modDir, 'commands', 'plan.md'), '---\ndescription: test plan\n---\n# Plan command\n');
  writeFileSync(join(modDir, 'INSTRUCTIONS.md'), '---\nname: test-instructions\n---\n# Test instructions\n');
  mkdirSync(join(modDir, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(modDir, 'skills', 'my-skill', 'SKILL.md'), '---\nname: test-my-skill\n---\n# My skill\n');
  return modDir;
}

before(() => {
  mkdirSync(join(SANDBOX_HOME, '.config/opencode/agents'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.config/opencode/commands'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.opencode/skills'), { recursive: true });
  mkdirSync(join(SANDBOX_HOME, '.config/bizar/mods'), { recursive: true });
});

after(() => {
  try {
    rmSync(SANDBOX_HOME, { recursive: true, force: true });
  } catch { /* ignore */ }
  process.env.HOME = homedir();
  delete process.env.XDG_CONFIG_HOME;
});

describe('mod instructions install/uninstall', () => {
  it('installs agents, commands, INSTRUCTIONS, and skills with the right prefixes', () => {
    const modDir = buildTestMod();
    const counts = modsLoader.reinstallInstructions(TEST_MOD_ID);
    assert.equal(counts.agents, 2);
    assert.equal(counts.commands, 1);
    assert.equal(counts.instructions, 1);
    assert.equal(counts.skills, 1);

    const agentsDir = join(SANDBOX_HOME, '.config/opencode/agents');
    assert.ok(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.md`)));
    assert.ok(existsSync(join(agentsDir, `${TEST_MOD_ID}__tyr.md`)));
    assert.equal(existsSync(join(agentsDir, 'thor.md')), false);

    const commandsDir = join(SANDBOX_HOME, '.config/opencode/commands');
    assert.ok(existsSync(join(commandsDir, `${TEST_MOD_ID}__plan.md`)));

    const skillsDir = join(SANDBOX_HOME, '.opencode/skills');
    assert.ok(existsSync(join(skillsDir, `${TEST_MOD_ID}-instructions`, 'SKILL.md')));
    assert.ok(existsSync(join(skillsDir, `${TEST_MOD_ID}-my-skill`, 'SKILL.md')));

    rmSync(modDir, { recursive: true, force: true });
  });

  it('does not touch files installed by other mods or base agents', () => {
    const modDir = buildTestMod();
    const agentsDir = join(SANDBOX_HOME, '.config/opencode/agents');
    writeFileSync(join(agentsDir, 'othermod__thor.md'), '# othermod thor');
    writeFileSync(join(agentsDir, 'odin.md'), '# base odin');

    const counts = modsLoader.reinstallInstructions(TEST_MOD_ID);
    assert.equal(counts.agents, 2);
    assert.ok(existsSync(join(agentsDir, 'othermod__thor.md')));
    assert.ok(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.md`)));
    assert.ok(existsSync(join(agentsDir, 'odin.md')));

    rmSync(modDir, { recursive: true, force: true });
    try { rmSync(join(agentsDir, 'othermod__thor.md')); } catch { /* ignore */ }
    try { rmSync(join(agentsDir, 'odin.md')); } catch { /* ignore */ }
  });

  it('uninstall removes only what this mod installed', () => {
    const modDir = buildTestMod();
    modsLoader.reinstallInstructions(TEST_MOD_ID);

    const agentsDir = join(SANDBOX_HOME, '.config/opencode/agents');
    writeFileSync(join(agentsDir, 'othermod__thor.md'), '# othermod');
    writeFileSync(join(agentsDir, 'odin.md'), '# base odin');

    const ok = modsLoader.uninstall(TEST_MOD_ID);
    assert.equal(ok, true);

    assert.equal(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.md`)), false);
    assert.equal(existsSync(join(agentsDir, `${TEST_MOD_ID}__tyr.md`)), false);
    const commandsDir = join(SANDBOX_HOME, '.config/opencode/commands');
    assert.equal(existsSync(join(commandsDir, `${TEST_MOD_ID}__plan.md`)), false);
    const skillsDir = join(SANDBOX_HOME, '.opencode/skills');
    assert.equal(existsSync(join(skillsDir, `${TEST_MOD_ID}-instructions`)), false);
    assert.equal(existsSync(join(skillsDir, `${TEST_MOD_ID}-my-skill`)), false);

    assert.ok(existsSync(join(agentsDir, 'othermod__thor.md')));
    assert.ok(existsSync(join(agentsDir, 'odin.md')));

    try { rmSync(join(agentsDir, 'othermod__thor.md')); } catch { /* ignore */ }
    try { rmSync(join(agentsDir, 'odin.md')); } catch { /* ignore */ }
  });

  it('install/uninstall round-trips cleanly', () => {
    for (let i = 0; i < 2; i++) {
      const modDir = buildTestMod();
      const agentsDir = join(SANDBOX_HOME, '.config/opencode/agents');

      const counts = modsLoader.reinstallInstructions(TEST_MOD_ID);
      assert.equal(counts.agents, 2);
      assert.ok(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.md`)));

      modsLoader.uninstall(TEST_MOD_ID);

      assert.equal(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.md`)), false);
      assert.equal(existsSync(modDir), false);
    }
  });

  it('listModInstructions reports exactly the files this mod installed', () => {
    const modDir = buildTestMod();
    modsLoader.reinstallInstructions(TEST_MOD_ID);

    const list = modsLoader.listModInstructions(TEST_MOD_ID);
    assert.deepEqual(list.agents.sort(), [
      `${TEST_MOD_ID}__thor.md`,
      `${TEST_MOD_ID}__tyr.md`,
    ]);
    assert.deepEqual(list.commands, [`${TEST_MOD_ID}__plan.md`]);
    assert.deepEqual(list.skills.sort(), [
      `${TEST_MOD_ID}-instructions`,
      `${TEST_MOD_ID}-my-skill`,
    ]);

    modsLoader.uninstall(TEST_MOD_ID);
  });

  it('ignores non-md files in agents/ and commands/', () => {
    const modDir = buildTestMod();
    writeFileSync(join(modDir, 'agents', 'thor.txt'), 'should not be installed');
    writeFileSync(join(modDir, 'commands', 'plan.txt'), 'should not be installed');

    const counts = modsLoader.reinstallInstructions(TEST_MOD_ID);
    assert.equal(counts.agents, 2);
    assert.equal(counts.commands, 1);

    const agentsDir = join(SANDBOX_HOME, '.config/opencode/agents');
    const commandsDir = join(SANDBOX_HOME, '.config/opencode/commands');
    assert.equal(existsSync(join(agentsDir, `${TEST_MOD_ID}__thor.txt`)), false);
    assert.equal(existsSync(join(commandsDir, `${TEST_MOD_ID}__plan.txt`)), false);

    modsLoader.uninstall(TEST_MOD_ID);
  });
});
