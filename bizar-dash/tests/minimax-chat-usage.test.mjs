/**
 * minimax-chat-usage.test.mjs
 *
 * Verifies that chatCompletion() in minimax.mjs calls recordUsage()
 * with the correct shape after every call (success, error, and cached).
 *
 * Run with: node --test bizar-dash/tests/minimax-chat-usage.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '..', '..');

let SANDBOX_HOME;
let ORIGINAL_BIZAR_STORE_HOME;

before(() => {
  SANDBOX_HOME = mkdtempSync(join(tmpdir(), `bizar-chat-usage-test-${Date.now()}-`));
  ORIGINAL_BIZAR_STORE_HOME = process.env.BIZAR_STORE_HOME;
  // Set BIZAR_STORE_HOME so the store module resolves to our sandbox.
  process.env.BIZAR_STORE_HOME = join(SANDBOX_HOME, '.local', 'share', 'bizar');
});

after(() => {
  process.env.BIZAR_STORE_HOME = ORIGINAL_BIZAR_STORE_HOME ?? '';
  try { rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Wipe the usage store before each test by directly unlinking the file.
  const storeFile = join(process.env.BIZAR_STORE_HOME, 'usage.jsonl');
  try { unlinkSync(storeFile); } catch { /* ignore */ }
});

/** Load the store module fresh each time with a unique cache-busting query param. */
async function getStore() {
  const stamp = `${Date.now()}-${Math.random()}`;
  return import(`../src/server/minimax-usage-store.mjs?nocache=${stamp}`);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

/**
 * We can't easily intercept recordUsage calls directly, but we CAN
 * verify the effect: after calling chatCompletion, the JSONL file
 * contains one more line, and the shape of the record is correct.
 *
 * We mock the globalThis.fetch to return a fake MiniMax response,
 * and verify the recorded usage entry.
 */
describe('chatCompletion records usage', () => {
  it('records a success usage entry', async () => {
    const store = await getStore();

    // Mock fetch to return a fake MiniMax chat completion response.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function mockFetch(url, opts) {
      if (String(url).includes('/chat/completions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: () => Promise.resolve(JSON.stringify({
            id: 'msg_test',
            model: 'MiniMax-M3',
            choices: [{
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'pong' },
            }],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 3,
              total_tokens: 15,
              completion_tokens_details: { reasoning_tokens: 1 },
            },
            base_resp: { status_code: 0, status_msg: 'Success' },
          })),
        });
      }
      return originalFetch.call(this, url, opts);
    };

    try {
      // Force re-import of minimax.mjs with the patched HOME.
      const { chatCompletion } = await import(`../src/server/minimax.mjs?v=${Date.now()}`);
      const result = await chatCompletion({ prompt: 'pong', model: 'MiniMax-M3', maxTokens: 16 });

      assert.equal(result.ok, true);
      assert.equal(result.model, 'MiniMax-M3');
      assert.equal(result.content, 'pong');

      // Now verify the usage was recorded.
      const all = store.readAllRecords();
      const entries = all.filter(r => r.requestId.startsWith('msg_'));
      assert.ok(entries.length >= 1, `Expected at least 1 usage record, got ${entries.length}`);

      const entry = entries[entries.length - 1];
      assert.equal(entry.providerId, 'minimax');
      assert.equal(entry.modelId, 'MiniMax-M3');
      assert.equal(entry.endpoint, 'chat');
      assert.equal(entry.promptTokens, 12);
      assert.equal(entry.completionTokens, 3);
      assert.equal(entry.totalTokens, 15);
      assert.equal(entry.reasoningTokens, 1);
      assert.equal(entry.finishReason, 'stop');
      assert.equal(entry.error, null);
      assert.equal(entry.cached, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records an error usage entry on network failure', async () => {
    const store = await getStore();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = function mockFetch(url, opts) {
      if (String(url).includes('/chat/completions')) {
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      return originalFetch.call(this, url, opts);
    };

    try {
      const { chatCompletion } = await import(`../src/server/minimax.mjs?v=${Date.now() + 1}`);
      const result = await chatCompletion({ prompt: 'ping', model: 'MiniMax-M3' });

      assert.equal(result.ok, false);
      assert.equal(result.error, 'network_error');

      const all = store.readAllRecords();
      const errorEntries = all.filter(r => r.error !== null);
      assert.ok(errorEntries.length >= 1);
      const entry = errorEntries[errorEntries.length - 1];
      assert.equal(entry.error.code, 'network_error');
      assert.equal(entry.endpoint, 'chat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('records an error usage entry on HTTP 429', async () => {
    const store = await getStore();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = function mockFetch(url, opts) {
      if (String(url).includes('/chat/completions')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: () => 'application/json' },
          text: () => Promise.resolve(JSON.stringify({
            base_resp: { status_code: 429, status_msg: 'Rate limit exceeded' },
          })),
        });
      }
      return originalFetch.call(this, url, opts);
    };

    try {
      const { chatCompletion } = await import(`../src/server/minimax.mjs?v=${Date.now() + 2}`);
      const result = await chatCompletion({ prompt: 'ping', model: 'MiniMax-M3' });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'http_429');

      const all = store.readAllRecords();
      const errorEntries = all.filter(r => r.error !== null);
      assert.ok(errorEntries.length >= 1);
      const entry = errorEntries[errorEntries.length - 1];
      assert.equal(entry.error.code, 'http_429');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── fetchRemains error handling ────────────────────────────────────────────

describe('fetchRemains — HTTP error messages (v5.5.2 fix)', () => {
  // Force a unique HOME so the test doesn't conflict with other minimax tests
  // that write to the same sandbox directory.
  const SANDBOX = mkdtempSync(join(tmpdir(), `bizar-minimax-404-${Date.now()}-`));
  const ORIG_HOME = process.env.HOME;
  const ORIG_BIZAR_STORE_HOME = process.env.BIZAR_STORE_HOME;

  before(() => {
    process.env.HOME = SANDBOX;
    process.env.BIZAR_STORE_HOME = join(SANDBOX, '.config', 'bizar');
    mkdirSync(process.env.BIZAR_STORE_HOME, { recursive: true });
  });

  after(() => {
    process.env.HOME = ORIG_HOME;
    process.env.BIZAR_STORE_HOME = ORIG_BIZAR_STORE_HOME ?? '';
    try { rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function mockRemains(url, status, body) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function mock(urlOrReq, opts) {
      const u = typeof urlOrReq === 'string' ? urlOrReq : urlOrReq?.url || String(urlOrReq);
      if (u.includes('/token_plan/remains')) {
        return Promise.resolve({
          ok: false,
          status,
          headers: { get: () => 'application/json' },
          statusText: status === 404 ? 'Not Found' : status === 401 ? 'Unauthorized' : status === 429 ? 'Too Many Requests' : 'Error',
          text: () => Promise.resolve(JSON.stringify(body || {})),
        });
      }
      return originalFetch.call(this, urlOrReq, opts);
    };
    try {
      // Import with cache-bust to get fresh module state with the new HOME.
      const { fetchRemains: fr } = await import(`../src/server/minimax.mjs?v=${Date.now()}`);
      return await fr({ force: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('404 returns a descriptive message (not just "Not Found")', async () => {
    const result = await mockRemains('/token_plan/remains', 404, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'http_404');
    assert.ok(
      result.message.includes('endpoint may have changed') ||
        result.message.includes('BizarHarness update'),
      `Expected descriptive 404 message, got: ${result.message}`,
    );
  });

  it('401/403 returns "invalid or expired key" message', async () => {
    const result = await mockRemains('/token_plan/remains', 401, {});
    assert.equal(result.ok, false);
    assert.ok(
      result.message.includes('invalid or expired'),
      `Expected "invalid or expired" message, got: ${result.message}`,
    );
  });

  it('429 returns "rate limit" message', async () => {
    const result = await mockRemains('/token_plan/remains', 429, {});
    assert.equal(result.ok, false);
    assert.ok(
      result.message.includes('rate limit'),
      `Expected "rate limit" message, got: ${result.message}`,
    );
  });
});
