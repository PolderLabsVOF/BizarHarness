/**
 * tests/eval/runner.test.mjs
 *
 * v5.0.0 — Tests for the eval runner.
 *
 * Verifies:
 *   - runFixture returns correct shape
 *   - All check types work (contains, notContains, regex, jsonSchema, maxTokens, maxLatencyMs)
 *   - Latency tracking
 *   - Timeout enforcement
 *   - Suite parallelism
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL = await import('../../src/server/eval.mjs');

// ── Mock LLM call helpers ──────────────────────────────────────────────────────

function mockLlmCall({ content = 'ok', latencyMs = 10, tokens = 100 } = {}) {
  return async (prompt, opts) => {
    await new Promise((r) => setTimeout(r, latencyMs));
    return {
      content,
      usage: {
        inputTokens: tokens,
        outputTokens: tokens,
        totalTokens: tokens * 2,
      },
    };
  };
}

function failingLlmCall() {
  return async (prompt, opts) => {
    throw new Error('LLM error');
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

describe('eval runner', () => {

  describe('runFixture', () => {

    it('returns correct shape', async () => {
      const fixture = {
        id: 'test-fixture',
        name: 'Test',
        description: 'Test fixture',
        agent: 'thor',
        prompt: 'Say hello',
        expected: {},
      };

      const result = await EVAL.runFixture(fixture, {
        llmCall: mockLlmCall({ content: 'hello world' }),
      });

      assert.strictEqual(result.fixtureId, 'test-fixture');
      assert.strictEqual(typeof result.ok, 'boolean');
      assert.ok(Array.isArray(result.checks));
      assert.ok(typeof result.latencyMs === 'number');
      assert.strictEqual(result.content, 'hello world');
      assert.ok(result.usage);
      assert.strictEqual(result.usage.totalTokens, 200);
    });

    describe('contains check', () => {
      it('passes when content includes expected substring', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { contains: ['hello', 'world'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello world' }),
        });
        assert.strictEqual(result.ok, true);
        const containsCheck = result.checks.find((c) => c.kind === 'contains');
        assert.ok(containsCheck);
        assert.strictEqual(containsCheck.ok, true);
      });

      it('fails when content does not include expected substring', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { contains: ['goodbye'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello world' }),
        });
        assert.strictEqual(result.ok, false);
        const containsCheck = result.checks.find((c) => c.kind === 'contains');
        assert.ok(containsCheck);
        assert.strictEqual(containsCheck.ok, false);
        assert.ok(containsCheck.message.includes('goodbye'));
      });
    });

    describe('notContains check', () => {
      it('passes when content does NOT include forbidden substring', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { notContains: ['error', 'fail'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello world' }),
        });
        assert.strictEqual(result.ok, true);
        const notContainsCheck = result.checks.find((c) => c.kind === 'notContains');
        assert.ok(notContainsCheck);
        assert.strictEqual(notContainsCheck.ok, true);
      });

      it('fails when content includes forbidden substring', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { notContains: ['error'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello error world' }),
        });
        assert.strictEqual(result.ok, false);
        const notContainsCheck = result.checks.find((c) => c.kind === 'notContains');
        assert.ok(notContainsCheck);
        assert.strictEqual(notContainsCheck.ok, false);
      });
    });

    describe('regex check', () => {
      it('passes when regex matches', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { regex: ['hello\\s+world'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello world' }),
        });
        assert.strictEqual(result.ok, true);
        const regexCheck = result.checks.find((c) => c.kind === 'regex');
        assert.ok(regexCheck);
        assert.strictEqual(regexCheck.ok, true);
      });

      it('fails when regex does not match', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { regex: ['goodbye\\s+world'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello world' }),
        });
        assert.strictEqual(result.ok, false);
        const regexCheck = result.checks.find((c) => c.kind === 'regex');
        assert.ok(regexCheck);
        assert.strictEqual(regexCheck.ok, false);
      });

      it('fails gracefully on invalid regex', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { regex: ['[invalid'] },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'hello' }),
        });
        assert.strictEqual(result.ok, false);
        const regexCheck = result.checks.find((c) => c.kind === 'regex');
        assert.ok(regexCheck);
        assert.strictEqual(regexCheck.ok, false);
        assert.ok(regexCheck.message.includes('invalid regex'));
      });
    });

    describe('jsonSchema check', () => {
      it('passes when response is valid JSON matching schema', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: {
            jsonSchema: {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string' } },
            },
          },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: '{"status": "ok"}' }),
        });
        assert.strictEqual(result.ok, true);
        const schemaCheck = result.checks.find((c) => c.kind === 'jsonSchema');
        assert.ok(schemaCheck);
        assert.strictEqual(schemaCheck.ok, true);
      });

      it('fails when response is not valid JSON', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { jsonSchema: { type: 'object' } },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: 'not json' }),
        });
        assert.strictEqual(result.ok, false);
        const schemaCheck = result.checks.find((c) => c.kind === 'jsonSchema');
        assert.ok(schemaCheck);
        assert.strictEqual(schemaCheck.ok, false);
      });

      it('fails when required property is missing', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: {
            jsonSchema: {
              type: 'object',
              required: ['version'],
              properties: { version: { type: 'string' } },
            },
          },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ content: '{"status": "ok"}' }),
        });
        assert.strictEqual(result.ok, false);
        const schemaCheck = result.checks.find((c) => c.kind === 'jsonSchema');
        assert.ok(schemaCheck);
        assert.strictEqual(schemaCheck.ok, false);
        assert.ok(schemaCheck.message.includes('missing required property'));
      });
    });

    describe('maxTokens check', () => {
      it('passes when token count is under limit', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { maxTokens: 1000 },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ tokens: 100 }),
        });
        assert.strictEqual(result.ok, true);
        const tokenCheck = result.checks.find((c) => c.kind === 'maxTokens');
        assert.ok(tokenCheck);
        assert.strictEqual(tokenCheck.ok, true);
      });

      it('fails when token count exceeds limit', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { maxTokens: 50 },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ tokens: 100 }),
        });
        assert.strictEqual(result.ok, false);
        const tokenCheck = result.checks.find((c) => c.kind === 'maxTokens');
        assert.ok(tokenCheck);
        assert.strictEqual(tokenCheck.ok, false);
        assert.ok(tokenCheck.message.includes('exceeds max'));
      });
    });

    describe('maxLatencyMs check', () => {
      it('passes when latency is under limit', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { maxLatencyMs: 5000 },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ latencyMs: 10 }),
        });
        assert.strictEqual(result.ok, true);
        const latencyCheck = result.checks.find((c) => c.kind === 'maxLatencyMs');
        assert.ok(latencyCheck);
        assert.strictEqual(latencyCheck.ok, true);
      });

      it('fails when latency exceeds limit', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: { maxLatencyMs: 5 },
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: mockLlmCall({ latencyMs: 100 }),
        });
        assert.strictEqual(result.ok, false);
        const latencyCheck = result.checks.find((c) => c.kind === 'maxLatencyMs');
        assert.ok(latencyCheck);
        assert.strictEqual(latencyCheck.ok, false);
        assert.ok(latencyCheck.message.includes('exceeds max'));
      });
    });

    describe('timeout enforcement', () => {
      it('returns timeout check on timeout', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: {},
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: async () => {
            await new Promise((r) => setTimeout(r, 200));
            return { content: 'ok', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
          },
          timeoutMs: 50,
        });
        assert.strictEqual(result.ok, false);
        const timeoutCheck = result.checks.find((c) => c.kind === 'timeout');
        assert.ok(timeoutCheck);
        assert.strictEqual(timeoutCheck.ok, false);
      });
    });

    describe('error handling', () => {
      it('returns error check when LLM call throws', async () => {
        const fixture = {
          id: 'test',
          agent: 'thor',
          prompt: 'test',
          expected: {},
        };
        const result = await EVAL.runFixture(fixture, {
          llmCall: failingLlmCall(),
        });
        assert.strictEqual(result.ok, false);
        const errorCheck = result.checks.find((c) => c.kind === 'error');
        assert.ok(errorCheck);
        assert.strictEqual(errorCheck.ok, false);
        assert.ok(errorCheck.message.includes('LLM error'));
      });
    });
  });

  describe('runSuite', () => {
    const suiteDir = join(tmpdir(), `eval-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    beforeEach(() => {
      mkdirSync(suiteDir, { recursive: true });
      writeFileSync(join(suiteDir, 'fix1.json'), JSON.stringify({
        id: 'fix1',
        name: 'Fix 1',
        description: 'First fixture',
        agent: 'thor',
        prompt: 'Say hello',
        expected: { contains: ['hello'] },
      }));
      writeFileSync(join(suiteDir, 'fix2.json'), JSON.stringify({
        id: 'fix2',
        name: 'Fix 2',
        description: 'Second fixture',
        agent: 'thor',
        prompt: 'Say goodbye',
        expected: { contains: ['goodbye'] },
      }));
    });

    afterEach(() => {
      rmSync(suiteDir, { recursive: true, force: true });
    });

    it('runs all fixtures in a directory', async () => {
      const result = await EVAL.runSuite(suiteDir, {
        llmCall: mockLlmCall({ content: 'hello and goodbye' }),
        concurrency: 5,
      });
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.passed, 2);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(result.results.length, 2);
    });

    it('reports failures correctly', async () => {
      const result = await EVAL.runSuite(suiteDir, {
        llmCall: mockLlmCall({ content: 'hello only' }),
        concurrency: 5,
      });
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.passed, 1);
      assert.strictEqual(result.failed, 1);
    });

    it('runs fixtures in parallel batches', async () => {
      const start = Date.now();
      // Create 6 fixtures with unique IDs to test batching
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(suiteDir, `batch${i}.json`), JSON.stringify({
          id: `batch${i}`,
          name: `Batch ${i}`,
          description: 'Test fixture',
          agent: 'thor',
          prompt: 'Say hello',
          expected: { contains: ['hello'] },
        }));
      }
      const result = await EVAL.runSuite(suiteDir, {
        llmCall: mockLlmCall({ latencyMs: 50 }),
        concurrency: 3,
      });
      // 2 original (fix1, fix2) + 6 new (batch0-5) = 8
      assert.ok(result.total >= 8, `Expected at least 8 fixtures, got ${result.total}`);
      // Parallel batches should complete faster than sequential
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 500, `Should complete quickly, took ${elapsed}ms`);
    });

    it('handles suite with no fixtures', async () => {
      const emptyDir = join(tmpdir(), `eval-empty-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });
      const result = await EVAL.runSuite(emptyDir, {
        llmCall: mockLlmCall(),
        concurrency: 5,
      });
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.passed, 0);
      assert.strictEqual(result.failed, 0);
      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('loads suite JSON with array of fixtures', async () => {
      const suiteFile = join(suiteDir, 'suite.json');
      writeFileSync(suiteFile, JSON.stringify({
        id: 'my-suite',
        fixtures: [
          { id: 'f1', name: 'F1', description: 'F1', agent: 'thor', prompt: 'hi', expected: { contains: ['hi'] } },
          { id: 'f2', name: 'F2', description: 'F2', agent: 'thor', prompt: 'bye', expected: { contains: ['bye'] } },
        ],
      }));
      const result = await EVAL.runSuite(suiteDir, {
        llmCall: mockLlmCall({ content: 'hi and bye' }),
        concurrency: 5,
      });
      assert.strictEqual(result.total, 4); // 2 individual + 2 in suite
    });
  });
});
