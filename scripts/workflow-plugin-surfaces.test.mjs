import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workflowNames = [
  'autopilot',
  'bizplan',
  'cancel',
  'ralph',
  'ultraqa',
  'ultrawork',
  'verify',
];

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

test('workflow skills have exact project mirrors and durable state commands', () => {
  for (const name of workflowNames) {
    const canonical = read(`config/skills/${name}/SKILL.md`);
    const mirror = read(`config/claude/skills/${name}/SKILL.md`);

    assert.equal(mirror, canonical, `${name} mirror must be byte-identical`);
    assert.match(canonical, new RegExp(`^---\\nname: ${name}\\n`, 'm'));
    assert.doesNotMatch(canonical, /disable-model-invocation:\s*true/);
    assert.match(canonical, /bizar workflow status/);
    assert.match(canonical, /Never auto-commit|never auto-commit|Do not auto-commit/);
    assert.doesNotMatch(canonical, /claude daemon|tmux new-session|git push|npm publish/);
  }

  const autopilot = read('config/skills/autopilot/SKILL.md');
  assert.match(autopilot, /argument-hint: "\[--workflow <default\|plan-build-qa>\] <task or outcome>"/);
  assert.match(autopilot, /--workflow "\$WORKFLOW_PROFILE" --goal "\$TASK_GOAL"/);
  assert.match(autopilot, /If the selector is omitted, use `default`/);
  assert.match(autopilot, /--evidence "\$BOUNDED_EVIDENCE"/);
  assert.match(autopilot, /41a4c0f77144c5beb5f5f000a89cff379c680606/);

  const autopilotCommand = read('config/claude/commands/autopilot.md');
  assert.match(autopilotCommand, /argument-hint: "\[--workflow <default\|plan-build-qa>\] <task or outcome>"/);
});

test('slash commands are thin pointers to canonical workflow skills', () => {
  for (const name of workflowNames) {
    const command = read(`config/claude/commands/${name}.md`);
    assert.match(command, /allowed-tools: Skill/);
    assert.match(command, /Invoke the Skill tool exactly once/);
    assert.match(command, new RegExp(`bizar-harness:${name}`));
    assert.match(command, new RegExp('select the installed `' + name + '` skill'));
    assert.match(command, /Pass `\$ARGUMENTS` unchanged/);
    assert.doesNotMatch(command, /config\/skills\/|config\/claude\/skills\/|SKILL\.md/);
    assert.ok(command.length < 600, `${name} command must not duplicate its skill`);
  }
});

test('plugin hook manifest uses only the shipped cache-relative runner', () => {
  const manifest = JSON.parse(read('hooks/hooks.json'));
  const expectedEvents = [
    'PermissionRequest',
    'PostToolUse',
    'PostToolUseFailure',
    'PreCompact',
    'PreToolUse',
    'SessionEnd',
    'SessionStart',
    'Stop',
    'SubagentStart',
    'SubagentStop',
    'UserPromptSubmit',
  ];

  assert.deepEqual(Object.keys(manifest.hooks).sort(), expectedEvents);
  for (const groups of Object.values(manifest.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, 'command');
        assert.match(
          hook.command,
          /^"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/plugin-hook-runner\.cjs" [a-z]+(?:-[a-z]+)*$/,
        );
        assert.doesNotMatch(hook.command, /(^|\s)bizar(\s|$)|CLAUDE_PROJECT_DIR/);
        assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0);
      }
    }
  }
});

test('plugin hook runner preserves event, stdio, and exit without global bizar', (t) => {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'bizar-plugin-cache-'));
  t.after(() => rmSync(cacheRoot, { recursive: true, force: true }));
  mkdirSync(join(cacheRoot, 'scripts'), { recursive: true });
  mkdirSync(join(cacheRoot, 'cli'), { recursive: true });
  copyFileSync(
    resolve(root, 'scripts/plugin-hook-runner.cjs'),
    join(cacheRoot, 'scripts/plugin-hook-runner.cjs'),
  );
  chmodSync(join(cacheRoot, 'scripts/plugin-hook-runner.cjs'), 0o755);
  writeFileSync(
    join(cacheRoot, 'cli/bin.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      "const input = readFileSync(0, 'utf8');",
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input }));",
      "process.stderr.write('fixture-stderr');",
      "process.exitCode = 23;",
    ].join('\n'),
  );

  const payload = JSON.stringify({ session_id: 'cache-smoke' });
  const result = spawnSync(
    process.execPath,
    [join(cacheRoot, 'scripts/plugin-hook-runner.cjs'), 'subagent-stop'],
    {
      cwd: tmpdir(),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: cacheRoot, PATH: '/path-without-bizar' },
      input: payload,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 23);
  assert.equal(result.stderr, 'fixture-stderr');
  assert.deepEqual(JSON.parse(result.stdout), {
    args: ['hook', 'subagent-stop'],
    input: payload,
  });
});

test('plugin hook runner executes the package-relative CLI without global bizar', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/plugin-hook-runner.cjs'), 'subagent-stop'],
    {
      cwd: root,
      env: {
        ...process.env,
        BIZAR_SKIP_BUILD: '1',
        CLAUDE_PLUGIN_ROOT: root,
        PATH: '/path-without-bizar',
      },
      input: JSON.stringify({ session_id: 'package-smoke' }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});
