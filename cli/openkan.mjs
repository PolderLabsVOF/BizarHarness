/**
 * OpenKan runtime boundary for Bizar.
 *
 * Bizar owns orchestration; OpenKan owns durable project planning under
 * `.ok/`. Keeping this bridge subprocess-only means Bizar never imports or
 * forks OpenKan's storage implementation, and upgrades remain independent.
 *
 * The native installer (`installOpenKanPromise`) installs the latest
 * `@polderlabs/openkan` from the public npm registry via `npm install
 * --prefix <home> @polderlabs/openkan@latest`. No remote shell script
 * ever runs on the operator's machine; the version is resolved by npm
 * itself. Each `bizar openkan install` invocation resolves the latest
 * tag at call time, so Bizar tracks upstream automatically.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveBizarHome, resolveClaudeConfigDir } from './config-paths.mjs';

export const OPENKAN_NPM_PACKAGE = '@polderlabs/openkan';
export const OPENKAN_NPM_VERSION_SPEC = 'latest';
export const OPENKAN_HOME_DEFAULT = join(homedir(), '.config', 'bizar', 'openkan');
export const OPENKAN_DEFAULT_LAUNCHER = join(
  OPENKAN_HOME_DEFAULT,
  'node_modules',
  '@polderlabs',
  'openkan',
  'bin',
  'ok.mjs',
);
export const OPENKAN_VERSION_MARKER = '.installed-version';
export const OPENKAN_INSTALL_CONFIG = 'openkan-install.json';

function nodeMajorVersion() {
  const match = process.versions.node.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Parse a semver-like string into [major, minor, patch] numeric parts.
 * Pre-release / build metadata is stripped. Returns null when the input
 * does not look like a version the caller can compare.
 */
function parseOpenKanVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

/**
 * True when the installed OpenKan version ships the legacy `openkan` binary.
 * v0.5.0 dropped the `openkan <cmd>` entry point; the `ok` CLI is the only
 * supported surface from that release forward. Callers use this to decide
 * whether to install the legacy `~/.local/bin/openkan` shim, clean up a
 * stale one, or route dashboard launches through `ok serve`.
 */
export function installedOpenKanSupportsLegacyBin(home) {
  const version = readInstalledOpenKanVersion(home);
  const parsed = parseOpenKanVersion(version);
  if (!parsed) return true; // unknown version: be conservative and keep legacy behaviour
  return parsed[0] < 0 || (parsed[0] === 0 && parsed[1] < 5);
}

export class OpenKanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OpenKanError';
    this.code = code;
    this.details = details;
  }
}

export function executableOnPath(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8', shell: false,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim().split(/\r?\n/)[0] || null;
}

