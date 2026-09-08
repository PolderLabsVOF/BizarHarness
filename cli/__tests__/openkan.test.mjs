import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test, { afterEach } from 'node:test';

import {
  OpenKanError,
  OPENKAN_NPM_PACKAGE,
  installOpenKanAgent,
  installOpenKanCommandShims,
  installOpenKanPromise,
  installedOpenKanSupportsLegacyBin,
  readInstalledOpenKanVersion,
  readOpenKanJson,
  resolveOpenKanHome,
  resolveOpenKanDashboard,
  resolveOpenKanOk,
  runOpenKanOk,
} from '../openkan.mjs';
import { listOpenKanGoals, listOpenKanPlans, listOpenKanTasks, ownerOfOpenKanPath } from '../openkan-store.mjs';

const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(join(home, 'bin'), { recursive: true });
  const launcher = join(home, 'bin', 'ok.mjs');
  writeFileSync(launcher, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--json')) console.log(JSON.stringify({ args }));
else console.log('ok ' + args.join(' '));
`);
  chmodSync(launcher, 0o755);
  return { root, home, launcher };
}

test('OpenKan command bridge resolves a configured launcher and preserves arguments', () => {
  const { root, home, launcher } = fixture();
  assert.equal(resolveOpenKanOk({ cwd: root, home }), launcher);
  const result = runOpenKanOk(['task', 'list'], { cwd: root, home });
  assert.equal(result.ok, true);
  assert.match(result.stdout, /ok task list/);
  assert.deepEqual(readOpenKanJson(['task', 'list'], { cwd: root, home }), { args: ['task', 'list', '--json'] });
});

test('OpenKan command bridge gives an actionable error when absent', () => {
  const { root } = fixture();
  assert.throws(() => resolveOpenKanOk({ cwd: root, openkanBin: join(root, 'missing') }), (error) =>
    error instanceof OpenKanError && error.code === 'OPENKAN_NOT_FOUND');
});

test('OpenKan store reads tasks, plans, goals and sibling scopes from .ok', () => {
  const { root } = fixture();
  const dir = join(root, '.ok');
  mkdirSync(join(dir, 'tasks', 'tsk-a'), { recursive: true });
  mkdirSync(join(dir, 'plans'), { recursive: true });
  mkdirSync(join(dir, 'prds'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'tsk-a', 'task.json'), JSON.stringify({ schema: 'ok.task.v2', id: 'tsk-a', status: 'in_progress', owner: 'alice', scopes: ['cli/**'] }));
  writeFileSync(join(dir, 'plans', 'pln-a.json'), JSON.stringify({ schema: 'ok.plan.v1', id: 'pln-a' }));
  writeFileSync(join(dir, 'prds', 'prd-a.json'), JSON.stringify({ schema: 'ok.prd.v1', id: 'prd-a', goals: [] }));
  assert.equal(listOpenKanTasks(root).length, 1);
  assert.equal(listOpenKanPlans(root).length, 1);
  assert.equal(listOpenKanGoals(root).length, 1);
  assert.deepEqual(ownerOfOpenKanPath({ root, filePath: join(root, 'cli', 'bin.mjs') }), {
    taskId: 'tsk-a', owner: 'alice', scope: 'cli/**', path: 'cli/bin.mjs',
  });
});

test('Bizar task aliases the OpenKan task lifecycle', () => {
  const { root, home } = fixture();
  const bin = new URL('../bin.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [bin, 'task', 'list'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BIZAR_SKIP_BUILD: '1', BIZAR_OPENKAN_HOME: home },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ok task list/);
});

test('provisioner treats OpenKan as a default runtime without mutating in dry-run', async () => {
  const { ensureOpenKanRuntime } = await import('../provision.mjs');
  const previous = process.env.BIZAR_OPENKAN_BIN;
  process.env.BIZAR_OPENKAN_BIN = '/definitely/missing/openkan';
  try {
    const result = await ensureOpenKanRuntime({ dryRun: true });
    assert.equal(result.ok, true);
    assert.match(result.message, /would install OpenKan natively/);
  } finally {
    if (previous === undefined) delete process.env.BIZAR_OPENKAN_BIN;
    else process.env.BIZAR_OPENKAN_BIN = previous;
  }
});

test('provisioner repairs native OpenKan commands for an already-installed runtime', async () => {
  const { home } = fixture();
  const packageBin = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  mkdirSync(packageBin, { recursive: true });
  writeFileSync(join(packageBin, 'ok.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(join(packageBin, 'openkan.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(join(home, 'node_modules', '@polderlabs', 'openkan', 'package.json'), JSON.stringify({ version: 'test' }));
  const userHome = mkdtempSync(join(tmpdir(), 'bizar-openkan-user-'));
  roots.push(userHome);
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = userHome;
    const { ensureOpenKanRuntime } = await import('../provision.mjs');
    const result = await ensureOpenKanRuntime({ home });
    assert.equal(result.ok, true);
    assert.equal(result.installed, false);
    assert.equal(existsSync(join(userHome, '.local', 'bin', 'ok')), true);
    assert.equal(existsSync(join(userHome, '.local', 'bin', 'openkan')), true);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

// ── npm installer tests ────────────────────────────────────────────────────

/**
 * Stage a fake npm-installed OpenKan under <home>. Mimics the layout that
 * `npm install --prefix <home> @polderlabs/openkan@latest` produces:
 *   <home>/node_modules/@polderlabs/openkan/bin/ok.mjs
 *   <home>/node_modules/@polderlabs/openkan/package.json
 *   <home>/.installed-version
 */
function stageFakeOpenKan(home, version = '0.4.2-test') {
  const pkgBin = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  const pkgRoot = join(home, 'node_modules', '@polderlabs', 'openkan');
  mkdirSync(pkgBin, { recursive: true });
  const launcher = join(pkgBin, 'ok.mjs');
  writeFileSync(launcher, '#!/usr/bin/env node\nconsole.log("ok");\n');
  chmodSync(launcher, 0o755);
  writeFileSync(
    join(pkgRoot, 'package.json'),
    JSON.stringify({ name: OPENKAN_NPM_PACKAGE, version, bin: { ok: launcher } }),
  );
  writeFileSync(join(home, '.installed-version'), `${version}\n`);
  return { launcher, version };
}

test('resolveOpenKanOk discovers the npm-installed launcher at node_modules/@polderlabs/openkan/bin/ok.mjs', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  const { launcher } = stageFakeOpenKan(home);
  assert.equal(resolveOpenKanOk({ cwd: home, home }), launcher);
});

test('managed npm installation is discoverable without BIZAR_OPENKAN_HOME', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-managed-'));
  roots.push(root);
  const home = join(root, 'openkan');
  const { launcher } = stageFakeOpenKan(home);
  const previousHome = process.env.BIZAR_OPENKAN_HOME;
  const previousBizarHome = process.env.BIZAR_HOME;
  process.env.BIZAR_HOME = root;
  delete process.env.BIZAR_OPENKAN_HOME;
  try {
    assert.equal(resolveOpenKanOk({ cwd: root }), launcher);
  } finally {
    if (previousHome === undefined) delete process.env.BIZAR_OPENKAN_HOME;
    else process.env.BIZAR_OPENKAN_HOME = previousHome;
    if (previousBizarHome === undefined) delete process.env.BIZAR_HOME;
    else process.env.BIZAR_HOME = previousBizarHome;
  }
});

test('managed npm installation exposes the dashboard launcher', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-dashboard-'));
  roots.push(home);
  const packageRoot = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  mkdirSync(packageRoot, { recursive: true });
  const dashboard = join(packageRoot, 'openkan.mjs');
  writeFileSync(dashboard, '#!/usr/bin/env node\n');
  assert.equal(resolveOpenKanDashboard({ home }), dashboard);
});

test('OpenKan package-owned agent installer is run with the configured Claude directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-agent-'));
  roots.push(root);
  const home = join(root, 'openkan');
  const packageBin = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  const claudeDir = join(root, 'claude');
  mkdirSync(packageBin, { recursive: true });
  writeFileSync(join(packageBin, 'install-agent.mjs'), `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    mkdirSync(join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'openkan'), { recursive: true });
    writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'openkan', 'SKILL.md'), '# openkan\\n');
  `);
  const result = installOpenKanAgent({ home, cwd: root, env: { CLAUDE_CONFIG_DIR: claudeDir, HOME: root } });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined);
  assert.equal(existsSync(join(claudeDir, 'skills', 'openkan', 'SKILL.md')), true);
});

test('OpenKan native command shims expose ok and openkan to agent shells', () => {
  const { root, home } = fixture();
  const packageBin = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  mkdirSync(packageBin, { recursive: true });
  writeFileSync(join(packageBin, 'ok.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(join(packageBin, 'openkan.mjs'), '#!/usr/bin/env node\n');
  const env = { ...process.env, HOME: join(root, 'user-home') };
  mkdirSync(join(root, 'old-openkan', 'bin'), { recursive: true });
  const oldOpenKan = join(root, 'old-openkan', 'bin', 'openkan.mjs');
  writeFileSync(oldOpenKan, '#!/usr/bin/env node\n');
  mkdirSync(join(env.HOME, '.local', 'bin'), { recursive: true });
  symlinkSync(oldOpenKan, join(env.HOME, '.local', 'bin', 'openkan'));
  const result = installOpenKanCommandShims({ home, env });
  assert.equal(result.ok, true);
  assert.equal(result.installed.length, 2);
  assert.equal(existsSync(join(env.HOME, '.local', 'bin', 'ok')), true);
  assert.equal(existsSync(join(env.HOME, '.local', 'bin', 'openkan')), true);
  assert.equal(realpathSync(join(env.HOME, '.local', 'bin', 'openkan')), realpathSync(join(packageBin, 'openkan.mjs')));
});

test('OpenKan v0.5.0+ removes the legacy `openkan` shim and installs only `ok`', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-v050-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(home, { recursive: true });
  // Stage v0.5.0 with only `ok.mjs` shipped (the legacy `openkan.mjs` is gone).
  stageFakeOpenKan(home, '0.5.0');
  const env = { ...process.env, HOME: join(root, 'user-home') };
  // Pre-stage a stale `openkan` shim from a previous < v0.5.0 install so we
  // can prove the upgrader removes it.
  mkdirSync(join(env.HOME, '.local', 'bin'), { recursive: true });
  const stale = join(env.HOME, '.local', 'bin', 'openkan');
  writeFileSync(stale, '#!/usr/bin/env node\necho stale\n');
  chmodSync(stale, 0o755);
  const result = installOpenKanCommandShims({ home, env });
  assert.equal(result.ok, true);
  // `ok` is installed; the legacy `openkan` shim is retired.
  assert.equal(existsSync(join(env.HOME, '.local', 'bin', 'ok')), true);
  assert.equal(existsSync(stale), false, 'stale openkan shim should be removed');
  assert.equal(result.installed.length, 1);
  assert.equal(result.installed[0].name, 'ok');
  assert.equal(result.retired.length, 1);
  assert.equal(result.retired[0].name, 'openkan');
});

test('OpenKan v0.5.0+ dashboard resolution falls back to the `ok` launcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-dashboard-v050-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(home, { recursive: true });
  const { launcher } = stageFakeOpenKan(home, '0.5.1');
  const resolved = resolveOpenKanDashboard({ home });
  assert.equal(resolved, launcher);
  assert.match(resolved, /ok\.mjs$/);
});

test('OpenKan < v0.5.0 dashboard resolution still requires the legacy `openkan.mjs`', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-openkan-dashboard-v040-'));
  roots.push(root);
  const home = join(root, 'openkan');
  mkdirSync(home, { recursive: true });
  // Stage v0.4.x with both `ok.mjs` and `openkan.mjs`; resolution must
  // still return the legacy dashboard launcher.
  stageFakeOpenKan(home, '0.4.9');
  const packageBin = join(home, 'node_modules', '@polderlabs', 'openkan', 'bin');
  const legacyDashboard = join(packageBin, 'openkan.mjs');
  writeFileSync(legacyDashboard, '#!/usr/bin/env node\n');
  assert.equal(resolveOpenKanDashboard({ home }), legacyDashboard);
});

test('resolveOpenKanOk falls back to bin/ok.mjs when the npm layout is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  mkdirSync(join(home, 'bin'), { recursive: true });
  const launcher = join(home, 'bin', 'ok.mjs');
  writeFileSync(launcher, '#!/usr/bin/env node\nconsole.log("ok");\n');
  chmodSync(launcher, 0o755);
  assert.equal(resolveOpenKanOk({ cwd: home, home }), launcher);
});

test('resolveOpenKanOk errors clearly when no launcher is present', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  assert.throws(
    () => resolveOpenKanOk({ cwd: home, home }),
    (error) => error instanceof OpenKanError && error.code === 'OPENKAN_NOT_FOUND',
  );
});

test('readInstalledOpenKanVersion returns null when no marker is present', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  assert.equal(readInstalledOpenKanVersion(home), null);
});

test('readInstalledOpenKanVersion returns the trimmed version from the marker', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  stageFakeOpenKan(home, '0.4.2-fixture');
  assert.equal(readInstalledOpenKanVersion(home), '0.4.2-fixture');
});

test('installedOpenKanSupportsLegacyBin honours the v0.5.0 boundary', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  // No marker: stay conservative and keep the legacy shim path.
  assert.equal(installedOpenKanSupportsLegacyBin(home), true);
  stageFakeOpenKan(home, '0.4.9');
  assert.equal(installedOpenKanSupportsLegacyBin(home), true);
  stageFakeOpenKan(home, '0.5.0');
  assert.equal(installedOpenKanSupportsLegacyBin(home), false);
  stageFakeOpenKan(home, '0.5.1');
  assert.equal(installedOpenKanSupportsLegacyBin(home), false);
  stageFakeOpenKan(home, '1.0.0-rc.1');
  assert.equal(installedOpenKanSupportsLegacyBin(home), false);
});

test('installOpenKanPromise skips the network and returns the staged version when skipNpmInstall is set', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  const { launcher, version } = stageFakeOpenKan(home);
  const result = await installOpenKanPromise({ home, skipNpmInstall: true, env: { ...process.env, HOME: join(home, 'user-home') } });
  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.equal(result.skipped, true);
  assert.equal(result.version, version);
  assert.equal(result.launcher, launcher);
});

test('installOpenKanPromise errors clearly when skipNpmInstall is set but no version marker is present', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  await assert.rejects(
    () => installOpenKanPromise({ home, skipNpmInstall: true }),
    (error) => error instanceof OpenKanError && error.code === 'OPENKAN_SKIP_BUT_MISSING',
  );
});

test('installOpenKanPromise respects BIZAR_SKIP_OPENKAN_NPM_INSTALL when a marker exists', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  const { version } = stageFakeOpenKan(home, '0.4.2-ci');
  const previous = process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL;
  process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL = '1';
  try {
    const result = await installOpenKanPromise({ home, env: { ...process.env, HOME: join(home, 'user-home') } });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.version, version);
  } finally {
    if (previous === undefined) delete process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL;
    else process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL = previous;
  }
});

test('installOpenKanPromise surfaces an actionable error when the npm subprocess fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-npm-'));
  roots.push(home);
  const previous = process.env.BIZAR_OPENKAN_TEST_FAIL_NPM;
  process.env.BIZAR_OPENKAN_TEST_FAIL_NPM = '1';
  try {
    await assert.rejects(
      () => installOpenKanPromise({ home, packageSpec: 'this-package-definitely-does-not-exist@99.99.99' }),
      (error) => error instanceof OpenKanError && error.code === 'OPENKAN_NPM_INSTALL_FAILED',
    );
  } finally {
    if (previous === undefined) delete process.env.BIZAR_OPENKAN_TEST_FAIL_NPM;
    else process.env.BIZAR_OPENKAN_TEST_FAIL_NPM = previous;
  }
});

test('resolveOpenKanHome honours BIZAR_OPENKAN_HOME before the default', () => {
  const previous = process.env.BIZAR_OPENKAN_HOME;
  process.env.BIZAR_OPENKAN_HOME = '/tmp/bizar-ok-test';
  try {
    assert.equal(resolveOpenKanHome(), '/tmp/bizar-ok-test');
    assert.equal(resolveOpenKanHome({ home: '/tmp/override' }), '/tmp/override');
  } finally {
    if (previous === undefined) delete process.env.BIZAR_OPENKAN_HOME;
    else process.env.BIZAR_OPENKAN_HOME = previous;
  }
});

test('native installer no longer pipes a remote shell script (regression: curl|bash removed)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../openkan.mjs', import.meta.url));
  const src = readFileSync(path, 'utf8');
  // The legacy installer piped openkan/main/install.sh to bash. The native
  // replacement must not contain that URL or any `bash -s --` invocation.
  assert.equal(src.includes('raw.githubusercontent.com/PolderLabsVOF/openkan/main/install.sh'), false,
    'cli/openkan.mjs must not reference the legacy install.sh URL');
  assert.equal(/bash\s+-s\s+--/.test(src), false,
    'cli/openkan.mjs must not pipe anything into `bash -s --`');
  assert.equal(src.includes("spawnSync('curl'"), false,
    'cli/openkan.mjs must not shell out to curl');
});
