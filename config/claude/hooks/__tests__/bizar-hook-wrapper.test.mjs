/**
 * config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs
 *
 * Regression tests for `bizar-hook-wrapper.sh` — the path-resolving shim
 * Claude Code invokes in lieu of bare `bizar hook <sub>` commands.
 *
 * Run with: node --test config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  statSync,
  chmodSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPER_PATH = join(__dirname, '..', 'bizar-hook-wrapper.sh');

test('bizar-hook-wrapper.sh exists and is executable', () => {
  assert.equal(existsSync(WRAPPER_PATH), true, `wrapper missing at ${WRAPPER_PATH}`);
  const st = statSync(WRAPPER_PATH);
  assert.equal(st.isFile(), true);
  // owner-execute bit must be set so /bin/sh can exec it via the path
  assert.ok((st.mode & 0o100) !== 0, `wrapper is not executable: mode=${(st.mode & 0o777).toString(8)}`);
});

test('wrapper probes known candidate paths when PATH is stripped', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-wrapper-'));
  try {
    // Stub `bizar` that records its argv to a sidecar file.
    const stubDir = join(home, '.npm-global', 'bin');
    mkdirSync(stubDir, { recursive: true });
    const stubPath = join(stubDir, 'bizar');
    const recordPath = join(home, 'argv.txt');
    const stdinPath = join(home, 'stdin.txt');
    writeFileSync(stdinPath, 'sample-stdin\n');
    // Stub reads argv + the stdin file path. The wrapper is invoked with
    // input:'sample-stdin'; spawnSync pipes it to sh's stdin, which sh
    // then forwards to the exec'd stub. Reading /dev/stdin inside the
    // stub is brittle in stripped-PATH environments, so we have the
    // wrapper itself copy stdin to the file before execing.
    writeFileSync(
      stubPath,
      `#!/bin/sh\nprintf 'argv=%s\\n' "$*" > "${recordPath}"\nprintf 'stdin=' >> "${recordPath}"; while IFS= read -r line; do printf '%s' "$line" >> "${recordPath}"; done\n`,
    );
    chmodSync(stubPath, 0o755);

    const strippedEnv = {
      ...process.env,
      HOME: home,
      PATH: '/nonexistent',
    };

    const result = spawnSync('/bin/sh', ['-c', `"${WRAPPER_PATH}" pre-tool-use < "${stdinPath}"`], {
      env: strippedEnv,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `wrapper exited non-zero: status=${result.status} signal=${result.signal} stderr=${(result.stderr || '').slice(0,500)} stdout=${(result.stdout || '').slice(0,500)}`);
    const recorded = readFileSync(recordPath, 'utf8').trim().split('\n');
    assert.deepEqual(recorded[0], 'argv=hook pre-tool-use', `unexpected argv: ${recorded[0]}`);
    assert.match(recorded[1] || '', /stdin=sample-stdin/, `stdin must be forwarded: ${recorded[1]}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('wrapper falls back to PATH lookup when no candidate dir matches', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-wrapper-'));
  try {
    // Place a `bizar` somewhere Claude Code would NOT probe; instead put it on PATH.
    const pathDir = join(home, 'onpath');
    mkdirSync(pathDir, { recursive: true });
    const stubPath = join(pathDir, 'bizar');
    writeFileSync(stubPath, '#!/bin/sh\necho "argv=$*"\n');
    chmodSync(stubPath, 0o755);

    const strippedEnv = {
      ...process.env,
      HOME: home,
      // PATH includes a dir with bizar, but the wrapper's hard-coded candidate
      // dirs (under this synthetic HOME) have nothing.
      PATH: pathDir,
    };

    const result = spawnSync(WRAPPER_PATH, ['session-start'], {
      env: strippedEnv,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `wrapper exited non-zero: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /argv=hook session-start/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('wrapper script encodes npx fallback for the no-bizar branch', () => {
  // We cannot reliably force `/usr/bin/bizar` to be absent on this host, so
  // rather than exec the wrapper with a fully-stripped PATH (which would hit
  // /usr/bin/bizar), verify the source itself encodes the fallback so a
  // future regression that drops the npx branch fails this test.
  const body = readFileSync(WRAPPER_PATH, 'utf8');
  assert.match(body, /npx -y @polderlabs\/bizar-sdk/);
  // The fallback must come AFTER the candidate loop and PATH lookup, not
  // before. The simplest guard: `BIZAR="npx..."` line must appear later in
  // the script than `command -v bizar`.
  const fallbackIdx = body.indexOf('npx -y @polderlabs/bizar-sdk');
  const commandIdx = body.indexOf('command -v bizar');
  assert.ok(fallbackIdx > 0, 'fallback string missing');
  assert.ok(commandIdx > 0, 'PATH lookup missing');
  assert.ok(fallbackIdx > commandIdx, 'fallback must be reached only after PATH lookup');
});

test('wrapper script content matches the canonical template', () => {
  // Guard against accidental edits that drop the path-probe loop. The
  // template body must always probe $HOME/.npm-global/bin first.
  const body = readFileSync(WRAPPER_PATH, 'utf8');
  assert.match(body, /\$HOME\/\.npm-global\/bin/);
  assert.match(body, /command -v bizar/);
  assert.match(body, /npx -y @polderlabs\/bizar-sdk/);
  assert.match(body, /exec \$BIZAR hook "\$@"/);
});
