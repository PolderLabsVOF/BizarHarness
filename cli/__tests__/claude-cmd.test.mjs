import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstalledAgent } from '../commands/claude-cmd.mjs';
import { REQUIRED_COMMANDS } from '../commands/validate.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

test('subagent aliases resolve by frontmatter name, not only filename', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-agent-alias-'));
  try {
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(join(root, 'agents', 'senior-engineer.md'), '---\nname: todd\ndescription: test\n---\n');
    assert.equal(resolveInstalledAgent('todd', root), join(root, 'agents', 'senior-engineer.md'));
    assert.equal(resolveInstalledAgent('missing', root), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deep-interview is registered in the slash-command namespace and shipped on disk', () => {
  // Mirror the ralph / bizplan / autopilot registration: REQUIRED_COMMANDS
  // is the canonical slash-command namespace allowlist that validate.mjs
  // checks on every install. Both project (/deep-interview) and shared
  // (/bizar-harness:deep-interview) namespace entries must be present.
  assert.ok(
    REQUIRED_COMMANDS.includes('deep-interview.md'),
    'validate.mjs REQUIRED_COMMANDS must include deep-interview.md (mirror of ralph / bizplan registration)',
  );

  const commandPath = join(repoRoot, 'config', 'claude', 'commands', 'deep-interview.md');
  const skillPath = join(repoRoot, 'config', 'skills', 'deep-interview', 'SKILL.md');
  const mirrorPath = join(repoRoot, 'config', 'claude', 'skills', 'deep-interview', 'SKILL.md');

  assert.ok(existsSync(commandPath), `missing slash command at ${commandPath}`);
  assert.ok(existsSync(skillPath), `missing skill at ${skillPath}`);
  // The mirror at config/claude/skills/ is produced by `make sync-skills-mirror`;
  // if the gate has not been run yet, skip the byte-equality assertion but still
  // verify the canonical skill file is structurally sound.
  const mirrorExists = existsSync(mirrorPath);
  const skillText = readFileSync(skillPath, 'utf8');
  if (mirrorExists) {
    assert.equal(
      readFileSync(mirrorPath, 'utf8'),
      skillText,
      'deep-interview skill mirror must be byte-identical to the canonical source',
    );
  }
  const commandText = readFileSync(commandPath, 'utf8');

  // Slash command is a thin Skill-tool wrapper that wires both namespaces.
  assert.match(commandText, /allowed-tools: Skill/);
  assert.match(commandText, /Invoke the Skill tool exactly once/);
  assert.match(commandText, /bizar-harness:deep-interview/);
  assert.match(commandText, /select the installed `deep-interview` skill/);
  assert.match(commandText, /Pass `\$ARGUMENTS` unchanged/);
  assert.ok(commandText.length < 600, 'deep-interview command must not duplicate its skill');

  // Skill frontmatter matches the directory name and is well-formed.
  assert.match(skillText, /^---\nname: deep-interview\n/);
  assert.match(skillText, /description:/);
  assert.match(skillText, /AmbiguityScore/);
  assert.match(skillText, /Dialectic rhythm guard|Dialectic Rhythm Guard/);
  assert.match(skillText, /docs\/specs\/deep-interview-<slug>\.md/);
});

test('bizplan replaces /ralplan and /plan in the slash-command namespace', () => {
  // Per bizplan-overhaul charter subtask 8 (arch-tests-cleanup):
  // REQUIRED_COMMANDS must contain bizplan (and its tier variants) and
  // must NOT contain the legacy ralplan.md or plan.md entries.
  assert.ok(
    REQUIRED_COMMANDS.includes('bizplan.md'),
    'validate.mjs REQUIRED_COMMANDS must include bizplan.md',
  );
  assert.ok(
    REQUIRED_COMMANDS.includes('bizplan-light.md'),
    'validate.mjs REQUIRED_COMMANDS must include bizplan-light.md (tier-specific slash command)',
  );
  assert.ok(
    REQUIRED_COMMANDS.includes('bizplan-heavy.md'),
    'validate.mjs REQUIRED_COMMANDS must include bizplan-heavy.md (tier-specific slash command)',
  );
  assert.ok(
    !REQUIRED_COMMANDS.includes('ralplan.md'),
    'REQUIRED_COMMANDS must not include legacy ralplan.md (replaced by bizplan)',
  );
  assert.ok(
    !REQUIRED_COMMANDS.includes('plan.md'),
    'REQUIRED_COMMANDS must not include legacy plan.md (replaced by bizplan)',
  );
});
