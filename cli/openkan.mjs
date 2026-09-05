/**
 * OpenKan runtime boundary for Bizar.
 *
 * Bizar owns orchestration; OpenKan owns durable project planning under
 * `.ok/`. Keeping this bridge subprocess-only means Bizar never imports or
 * forks OpenKan's storage implementation, and upgrades remain independent.
 *
 * The native installer (`installOpenKan`) avoids the previous `curl | bash`
 * pipeline. Bizar now downloads the OpenKan tarball with Node's built-in
 * `fetch`, decompresses with `node:zlib`, parses USTAR with a tiny
 * in-process parser, and only shells out to `npm install --omit=dev
 * --ignore-scripts` for runtime dependencies. No remote shell script ever
 * runs on the operator's machine — the install is fully driven by the
 * Bizar provisioning code path.
 */
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

export const OPENKAN_TARBALL_URL = 'https://codeload.github.com/PolderLabsVOF/openkan/tar.gz/refs/heads/main';
export const OPENKAN_TARBALL_PREFIX = 'openkan-main/';
export const OPENKAN_HOME_DEFAULT = join(homedir(), '.config', 'bizar', 'openkan');
export const OPENKAN_DEFAULT_LAUNCHER = join(OPENKAN_HOME_DEFAULT, 'bin', 'ok.mjs');

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
    const candidate = [join(home, 'bin', 'ok.mjs'), join(home, 'bin', 'ok.ts')]
      .find((path) => existsSync(path));
    if (candidate) return candidate;
    throw new OpenKanError('OPENKAN_NOT_FOUND', `OpenKan launcher missing under ${resolve(home)}/bin`);
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

/** Parse a USTAR tar buffer into { name, content } entries. */
export function parseTarEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('parseTarEntries expects a Buffer');
  }
  const entries = [];
  const BLOCK = 512;
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break; // tar terminator
    const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0+$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').trim();
    const size = Number.parseInt(sizeOctal, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] || 0x30);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    const content = size > 0
      ? Buffer.from(buffer.subarray(offset + BLOCK, offset + BLOCK + size))
      : Buffer.alloc(0);
    entries.push({ name: fullName, typeFlag, size, content });
    offset += BLOCK + paddedSize;
  }
  return entries;
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
 *   1. `fetch(OPENKAN_TARBALL_URL)` (Node 18+) — no `curl` binary.
 *   2. `zlib.gunzipSync` — no remote shell.
 *   3. `parseTarEntries` + `mkdirSync`/`writeFileSync` — no `tar` binary.
 *   4. Optional `npm install --omit=dev --ignore-scripts --prefix <home>`
 *      via `spawnSync('npm', ...)` to fetch runtime deps; skipped when
 *      `BIZAR_SKIP_OPENKAN_NPM_INSTALL=1`.
 *   5. `verifyOpenKanRuntime` — launcher probe.
 */
export async function installOpenKanPromise(options = {}) {
  const home = resolveOpenKanHome(options);
  const cwd = resolve(options.cwd || process.cwd());
  const fetchImpl = options.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  if (typeof fetchImpl !== 'function') {
    throw new OpenKanError('OPENKAN_FETCH_UNAVAILABLE', 'Node 18+ global fetch is required for the native installer');
  }

  let response;
  try {
    response = await fetchImpl(OPENKAN_TARBALL_URL, { redirect: 'follow' });
  } catch (error) {
    throw new OpenKanError('OPENKAN_DOWNLOAD_FAILED', error?.message || 'fetch failed', { cause: error });
  }
  if (!response?.ok) {
    throw new OpenKanError('OPENKAN_DOWNLOAD_FAILED', `HTTP ${response?.status || '???'} fetching ${OPENKAN_TARBALL_URL}`);
  }
  const compressed = Buffer.from(await response.arrayBuffer());

  let tarBuffer;
  try {
    tarBuffer = gunzipSync(compressed);
  } catch (error) {
    throw new OpenKanError('OPENKAN_EXTRACT_FAILED', `Could not decompress tarball: ${error?.message || error}`, { cause: error });
  }

  let entries;
  try {
    entries = parseTarEntries(tarBuffer);
  } catch (error) {
    throw new OpenKanError('OPENKAN_EXTRACT_FAILED', `Could not parse tar entries: ${error?.message || error}`, { cause: error });
  }
  const extracted = entries.filter((entry) => entry.name.startsWith(OPENKAN_TARBALL_PREFIX));
  if (extracted.length === 0) {
    throw new OpenKanError('OPENKAN_EXTRACT_FAILED', `Tarball contained no entries under ${OPENKAN_TARBALL_PREFIX}`);
  }

  if (options.refresh && existsSync(home)) {
    rmSync(home, { recursive: true, force: true });
  }
  mkdirSync(home, { recursive: true });

  const skipped = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(OPENKAN_TARBALL_PREFIX)) continue;
    const relative = entry.name.slice(OPENKAN_TARBALL_PREFIX.length);
    if (!relative || relative.startsWith('..') || relative.includes(`..${sep}`)) {
      skipped.push(entry.name);
      continue;
    }
    const target = join(home, relative);
    if (entry.typeFlag === '5' || entry.name.endsWith('/')) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.content);
  }

  let installResult = null;
  if (process.env.BIZAR_SKIP_OPENKAN_NPM_INSTALL !== '1' && !options.skipNpmInstall) {
    const packageJson = join(home, 'package.json');
    if (existsSync(packageJson)) {
      const npm = spawnSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], {
        cwd: home,
        encoding: 'utf8',
        shell: false,
        timeout: options.npmTimeoutMs || 240_000,
      });
      if (npm.status !== 0) {
        throw new OpenKanError(
          'OPENKAN_NPM_INSTALL_FAILED',
          (npm.stderr || npm.stdout || '').trim() || 'npm install failed',
          { npmStatus: npm.status },
        );
      }
      installResult = { stdout: npm.stdout || '', stderr: npm.stderr || '' };
    }
  }

  let launcher;
  try {
    launcher = verifyOpenKanRuntime({ cwd, home }).launcher;
  } catch (error) {
    throw new OpenKanError('OPENKAN_INSTALL_INCOMPLETE', `OpenKan installed but did not start: ${error.message || String(error)}`, { cause: error });
  }

  return {
    ok: true,
    installed: true,
    home,
    launcher,
    skipped,
    npm: installResult,
    message: `OpenKan installed (${launcher})`,
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
