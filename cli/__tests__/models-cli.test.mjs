/**
 * cli/__tests__/models-cli.test.mjs
 *
 * Subprocess tests for `bizar models`:
 *   - --help prints help
 *   - --list fetches from the gateway and prints IDs (200 happy path)
 *   - --list --json emits machine-readable JSON
 *   - --list 401/403 surfaces an actionable error
 *   - --set persists userSelected; --clear removes it
 *   - --set with empty list exits 2
 *
 * The subprocess always points at an in-process HTTP server (no live
 * gateway dependency). It writes into a temp router file under the
 * subprocess's `cwd`, so tests do not touch the real config.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Resolve the worktree root for the bin path. Tests run from a worktree.
const CWD = process.cwd();
const BIN = join(CWD, 'cli', 'bin.mjs');

const SAMPLE = {
  data: [
    { id: 'zeta/zzz', owned_by: 'zeta' },
    { id: 'alpha/a1', owned_by: 'alpha' },
    { id: 'claude-minimax/MiniMax-M3', owned_by: 'minimax' },
    { id: 'claude-qwen/qwen3.8-max', owned_by: 'qwen' },
  ],
};

function startServer(handler) {
  return new Promise((resolveP) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolveP({ srv, port });
    });
  });
}

function stopServer(srv) {
  return new Promise((resolveP) => srv.close(resolveP));
}

function makeCwd() {
  return mkdtempSync(join(tmpdir(), 'bizar-models-cli-'));
}

/**
 * The CLI persists the router file under BIZAR_HOME by default (operator-
 * controlled state). For these tests we point each test at a tmp file via
 * BIZAR_MODEL_ROUTER_CONFIG so the subprocess never touches the operator's
 * real BIZAR_HOME. The dedicated BIZAR_HOME behaviour is exercised separately
 * in `models-persists-under-bizar-home.test.mjs`.
 */
function tmpRouterPath(cwd) {
  return join(cwd, 'model-router.json');
}

function writeBaseRouter(cwd) {
  const path = tmpRouterPath(cwd);
  writeFileSync(path, JSON.stringify({
    version: '13.0.0',
    endpoint: 'http://stub/v1',
    tiers: { premium: { models: ['stub/p'], purpose: 'x', effort: 'high' } },
    policies: { selectionOwner: 'orchestrator', discoveryFailure: 'inherit-session', unavailableModel: 'inherit-session', retryModelAliases: false, maxDispatchModelAttempts: 1 },
  }, null, 2));
  return path;
}

function runBizar(args, { cwd, env, timeoutMs = 15000 } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        ...process.env,
        BIZAR_SKIP_BUILD: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolveP({ code: -1, stdout, stderr, killed: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveP({ code, stdout, stderr });
    });
  });
}

