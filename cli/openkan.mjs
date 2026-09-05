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
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

  const configuredBin = options.openkanBin || process.env.BIZAR_OPENKAN_BIN || executableOnPath('openkan');
  if (!configuredBin) {
    throw new OpenKanError(
      'OPENKAN_NOT_FOUND',
      'OpenKan is required for Bizar planning. Run `bizar openkan install`, then retry.',
    );
  }
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
export function readInstalledOpenKanVersion(home = OPENKAN_HOME_DEFAULT) {
  const marker = join(home, OPENKAN_VERSION_MARKER);
  if (!existsSync(marker)) return null;
  try {
    return readFileSync(marker, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Resolve the default install root for the native installer. */
export function resolveOpenKanHome(options = {}) {
  if (options.home) return resolve(options.home);
  if (process.env.BIZAR_OPENKAN_HOME) return resolve(process.env.BIZAR_OPENKAN_HOME);
  return OPENKAN_HOME_DEFAULT;
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

  if (process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL === '1' || options.skipNpmInstall) {
    if (previousVersion) {
      const launcher = resolveOpenKanOk({ cwd, home });
      return {
        ok: true,
        installed: false,
        skipped: true,
        home,
        version: previousVersion,
        launcher,
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
