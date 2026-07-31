/**
 * cli/__tests__/model.test.mjs
 *
 * Tests for `bizar model list`:
 *  - 200 response → exit 0, table contains expected IDs, --json parses
 *  - 401 response → exit 1
 *  - timeout / network error → exit 1
 */
import { createServer } from 'node:http';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Absolute paths so the subprocess can find the module
const BIN = join(process.cwd(), 'cli', 'bin.mjs');

function makeTmpEnv(overrides = {}) {
  return {
    ...process.env,
    BIZAR_SKIP_BUILD: '1',
    ...overrides,
  };
}

/**
 * Spawn `bizar model list` against a given port. Resolves with { stdout, stderr, code }.
 */
function runModelList(port, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, 'model', 'list', ...extraArgs], {
      cwd: process.cwd(),
      env: makeTmpEnv({
        PORT: String(port),
        BIZAR_MODEL_ROUTER_URL: `http://127.0.0.1:${port}/v1`,
        ANTHROPIC_AUTH_TOKEN: 'test-token',
      }),
      timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

const { describe, it, after } = await import('node:test');

const SAMPLE_MODELS = [
  { id: 'cx/gpt-5.6-sol', display_name: 'GPT-5.6 Sol' },
  { id: 'cx/gpt-5.6-terra', display_name: 'GPT-5.6 Terra' },
  { id: 'bizar/MiniMax-M3', display_name: 'MiniMax M3' },
  { id: 'bizar/MiniMax-M2.7', display_name: 'MiniMax M2.7' },
  { id: 'oc/deepseek-v4-flash-free', display_name: 'DeepSeek V4 Flash Free' },
  { id: 'anthropic/sonnet-4-20251120', display_name: 'Sonnet 4' },
  { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
  { id: 'no-prefix-model', display_name: 'No Prefix Model' },
];

describe('bizar model list', { concurrency: 1 }, () => {
  let server;
  let serverPort;

  function startServer(handler, delayMs = 0) {
    return new Promise((res) => {
      server = createServer((req, res) => {
        if (delayMs > 0) {
          setTimeout(() => handler(req, res), delayMs);
        } else {
          handler(req, res);
        }
      });
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        res();
      });
    });
  }

  function stopServer() {
    return new Promise((res) => {
      if (server) server.close(() => res());
      else res();
    });
  }

  after(async () => {
    await stopServer();
  });

  it('exits 0 and prints table on 200', async () => {
    await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: SAMPLE_MODELS }));
    });

    const { stdout, stderr, code } = await runModelList(serverPort);
    assert.strictEqual(code, 0, `expected 0, got ${code}. stderr: ${stderr}`);
    assert.ok(stdout.includes('cx/'), 'table should contain cx/ group');
    assert.ok(stdout.includes('cx/gpt-5.6-sol'), 'table should contain cx/gpt-5.6-sol');
    assert.ok(stdout.includes('bizar/'), 'table should contain bizar/ group');
    assert.ok(stdout.includes('oc/'), 'table should contain oc/ group');
    assert.ok(stdout.includes('(no prefix)'), 'table should contain (no prefix) group');
    assert.ok(stdout.includes('anthropic/'), 'table should contain anthropic/ group');
    assert.ok(stdout.includes('claude/'), 'table should contain claude/ group');
  });

  it('--json exits 0 and emits valid JSON', async () => {
    await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: SAMPLE_MODELS }));
    });

    const { stdout, stderr, code } = await runModelList(serverPort, ['--json']);
    assert.strictEqual(code, 0, `expected 0, got ${code}. stderr: ${stderr}`);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(stdout); }, 'stdout should be valid JSON');
    assert.ok(parsed.providers, 'JSON should have providers key');
    assert.ok(Array.isArray(parsed.providers['cx/']), 'cx/ should be an array');
    assert.strictEqual(parsed.total, SAMPLE_MODELS.length, 'total should match model count');
  });

  it('retries without auth on 401 then exits 0', async () => {
    let firstAttempt = true;
    await startServer((req, res) => {
      if (firstAttempt) {
        firstAttempt = false;
        const auth = req.headers.authorization;
        if (auth === 'Bearer test-token') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: SAMPLE_MODELS }));
    });

    const { stdout, stderr, code } = await runModelList(serverPort);
    assert.strictEqual(code, 0, `expected 0 after 401-retry, got ${code}. stderr: ${stderr}`);
    assert.ok(stdout.includes('cx/'), 'should show models after auth retry');
  });

  it('exits 1 on 401 with no fallback (auth-only gateway)', async () => {
    let attempts = 0;
    await startServer((req, res) => {
      attempts++;
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });

    const { stdout, stderr, code } = await runModelList(serverPort);
    assert.strictEqual(code, 1, `expected 1, got ${code}`);
    assert.ok(stderr.includes('401'), 'stderr should mention 401');
  });

  it('exits 1 on timeout (slow server)', async () => {
    // Handler hangs — client AbortController fires after 3s
    await startServer((req, res) => {
      // Never respond
    });

    const { stdout, stderr, code } = await runModelList(serverPort);
    assert.strictEqual(code, 1, `expected 1 on timeout, got ${code}`);
    assert.ok(
      stderr.includes('timed out') || stderr.includes('abort') || stderr.includes('AbortError') || stderr.includes('aborted'),
      `stderr should mention timeout/abort: ${stderr}`,
    );
  });

  it('exits 1 on network error', async () => {
    // No server started — port should be refused
    const { stdout, stderr, code } = await runModelList(59999);
    assert.strictEqual(code, 1, `expected 1 on connection refused, got ${code}`);
    assert.ok(stderr.length > 0 || stdout.length > 0, 'should have some error output');
  });
});