test('bizar models --help prints usage', async () => {
  const cwd = makeCwd();
  try {
    const { code, stdout } = await runBizar(['models', '--help'], { cwd });
    assert.equal(code, 0);
    assert.match(stdout, /User-controlled model picker/);
    assert.match(stdout, /--list/);
    assert.match(stdout, /--set/);
    assert.match(stdout, /--clear/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('bizar models --list prints IDs one per line, sorted', async () => {
  const { srv, port } = await startServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const { code, stdout, stderr } = await runBizar(['models', '--list'], {
        cwd,
        env: {
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_AUTH_TOKEN: 'tok',
          // redirect the global write target into a tmp file so the
          // test never touches the operator's real BIZAR_HOME.
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          // prevent the test from reading the user's home settings
          HOME: cwd,
        },
      });
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}`);
      const ids = stdout.trim().split('\n').filter(Boolean);
      assert.deepEqual(ids, [
        'alpha/a1',
        'claude-minimax/MiniMax-M3',
        'claude-qwen/qwen3.8-max',
        'zeta/zzz',
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await stopServer(srv);
  }
});

test('bizar models --list --json emits machine-readable JSON', async () => {
  const { srv, port } = await startServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const { code, stdout } = await runBizar(['models', '--list', '--json'], {
        cwd,
        env: {
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_AUTH_TOKEN: 'tok',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
        },
      });
      assert.equal(code, 0);
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.total, SAMPLE.data.length);
      // The CLI surfaces whatever the env var provides — no /v1 suffix
      // is appended automatically.
      assert.equal(parsed.endpoint, `http://127.0.0.1:${port}`);
      assert.ok(Array.isArray(parsed.candidates));
      assert.equal(parsed.candidates.length, SAMPLE.data.length);
      assert.ok(parsed.candidates.find((c) => c.id === 'claude-minimax/MiniMax-M3'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await stopServer(srv);
  }
});

test('bizar models --list surfaces actionable 401 error and exits 1', async () => {
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":"unauthorized"}');
  });
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const { code, stderr } = await runBizar(['models', '--list'], {
        cwd,
        env: {
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_AUTH_TOKEN: 'bad',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
        },
      });
      assert.equal(code, 1);
      assert.match(stderr, /ANTHROPIC_AUTH_TOKEN or BIZAR_MODEL_ROUTER_URL/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await stopServer(srv);
  }
});

test('bizar models --set persists userSelected and --clear removes it', async () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const { code, stdout } = await runBizar(['models', '--set=a/1,b/2', '--json'], {
      cwd,
      env: { HOME: cwd, BIZAR_MODEL_ROUTER_CONFIG: routerPath },
    });
    assert.equal(code, 0, `expected 0, got ${code}; stdout=${stdout}`);
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed.applied.models, ['a/1', 'b/2']);
    // Unknown IDs fall into the `mid` catch-all tier per the heuristic table.
    assert.equal(parsed.applied.tierHints['a/1'], 'mid');
    assert.equal(parsed.applied.tierHints['b/2'], 'mid');

    // The router file now contains the userSelected block. It lives at the
    // redirected `BIZAR_MODEL_ROUTER_CONFIG` path, NOT under `cwd/config/`.
    const router = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.deepEqual(router.userSelected.models, ['a/1', 'b/2']);
    assert.equal(router.userSelected.source, 'cli-set');
    // Other fields preserved.
    assert.equal(router.version, '13.0.0');
    assert.equal(router.tiers.premium.models[0], 'stub/p');
    // And nothing was accidentally written into cwd/config/.
    assert.equal(existsSync(join(cwd, 'config', 'claude', 'model-router.json')), false, 'cwd/config/ must remain untouched');

    // --clear removes the block.
    const cleared = await runBizar(['models', '--clear', '--json'], {
      cwd,
      env: { HOME: cwd, BIZAR_MODEL_ROUTER_CONFIG: routerPath },
    });
    assert.equal(cleared.code, 0);
    const clearedParsed = JSON.parse(cleared.stdout);
    assert.equal(clearedParsed.cleared, true);
    assert.deepEqual(clearedParsed.previous, ['a/1', 'b/2']);
    const after = JSON.parse(readFileSync(routerPath, 'utf8'));
    assert.equal(after.userSelected, undefined, 'userSelected removed');
    assert.equal(after.tiers.premium.models[0], 'stub/p', 'other fields still preserved');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('bizar models --set with empty list exits 2', async () => {
  const cwd = makeCwd();
  try {
    const routerPath = writeBaseRouter(cwd);
    const { code, stderr } = await runBizar(['models', '--set=', '--json'], {
      cwd,
      env: { HOME: cwd, BIZAR_MODEL_ROUTER_CONFIG: routerPath },
    });
    assert.equal(code, 2);
    assert.match(stderr, /--set requires at least one model id/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('bizar model (deprecated alias) routes to legacy module and preserves JSON shape', async () => {
  const { srv, port } = await startServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      const { code, stdout, stderr } = await runBizar(['model', 'list', '--json'], {
        cwd,
        env: {
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_AUTH_TOKEN: 'tok',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
        },
      });
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}`);
      // Deprecation notice emitted on stderr.
      assert.match(stderr, /deprecated/i);
      // Legacy JSON shape preserved (providers map).
      const parsed = JSON.parse(stdout);
      assert.ok(parsed.providers, 'legacy shape with providers map');
      assert.equal(parsed.total, SAMPLE.data.length);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await stopServer(srv);
  }
});

// ── 10.22.0 / Phase 4: disabled-providers subprocess test ────────────────

test('bizar models --list: anthropic/* ids are stripped when disabledProviders:["anthropic"]', async () => {
  // Subprocess end-to-end pin: the operator's `disabledProviders: ["anthropic"]`
  // config causes every `anthropic/*` candidate to be filtered before the
  // picker writes its output. The gateway may still report them; the CLI
  // removes them.
  const { srv, port } = await startServer((req, res) => {
    if (req.url.startsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(SAMPLE));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const cwd = makeCwd();
    try {
      const routerPath = writeBaseRouter(cwd);
      // Inject `disabledProviders: ["anthropic"]` into the operator's
      // Bizar router file. The subprocess reads from the Bizar path
      // because BIZAR_MODEL_ROUTER_CONFIG is set.
      const router = JSON.parse(readFileSync(routerPath, 'utf8'));
      router.disabledProviders = ['anthropic'];
      writeFileSync(routerPath, JSON.stringify(router, null, 2));

      const { code, stdout, stderr } = await runBizar(['models', '--list'], {
        cwd,
        env: {
          BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_AUTH_TOKEN: 'tok',
          BIZAR_MODEL_ROUTER_CONFIG: routerPath,
          HOME: cwd,
        },
      });
      assert.equal(code, 0, `expected 0, got ${code}; stderr=${stderr}`);
      const ids = stdout.trim().split('\n').filter(Boolean);
      // Every surviving id must NOT start with `anthropic/`.
      for (const id of ids) {
        assert.ok(!id.startsWith('anthropic/'), `disabled id survived: ${id}`);
      }
      // The sample ships anthropic/* ids — assert they were filtered.
      assert.ok(!ids.includes('anthropic/claude-3-5-sonnet'));
      // Sanity: non-anthropic ids still appear.
      assert.ok(ids.includes('claude-minimax/MiniMax-M3'));
      assert.ok(ids.includes('claude-qwen/qwen3.8-max'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    await stopServer(srv);
  }
});