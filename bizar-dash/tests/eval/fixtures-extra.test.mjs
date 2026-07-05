/**
 * tests/eval/fixtures-extra.test.mjs
 *
 * v5.0.0 — Tests for expanded fixture set (10 new fixtures).
 *
 * Verifies:
 *   - All 15 fixtures load without errors
 *   - All fixtures have valid JSON and required fields
 *   - runFixtureById correctly resolves and runs fixtures
 *   - New expectation types (toolCallsMin, toolSequence, minItems) work
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL = await import('../../src/server/eval.mjs');

const FIXTURES_DIR = join(__dirname, '../../../templates/eval-fixtures');

const REQUIRED_FIELDS = ['id', 'name', 'description', 'agent', 'prompt', 'expected', 'tags'];
const REQUIRED_EXPECTED_FIELDS = ['contains', 'notContains', 'regex', 'jsonSchema', 'maxTokens', 'maxLatencyMs'];

// Expected fixture IDs - the new 10 fixtures
const NEW_FIXTURE_IDS = [
  'tool-call-multi-step',
  'error-recovery',
  'context-window',
  'json-output',
  'code-review',
  'unicode-handling',
  'multi-language',
  'safe-paths',
  'concise-output',
  'citation',
];

describe('eval fixtures (extra 10)', () => {

  describe('loadFixtures loads all 15 fixtures', () => {
    it('loads at least 15 fixtures from the directory', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      assert.ok(fixtures.length >= 15, `Expected at least 15 fixtures, got ${fixtures.length}`);
    });

    it('loads all expected fixture IDs', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const ids = fixtures.map((f) => f.id);
      for (const expectedId of NEW_FIXTURE_IDS) {
        assert.ok(
          ids.includes(expectedId),
          `Expected fixture ID "${expectedId}" not found in: ${ids.join(', ')}`,
        );
      }
    });
  });

  describe('each new fixture validates correctly', () => {
    const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
    const newFixtures = fixtures.filter((f) =>
      NEW_FIXTURE_IDS.includes(f.id)
    );

    for (const fixture of newFixtures) {
      it(`fixture "${fixture.id}" has valid JSON structure`, () => {
        // Required fields
        for (const field of REQUIRED_FIELDS) {
          assert.ok(
            fixture[field] !== undefined && fixture[field] !== null,
            `fixture "${fixture.id}" missing required field: ${field}`,
          );
        }

        // expected must be an object
        assert.ok(
          typeof fixture.expected === 'object',
          `fixture "${fixture.id}".expected must be an object`,
        );

        // tags must be an array
        assert.ok(
          Array.isArray(fixture.tags),
          `fixture "${fixture.id}".tags must be an array`,
        );
      });

      it(`fixture "${fixture.id}" has at least one check type`, () => {
        const expected = fixture.expected;
        const hasCheckType = [
          expected.contains,
          expected.notContains,
          expected.regex,
          expected.jsonSchema,
          expected.maxTokens,
          expected.maxLatencyMs,
          expected.toolCallsMin,
          expected.toolSequence,
        ].some((v) => v !== undefined && v !== null);
        assert.ok(hasCheckType, `fixture "${fixture.id}" expected must have at least one check type`);
      });
    }
  });

  describe('runFixtureById', () => {
    it('resolves and runs a fixture by id', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'ok',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      const result = await EVAL.runFixtureById('latency-bounds', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      assert.strictEqual(result.fixtureId, 'latency-bounds');
      assert.ok(result.checks.length > 0, 'should have run checks');
    });

    it('throws for unknown fixture id', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({ content: 'ok', usage: { totalTokens: 0 } });
      await assert.rejects(
        () => EVAL.runFixtureById('nonexistent-fixture', fixtures, { llmCall: mockLlmCall }),
        /Fixture not found/,
      );
    });
  });

  describe('toolCallsMin check', () => {
    it('passes when tool calls meet minimum', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'found it',
        usage: { totalTokens: 100 },
      });
      const result = await EVAL.runFixtureById('tool-call-multi-step', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
        toolCalls: ['search', 'read', 'search'],
      });
      // The toolCallsMin check should be in the results
      const toolCallsMinCheck = result.checks.find((c) => c.kind === 'toolCallsMin');
      assert.ok(toolCallsMinCheck, 'should have a toolCallsMin check');
      assert.ok(toolCallsMinCheck.ok, `toolCallsMin check should pass: ${toolCallsMinCheck.message}`);
    });

    it('fails when tool calls are below minimum', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'found it',
        usage: { totalTokens: 100 },
      });
      const result = await EVAL.runFixtureById('tool-call-multi-step', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
        toolCalls: ['search'], // only 1, requires 3
      });
      const toolCallsMinCheck = result.checks.find((c) => c.kind === 'toolCallsMin');
      assert.ok(toolCallsMinCheck, 'should have a toolCallsMin check');
      assert.ok(!toolCallsMinCheck.ok, 'toolCallsMin check should fail');
    });
  });

  describe('toolSequence check', () => {
    it('passes when tool sequence matches', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'found it',
        usage: { totalTokens: 100 },
      });
      const result = await EVAL.runFixtureById('tool-call-multi-step', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
        toolCalls: ['search', 'read', 'search'],
      });
      const seqCheck = result.checks.find((c) => c.kind === 'toolSequence');
      assert.ok(seqCheck, 'should have a toolSequence check');
      assert.ok(seqCheck.ok, `toolSequence check should pass: ${seqCheck.message}`);
    });

    it('fails when tool sequence does not match', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'found it',
        usage: { totalTokens: 100 },
      });
      const result = await EVAL.runFixtureById('tool-call-multi-step', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
        toolCalls: ['read', 'search', 'search'], // wrong order
      });
      const seqCheck = result.checks.find((c) => c.kind === 'toolSequence');
      assert.ok(seqCheck, 'should have a toolSequence check');
      assert.ok(!seqCheck.ok, 'toolSequence check should fail');
    });
  });

  describe('jsonSchema minItems check', () => {
    it('passes when array has enough items', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: '["red", "green", "blue"]',
        usage: { totalTokens: 50 },
      });
      const result = await EVAL.runFixtureById('json-output', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      const jsonCheck = result.checks.find((c) => c.kind === 'jsonSchema');
      assert.ok(jsonCheck, 'should have a jsonSchema check');
      assert.ok(jsonCheck.ok, `jsonSchema check should pass: ${jsonCheck.message}`);
    });

    it('fails when array has too few items', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: '["red"]',
        usage: { totalTokens: 50 },
      });
      const result = await EVAL.runFixtureById('json-output', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      const jsonCheck = result.checks.find((c) => c.kind === 'jsonSchema');
      assert.ok(jsonCheck, 'should have a jsonSchema check');
      assert.ok(!jsonCheck.ok, 'jsonSchema check should fail for short array');
    });
  });

  describe('notContains check', () => {
    it('passes when forbidden content is absent', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'The file was not found',
        usage: { totalTokens: 50 },
      });
      const result = await EVAL.runFixtureById('error-recovery', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      // Should not contain crash or panic
      const notContainsChecks = result.checks.filter((c) => c.kind === 'notContains');
      assert.ok(notContainsChecks.length > 0, 'should have notContains checks');
      for (const check of notContainsChecks) {
        assert.ok(check.ok, `notContains "${check.message}" should pass`);
      }
    });

    it('fails when forbidden content is present', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'The system crashed and panicked',
        usage: { totalTokens: 50 },
      });
      const result = await EVAL.runFixtureById('error-recovery', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      const notContainsChecks = result.checks.filter((c) => c.kind === 'notContains');
      assert.ok(notContainsChecks.length > 0, 'should have notContains checks');
      assert.ok(!result.ok, 'overall result should fail');
    });
  });

  describe('regex check', () => {
    it('passes when regex matches', async () => {
      const fixtures = EVAL.loadFixtures(FIXTURES_DIR);
      const mockLlmCall = async () => ({
        content: 'The function is at src/utils/add.ts:42',
        usage: { totalTokens: 50 },
      });
      const result = await EVAL.runFixtureById('citation', fixtures, {
        llmCall: mockLlmCall,
        timeoutMs: 5000,
      });
      const regexChecks = result.checks.filter((c) => c.kind === 'regex');
      assert.ok(regexChecks.length > 0, 'should have regex checks');
      for (const check of regexChecks) {
        assert.ok(check.ok, `regex "${check.message}" should pass`);
      }
    });
  });
});
