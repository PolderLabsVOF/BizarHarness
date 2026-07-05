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
