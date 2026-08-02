import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const INSTALL_SCRIPT = join(REPO_ROOT, 'install.sh');

function executable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bizar-install-test-'));
  const bin = join(root, 'bin');
  const archiveTree = join(root, 'archive-tree', 'BizarHarness-fixture');
  const archive = join(root, 'fixture.tar.gz');
  const curlLog = join(root, 'curl.log');
  const nodeLog = join(root, 'node.log');
  const bootstrapTmp = join(root, 'tmp');

  mkdirSync(bin, { recursive: true });
  mkdirSync(join(archiveTree, 'cli'), { recursive: true });
  mkdirSync(bootstrapTmp, { recursive: true });
  cpSync(INSTALL_SCRIPT, join(archiveTree, 'install.sh'));
  writeFileSync(
    join(archiveTree, 'package.json'),
    JSON.stringify({ name: '@polderlabs/bizar', version: '0.0.0-test' }),
  );
  writeFileSync(join(archiveTree, 'cli', 'provision.mjs'), '// fixture\n');

  const tar = spawnSync(
    'tar',
    ['-czf', archive, '-C', dirname(archiveTree), 'BizarHarness-fixture'],
    { encoding: 'utf8' },
  );
  assert.equal(tar.status, 0, tar.stderr);

  executable(join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_CURL_LOG"
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then output="$2"; shift 2; else shift; fi
done
[ -n "$output" ]
cp "$FAKE_ARCHIVE" "$output"
`);
  executable(join(bin, 'node'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NODE_LOG"
`);
  executable(join(bin, 'uv'), '#!/usr/bin/env bash\nexit 0\n');
  executable(join(bin, 'uname'), '#!/usr/bin/env bash\nprintf \'Darwin\\n\'\n');
  executable(join(bin, 'brew'), '#!/usr/bin/env bash\nexit 0\n');

  return {
    root,
    bin,
    archive,
    curlLog,
    nodeLog,
    bootstrapTmp,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_ARCHIVE: archive,
      FAKE_CURL_LOG: curlLog,
      FAKE_NODE_LOG: nodeLog,
      TMPDIR: bootstrapTmp,
    },
  };
}

test('local checkout mode provisions directly without downloading an archive', () => {
  const f = fixture();
  try {
    const result = spawnSync('bash', [INSTALL_SCRIPT, '--dry-run'], {
      cwd: REPO_ROOT,
      env: f.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(f.curlLog), false, 'local mode must not invoke curl');
    assert.match(readFileSync(f.nodeLog, 'utf8'), /cli\/provision\.mjs --mode=install --dry-run/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('pipe mode downloads, validates, installs, and cleans a public archive', () => {
  const f = fixture();
  try {
    const result = spawnSync(
      'bash',
      ['-c', 'cat "$INSTALL_SCRIPT" | bash -s -- --dry-run'],
      {
        cwd: f.root,
        env: { ...f.env, INSTALL_SCRIPT },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const curl = readFileSync(f.curlLog, 'utf8');
    assert.match(curl, /-fsSL/);
    assert.match(curl, /https:\/\/api\.github\.com\/repos\/DrB0rk\/BizarHarness\/tarball\/master/);
    assert.match(curl, /-o .*bizar\.tar\.gz/);

    const node = readFileSync(f.nodeLog, 'utf8');
    assert.match(node, /cli\/provision\.mjs --mode=install --yes --dry-run/);
    assert.deepEqual(readdirSync(f.bootstrapTmp), [], 'bootstrap temp directory must be removed');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
