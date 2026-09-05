import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import test, { afterEach } from 'node:test';

import {
  OpenKanError,
  OPENKAN_TARBALL_PREFIX,
  installOpenKanPromise,
  parseTarEntries,
  readOpenKanJson,
  resolveOpenKanHome,
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
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'plans'), { recursive: true });
  mkdirSync(join(dir, 'prds'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'tsk-a.json'), JSON.stringify({ schema: 'ok.task.v1', id: 'tsk-a', status: 'in_progress', owner: 'alice', scopes: ['cli/**'] }));
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

// ── Native installer tests ─────────────────────────────────────────────────

/** Build a USTAR tar.gz containing the minimal OpenKan shape. */
function buildFixtureTarball() {
  const files = {
    'README.md': Buffer.from('# fixture'),
    'package.json': Buffer.from(JSON.stringify({ name: 'openkan-fixture', version: '0.0.0' })),
    'bin/ok.mjs': Buffer.from('#!/usr/bin/env node\nconsole.log("ok");\n'),
    'bin/openkan.mjs': Buffer.from('#!/usr/bin/env node\nconsole.log("openkan");\n'),
    'src/index.ts': Buffer.from('// ts source\n'),
    '.github/workflows/ci.yml': Buffer.from('name: ci\n'),
  };
  const BLOCK = 512;
  const TAR = [];
  for (const [rawName, content] of Object.entries(files)) {
    // Real OpenKan tarballs are nested under `openkan-main/`; mirror that.
    const name = `${OPENKAN_TARBALL_PREFIX}${rawName}`;
    const header = Buffer.alloc(BLOCK);
    const nameBuf = Buffer.from(name, 'utf8');
    if (nameBuf.length <= 100) {
      nameBuf.copy(header, 0, 0, nameBuf.length);
    } else {
      // Use GNU tar prefix split (name up to 100 + prefix up to 155).
      const slash = name.lastIndexOf('/');
      const file = name.slice(slash + 1);
      const prefix = name.slice(0, slash);
      Buffer.from(prefix, 'utf8').copy(header, 345, 0, Math.min(prefix.length, 155));
      Buffer.from(file, 'utf8').copy(header, 0, 0, Math.min(file.length, 100));
    }
    const sizeOctal = content.length.toString(8).padStart(11, '0') + ' ';
    Buffer.from(sizeOctal, 'utf8').copy(header, 124, 0, 12);
    header[156] = 0x30; // '0' = regular file
    header[257] = 0x75; // u = USTAR magic
    Buffer.from('ustar  \0', 'utf8').copy(header, 257, 0, 8);
    TAR.push(header);
    TAR.push(content);
    const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
    TAR.push(Buffer.alloc(pad));
  }
  TAR.push(Buffer.alloc(BLOCK)); // terminator
  TAR.push(Buffer.alloc(BLOCK));
  const tar = Buffer.concat(TAR);
  return gzipSync(tar);
}

function fakeFetch(tarball) {
  return async () => ({
    ok: true,
    status: 200,
    async arrayBuffer() { return tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength); },
  });
}

test('parseTarEntries returns one entry per file with correct size and content', () => {
  const tarball = buildFixtureTarball();
  const decompressed = gunzipSync(tarball);
  const entries = parseTarEntries(decompressed);
  const fileNames = entries.filter((e) => e.content.length > 0).map((e) => e.name).sort();
  assert.deepEqual(fileNames, [
    'openkan-main/.github/workflows/ci.yml',
    'openkan-main/README.md',
    'openkan-main/bin/ok.mjs',
    'openkan-main/bin/openkan.mjs',
    'openkan-main/package.json',
    'openkan-main/src/index.ts',
  ]);
  const okMjs = entries.find((e) => e.name === 'openkan-main/bin/ok.mjs');
  assert.equal(okMjs.size, Buffer.byteLength('#!/usr/bin/env node\nconsole.log("ok");\n'));
});