function okLauncherFromOpenKanBin(bin) {
  if (!bin) return null;
  const resolved = resolve(bin);
  const candidates = [
    join(dirname(resolved), 'ok.mjs'),
    join(dirname(resolved), 'ok.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/** Resolve the OpenKan `ok` launcher without coupling Bizar to its source. */
export function resolveOpenKanOk(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const explicit = options.okBin || process.env.BIZAR_OPENKAN_OK_BIN;
  if (explicit) {
    const candidate = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(candidate)) {
      throw new OpenKanError('OPENKAN_NOT_FOUND', `BIZAR_OPENKAN_OK_BIN does not exist: ${candidate}`);
    }
    return candidate;
  }

  const configuredBin = options.openkanBin || process.env.BIZAR_OPENKAN_BIN;
  if (configuredBin) {
    if (!existsSync(configuredBin)) {
      throw new OpenKanError('OPENKAN_NOT_FOUND', `OpenKan command does not exist: ${configuredBin}`);
    }
    let canonical = configuredBin;
    try { canonical = realpathSync(configuredBin); } catch { /* preserve configured path */ }
    const launcher = okLauncherFromOpenKanBin(canonical);
    if (!launcher) {
      throw new OpenKanError(
        'OPENKAN_INCOMPLETE',
        `OpenKan at ${canonical} does not provide bin/ok.mjs. Run \`bizar openkan install\` to update it.`,
      );
    }
    return launcher;
  }

  const home = options.home || process.env.BIZAR_OPENKAN_HOME;
  if (home) {
    const candidates = [
      join(home, 'bin', 'ok.mjs'),
      join(home, 'bin', 'ok.ts'),
      join(home, 'node_modules', '@polderlabs', 'openkan', 'bin', 'ok.mjs'),
      join(home, 'node_modules', '@polderlabs', 'openkan', 'bin', 'ok.ts'),
    ];
    const candidate = candidates.find((path) => existsSync(path));
    if (candidate) return candidate;
    throw new OpenKanError(
      'OPENKAN_NOT_FOUND',
      `OpenKan launcher missing under ${resolve(home)} (expected node_modules/@polderlabs/openkan/bin/ok.mjs or bin/ok.mjs)`,
    );
  }

  // The npm prefix does not put its `ok` shim on the operator's PATH. Look
  // in Bizar's managed default home before falling back to a standalone
  // OpenKan installation. This keeps `ok task`, hooks, and MCP consumers
  // working after a plain `bizar install` without requiring shell changes.
  const managedHome = resolveOpenKanHome({ cwd });
  const managedCandidates = [
    join(managedHome, 'node_modules', '@polderlabs', 'openkan', 'bin', 'ok.mjs'),
    join(managedHome, 'node_modules', '@polderlabs', 'openkan', 'bin', 'ok.ts'),
    join(managedHome, 'bin', 'ok.mjs'),
    join(managedHome, 'bin', 'ok.ts'),
  ];
  const managedLauncher = managedCandidates.find((path) => existsSync(path));
  if (managedLauncher) return managedLauncher;

  const configuredPathBin = executableOnPath('openkan');
  if (!configuredPathBin) {
    throw new OpenKanError(
      'OPENKAN_NOT_FOUND',
      'OpenKan is required for Bizar planning. Run `bizar openkan install`, then retry.',
    );
  }
  if (!existsSync(configuredPathBin)) {
    throw new OpenKanError('OPENKAN_NOT_FOUND', `OpenKan command does not exist: ${configuredPathBin}`);
  }
  let canonical = configuredPathBin;
  try { canonical = realpathSync(configuredPathBin); } catch { /* preserve configured path */ }
  const launcher = okLauncherFromOpenKanBin(canonical);
  if (!launcher) {
    throw new OpenKanError(
      'OPENKAN_INCOMPLETE',
      `OpenKan at ${canonical} does not provide bin/ok.mjs. Run \`bizar openkan install\` to update it.`,
    );
  }
  return launcher;
}

function openKanPackageRoot(home) {
  return join(home, 'node_modules', '@polderlabs', 'openkan');
}

/** Resolve OpenKan's dashboard launcher from the managed npm install. */
export function resolveOpenKanDashboard(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const explicitHome = options.home || process.env.BIZAR_OPENKAN_HOME;
  const home = explicitHome ? resolve(explicitHome) : resolveOpenKanHome({ cwd });
  const legacySupported = installedOpenKanSupportsLegacyBin(home);
  if (legacySupported) {
    const managed = join(openKanPackageRoot(home), 'bin', 'openkan.mjs');
    if (existsSync(managed)) return managed;
    const legacy = join(home, 'bin', 'openkan.mjs');
    if (existsSync(legacy)) return legacy;
    const configuredBin = options.openkanBin || process.env.BIZAR_OPENKAN_BIN || executableOnPath('openkan');
    if (configuredBin && existsSync(configuredBin)) return configuredBin;
    throw new OpenKanError('OPENKAN_NOT_FOUND', 'OpenKan is required. Run `bizar openkan install`.');
  }
  // OpenKan v0.5.0+ drops the legacy `openkan` binary; the dashboard is
  // served via `ok serve`. Always route to the `ok` launcher.
  return resolveOpenKanOk({ cwd, home });
}

function nodeArgs(launcher, args) {
  return launcher.endsWith('.ts')
    ? ['--experimental-strip-types', launcher, ...args]
    : [launcher, ...args];
}

export function runOpenKanOk(args, options = {}) {
  const launcher = resolveOpenKanOk(options);
  const result = spawnSync(process.execPath, nodeArgs(launcher, args), {
    cwd: resolve(options.cwd || process.cwd()),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
  });
  if (result.error) {
    throw new OpenKanError('OPENKAN_EXEC_FAILED', result.error.message, { cause: result.error });
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    launcher,
  };
}

/** Confirm the resolved launcher can load its dependencies without mutating a workspace. */
export function verifyOpenKanRuntime(options = {}) {
  const result = runOpenKanOk(['--help'], options);
  if (!result.ok) {
    throw new OpenKanError(
      'OPENKAN_INCOMPLETE',
      result.stderr.trim() || result.stdout.trim() || 'OpenKan launcher could not start',
    );
  }
  return result;
}

export function ensureOpenKanProject(options = {}) {
  const result = runOpenKanOk(['init'], options);
  if (!result.ok) {
    throw new OpenKanError('OPENKAN_INIT_FAILED', result.stderr.trim() || result.stdout.trim() || 'OpenKan init failed');
  }
  return result;
}

export function readOpenKanJson(args, options = {}) {
  const result = runOpenKanOk([...args, '--json'], options);
  if (!result.ok) {
    throw new OpenKanError('OPENKAN_COMMAND_FAILED', result.stderr.trim() || result.stdout.trim() || `ok ${args.join(' ')} failed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new OpenKanError('OPENKAN_INVALID_JSON', `OpenKan returned invalid JSON for ok ${args.join(' ')}`, { cause: error });
  }
}

/** Install OpenKan only on the explicit `bizar openkan install` path. */
export function installOpenKan(options = {}) {
  throw new OpenKanError(
    'OPENKAN_INSTALL_SYNC_REJECTED',
    'installOpenKan is async; use installOpenKanNative (or await installOpenKanPromise).',
  );
}

/** Read the installed OpenKan version marker from the home directory, if any. */
export function readInstalledOpenKanVersion(home) {
  const installHome = home ? resolve(home) : resolveOpenKanHome();
  const marker = join(installHome, OPENKAN_VERSION_MARKER);
  if (!existsSync(marker)) return null;
  try {
    return readFileSync(marker, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Resolve the default install root for the native installer. */
export function resolveOpenKanHome(options = {}) {
  const env = options.env || process.env;
  if (options.home) return resolve(options.home);
  if (env.BIZAR_OPENKAN_HOME) return resolve(env.BIZAR_OPENKAN_HOME);
  const cwd = options.cwd || process.cwd();
  const configRoot = resolveBizarHome({ env, cwd });
  const configPath = join(configRoot, OPENKAN_INSTALL_CONFIG);
  if (existsSync(configPath)) {
    try {
      const configured = JSON.parse(readFileSync(configPath, 'utf8')).home;
      if (typeof configured === 'string' && configured.trim()) return resolve(configured);
    } catch { /* use the default when the optional config is corrupt */ }
  }
  return join(configRoot, 'openkan');
}

function writeOpenKanInstallConfig({ home, packageSpec, cwd, env = process.env }) {
  const configRoot = resolveBizarHome({ env, cwd });
  mkdirSync(configRoot, { recursive: true });
  writeFileSync(join(configRoot, OPENKAN_INSTALL_CONFIG), JSON.stringify({
    schema: 1,
    home,
    packageSpec,
    updatedAt: new Date().toISOString(),
  }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** Install OpenKan's package-owned Claude agent and skill without npm hooks. */
export function installOpenKanAgent({ home, cwd = process.cwd(), env = process.env, force = false } = {}) {
  if (env.BIZAR_SKIP_OPENKAN_AGENT_INSTALL === '1') {
    return { ok: true, skipped: true, installed: [], preserved: [], message: 'OpenKan agent and skill installation skipped' };
  }
  const script = join(openKanPackageRoot(home), 'bin', 'install-agent.mjs');
  if (!existsSync(script)) {
    return {
      ok: true,
      skipped: true,
      installed: [],
      preserved: [],
      message: `OpenKan package has no bundled agent installer; runtime remains usable (${script})`,
    };
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: resolve(cwd),
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: resolveClaudeConfigDir({ env, cwd }),
      ...(force ? { OPENKAN_AGENT_INSTALL_FORCE: '1' } : {}),
    },
  });
  if (result.status !== 0) {
    return {
      ok: false,
      message: (result.stderr || result.stdout || '').trim() || 'OpenKan agent and skill installation failed',
    };
  }
  return {
    ok: true,
    installed: ['agents/openkan.md', 'skills/openkan'],
    preserved: [],
    output: (result.stdout || '').trim(),
    message: `OpenKan agent and skill ready in ${resolveClaudeConfigDir({ env, cwd })}`,
  };
}

/** Make the native OpenKan commands available to agent shell sessions. */
export function installOpenKanCommandShims({ home, env = process.env } = {}) {
  const root = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  const binDir = join(root, '.local', 'bin');
  const packageBin = join(openKanPackageRoot(home), 'bin');
  const commands = [];
  try { mkdirSync(binDir, { recursive: true, mode: 0o755 }); } catch (error) {
    return { ok: false, installed: [], preserved: [], message: `OpenKan command directory unavailable: ${error.message}` };
  }
  const legacyBinSupported = installedOpenKanSupportsLegacyBin(home);
  // OpenKan v0.5.0 dropped the legacy `openkan` binary. If the user
  // upgraded from an earlier release, retire any existing shim so agent
  // shells stop hitting a dangling or legacy symlink.
  if (!legacyBinSupported) {
    const staleShim = join(binDir, process.platform === 'win32' ? 'openkan.cmd' : 'openkan');
    if (existsSync(staleShim)) {
      try {
        unlinkSync(staleShim);
        commands.push({ name: 'openkan', path: staleShim, status: 'retired' });
      } catch (error) {
        commands.push({ name: 'openkan', path: staleShim, status: 'failed', error: error.message });
      }
    }
  }
  const shimNames = legacyBinSupported ? ['ok', 'openkan'] : ['ok'];
  for (const name of shimNames) {
    const target = join(packageBin, `${name}.mjs`);
    const shim = join(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
    if (!existsSync(target)) continue;
    if (existsSync(shim)) {
      let replaceStaleOpenKanShim = false;
      if (process.platform !== 'win32') {
        try {
          replaceStaleOpenKanShim = lstatSync(shim).isSymbolicLink()
            && realpathSync(shim) !== realpathSync(target)
            && realpathSync(shim).toLowerCase().includes('openkan');
        } catch { /* preserve an unreadable or user-owned command */ }
      }
      if (!replaceStaleOpenKanShim) {
        commands.push({ name, path: shim, status: 'preserved' });
        continue;
      }
      try { unlinkSync(shim); } catch (error) {
        commands.push({ name, path: shim, status: 'failed', error: error.message });
        continue;
      }
    }
    try {
      if (process.platform === 'win32') {
        writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${target}" %*\r\n`, { encoding: 'utf8', mode: 0o755 });
      } else {
        symlinkSync(target, shim);
      }
      commands.push({ name, path: shim, status: 'installed' });
    } catch (error) {
      commands.push({ name, path: shim, status: 'failed', error: error.message });
    }
  }
  const failed = commands.filter((entry) => entry.status === 'failed');
  return {
    ok: failed.length === 0,
    installed: commands.filter((entry) => entry.status === 'installed'),
    preserved: commands.filter((entry) => entry.status === 'preserved'),
    retired: commands.filter((entry) => entry.status === 'retired'),
    message: failed.length === 0
      ? `OpenKan native commands ready in ${binDir}`
      : `OpenKan command shims failed: ${failed.map((entry) => `${entry.name}: ${entry.error}`).join('; ')}`,
  };
}