test('installOpenKanPromise extracts the tarball with native fetch + zlib and verifies the launcher', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  const tarball = buildFixtureTarball();
  const result = await installOpenKanPromise({
    home,
    fetchImpl: fakeFetch(tarball),
    skipNpmInstall: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.home, home);
  assert.equal(result.launcher, join(home, 'bin', 'ok.mjs'));
  // Files extracted (with the tarball prefix stripped)
  assert.equal(result.skipped.length, 0);
});

test('installOpenKanPromise surfaces an actionable error when the fetch fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  await assert.rejects(
    () => installOpenKanPromise({
      home,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      skipNpmInstall: true,
    }),
    (error) => error instanceof OpenKanError && error.code === 'OPENKAN_DOWNLOAD_FAILED',
  );
});

test('installOpenKanPromise surfaces an HTTP error when the response is not ok', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  await assert.rejects(
    () => installOpenKanPromise({
      home,
      fetchImpl: async () => ({ ok: false, status: 503, async arrayBuffer() { return new ArrayBuffer(0); } }),
      skipNpmInstall: true,
    }),
    (error) => error instanceof OpenKanError && /HTTP 503/.test(error.message),
  );
});

test('installOpenKanPromise fails clearly when the tarball contains no entries under the prefix', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  const emptyTar = gzipSync(Buffer.alloc(1024));
  await assert.rejects(
    () => installOpenKanPromise({
      home,
      fetchImpl: fakeFetch(emptyTar),
      skipNpmInstall: true,
    }),
    (error) => error instanceof OpenKanError && error.code === 'OPENKAN_EXTRACT_FAILED',
  );
});

test('installOpenKanPromise refuses to extract entries that escape the install root', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  const BLOCK = 512;
  const header = Buffer.alloc(BLOCK);
  Buffer.from('escape.txt', 'utf8').copy(header, 0, 0, 11);
  Buffer.from('14', 'utf8').copy(header, 124, 0, 12);
  header[156] = 0x30;
  header[257] = 0x75;
  Buffer.from('ustar', 'utf8').copy(header, 257, 0, 5);
  // Build an entry that tries to escape via "../"
  const escapeHeader = Buffer.alloc(BLOCK);
  Buffer.from('../escape.txt', 'utf8').copy(escapeHeader, 0, 0, 14);
  Buffer.from('14', 'utf8').copy(escapeHeader, 124, 0, 12);
  escapeHeader[156] = 0x30;
  escapeHeader[257] = 0x75;
  Buffer.from('ustar', 'utf8').copy(escapeHeader, 257, 0, 5);
  const content = Buffer.from('hello\nworld\n');
  const tar = Buffer.concat([header, content, Buffer.alloc(BLOCK - content.length), escapeHeader, content, Buffer.alloc(BLOCK - content.length), Buffer.alloc(BLOCK * 2)]);
  const tarball = gzipSync(tar);
  // We expect extraction to NOT write outside home. The launcher probe should still
  // fail cleanly because the fixture provides no ok.mjs at the expected path.
  await assert.rejects(
    () => installOpenKanPromise({
      home,
      fetchImpl: fakeFetch(tarball),
      skipNpmInstall: true,
    }),
    (error) => error instanceof OpenKanError,
  );
  // The escape entry must not have been written outside the install root.
  assert.equal(await import('node:fs').then(({ existsSync }) => existsSync(join(home, '..', 'escape.txt'))), false);
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

test('installOpenKanPromise resolves ok.mjs content from the extracted fixture', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-openkan-install-'));
  roots.push(home);
  const tarball = buildFixtureTarball();
  await installOpenKanPromise({
    home,
    fetchImpl: fakeFetch(tarball),
    skipNpmInstall: true,
  });
  const { existsSync, readFileSync } = await import('node:fs');
  const launcher = join(home, 'bin', 'ok.mjs');
  assert.equal(existsSync(launcher), true);
  const content = readFileSync(launcher, 'utf8');
  assert.match(content, /console\.log\("ok"\)/);
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