/**
 * Native install — runs entirely inside the Bizar provisioning code path.
 *
 * Steps:
 *   1. `npm install --prefix <home> @polderlabs/openkan@latest`
 *      via `spawnSync('npm', ...)` — npm resolves `@latest` against the
 *      public registry on every call, so Bizar always tracks the newest
 *      upstream OpenKan.
 *   2. Record the resolved version under `<home>/.installed-version` so
 *      operators can inspect what shipped and `bizar update` can detect
 *      drift.
 *   3. `verifyOpenKanRuntime` — launcher probe; surfaces a clear error
 *      if npm installed something but the `ok` binary does not start.
 *
 * The npm path replaces the previous `codeload` tarball + USTAR parser.
 * Operators no longer need `curl`, `tar`, or `gunzip` on PATH; npm is
 * the only subprocess. Set `BIZAR_SKIP_OPENKAN_NPM_INSTALL=1` to skip the
 * network call (handy for air-gapped installs that pre-stage the home).
 */
export async function installOpenKanPromise(options = {}) {
  const home = resolveOpenKanHome(options);
  const cwd = resolve(options.cwd || process.cwd());
  const pkgSpec = options.packageSpec || `${OPENKAN_NPM_PACKAGE}@${OPENKAN_NPM_VERSION_SPEC}`;
  const previousVersion = options.refresh ? null : readInstalledOpenKanVersion(home);

  if (nodeMajorVersion() < 22) {
    throw new OpenKanError(
      'OPENKAN_NODE_VERSION_UNSUPPORTED',
      `OpenKan requires Node.js 22 or newer; found ${process.version}. Upgrade Node.js and run the installer again.`,
    );
  }

  if (process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL === '1' || options.skipNpmInstall) {
    if (previousVersion) {
      const launcher = resolveOpenKanOk({ cwd, home });
      const agent = installOpenKanAgent({ home, cwd, env: options.env, force: options.force });
      if (!agent.ok) throw new OpenKanError('OPENKAN_AGENT_INSTALL_FAILED', agent.message, { agent });
      const commands = installOpenKanCommandShims({ home, env: options.env });
      if (!commands.ok) throw new OpenKanError('OPENKAN_COMMAND_INSTALL_FAILED', commands.message, { commands });
      if (options.persistConfig === true) writeOpenKanInstallConfig({ home, packageSpec: pkgSpec, cwd, env: options.env });
      return {
        ok: true,
        installed: false,
        skipped: true,
        home,
        version: previousVersion,
        launcher,
        agent,
        commands,
        message: `OpenKan install skipped; ${previousVersion} already present at ${home}`,
      };
    }
    throw new OpenKanError(
      'OPENKAN_SKIP_BUT_MISSING',
      'BIZAR_SKIP_OPENKAN_NPM_INSTALL=1 but no .installed-version marker is present at ' + home,
    );
  }

  const npm = spawnSync('npm', [
    'install',
    '--prefix', home,
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    '--ignore-scripts',
    '--silent',
    pkgSpec,
  ], {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: options.npmTimeoutMs || 240_000,
  });
  if (npm.error) {
    throw new OpenKanError('OPENKAN_NPM_INSTALL_FAILED', npm.error.message, { cause: npm.error });
  }
  if (process.env.BIZAR_OPENKAN_TEST_FAIL_NPM === '1') {
    // Test seam: force a deterministic failure path without hitting the network.
    throw new OpenKanError(
      'OPENKAN_NPM_INSTALL_FAILED',
      `npm install ${pkgSpec} failed (test seam)`,
      { npmStatus: 1 },
    );
  }
  if (npm.status !== 0) {
    throw new OpenKanError(
      'OPENKAN_NPM_INSTALL_FAILED',
      (npm.stderr || npm.stdout || '').trim() || `npm install ${pkgSpec} failed`,
      { npmStatus: npm.status },
    );
  }

  const pkgJsonPath = join(home, 'node_modules', '@polderlabs', 'openkan', 'package.json');
  let installedVersion = 'unknown';
  try {
    installedVersion = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
  } catch (error) {
    throw new OpenKanError(
      'OPENKAN_INSTALL_INCOMPLETE',
      `npm reported success but ${pkgJsonPath} is missing or unreadable`,
      { cause: error },
    );
  }

  writeFileSync(join(home, OPENKAN_VERSION_MARKER), `${installedVersion}\n`, { encoding: 'utf8' });

  const agent = installOpenKanAgent({ home, cwd, env: options.env, force: options.force });
  if (!agent.ok) {
    throw new OpenKanError('OPENKAN_AGENT_INSTALL_FAILED', agent.message, { agent });
  }
  const commands = installOpenKanCommandShims({ home, env: options.env });
  if (!commands.ok) throw new OpenKanError('OPENKAN_COMMAND_INSTALL_FAILED', commands.message, { commands });
  if (options.persistConfig === true) writeOpenKanInstallConfig({ home, packageSpec: pkgSpec, cwd, env: options.env });

  let launcher;
  try {
    launcher = verifyOpenKanRuntime({ cwd, home }).launcher;
  } catch (error) {
    throw new OpenKanError(
      'OPENKAN_INSTALL_INCOMPLETE',
      `OpenKan ${installedVersion} installed but did not start: ${error.message || String(error)}`,
      { cause: error },
    );
  }

  return {
    ok: true,
    installed: true,
    home,
    launcher,
    version: installedVersion,
    previousVersion,
    agent,
    commands,
    message: `OpenKan ${installedVersion} installed at ${launcher}`,
  };
}

/**
 * Compatibility wrapper: keep the legacy `installOpenKan()` name resolving
 * to the native installer so callers that don't await still surface an
 * explicit error rather than firing-and-forgetting a Promise.
 *
 * Existing call sites have been migrated to `installOpenKanPromise` (the
 * awaited form). New callers MUST use `installOpenKanPromise`.
 */
export const installOpenKanAsync = installOpenKanPromise;
