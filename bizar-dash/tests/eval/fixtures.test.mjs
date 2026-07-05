/**
 * tests/eval/fixtures.test.mjs
 *
 * v5.0.0 — Tests for fixture loading.
 *
 * Verifies:
 *   - Example fixtures load without errors
 *   - Fixture JSON is valid and has required fields
 *   - loadFixtures correctly loads from a directory
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL = await import('../../src/server/eval.mjs');

// Fixture files to validate
const EXAMPLE_FIXTURES = [
  '../../../templates/eval-fixtures/code-search-basic.json',
  '../../../templates/eval-fixtures/tool-call-correctness.json',
  '../../../templates/eval-fixtures/response-format.json',
  '../../../templates/eval-fixtures/latency-bounds.json',
  '../../../templates/eval-fixtures/regression-suite.json',
];

const REQUIRED_FIELDS = ['id', 'name', 'description', 'agent', 'prompt', 'expected'];
const REQUIRED_EXPECTED = ['contains', 'notContains', 'regex', 'jsonSchema', 'maxTokens', 'maxLatencyMs'];

describe('eval fixtures', () => {

  describe('example fixtures from templates/', () => {

    for (const fixturePath of EXAMPLE_FIXTURES) {
      const fullPath = join(__dirname, fixturePath);
      it(`loads and validates: ${fixturePath}`, async () => {
        // Dynamically import so we can check it parses
        const { readFileSync } = await import('node:fs');
        const raw = readFileSync(fullPath, 'utf8');
        const fixture = JSON.parse(raw);

        // Should have id
        assert.ok(fixture.id, 'fixture must have an id');

        // If it's a suite with fixtures array, validate each
        if (fixture.fixtures && Array.isArray(fixture.fixtures)) {
          assert.ok(fixture.fixtures.length > 0, 'suite must have at least one fixture');
          for (const f of fixture.fixtures) {
            validateFixture(f);
          }
        } else {
          // Single fixture
          validateFixture(fixture);
        }
      });
    }
  });

  describe('loadFixtures', () => {
    it('loads fixtures from a directory', async () => {
      const fixturesDir = join(__dirname, '../../../templates/eval-fixtures');
      const fixtures = EVAL.loadFixtures(fixturesDir);
      assert.ok(fixtures.length >= 4, `Expected at least 4 fixtures, got ${fixtures.length}`);
    });

    it('skips non-JSON files', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const testDir = join(tmpdir(), `eval-load-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'readme.md'), '# readme');
      writeFileSync(join(testDir, 'valid.json'), JSON.stringify({
        id: 'test',
        name: 'Test',
        description: 'Test',
        agent: 'thor',
        prompt: 'test',
        expected: { contains: [] },
      }));
      const fixtures = EVAL.loadFixtures(testDir);
      rmSync(testDir, { recursive: true, force: true });
      assert.strictEqual(fixtures.length, 1);
      assert.strictEqual(fixtures[0].id, 'test');
    });

    it('skips invalid JSON files', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const testDir = join(tmpdir(), `eval-invalid-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'invalid.json'), 'not valid json {');
      writeFileSync(join(testDir, 'valid.json'), JSON.stringify({
        id: 'test2',
        name: 'Test2',
        description: 'Test2',
        agent: 'thor',
        prompt: 'test',
        expected: { contains: [] },
      }));
      const fixtures = EVAL.loadFixtures(testDir);
      rmSync(testDir, { recursive: true, force: true });
      assert.strictEqual(fixtures.length, 1);
      assert.strictEqual(fixtures[0].id, 'test2');
    });

    it('returns empty array for non-existent directory', async () => {
      const fixtures = EVAL.loadFixtures('/nonexistent/path/xyz');
      assert.strictEqual(fixtures.length, 0);
    });
  });
});

/**
 * Validate a fixture object has required fields
 * @param {object} fixture
 */
function validateFixture(fixture) {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(
      fixture[field] !== undefined && fixture[field] !== null,
      `fixture ${fixture.id || 'unknown'} missing required field: ${field}`,
    );
  }
  assert.ok(
    typeof fixture.expected === 'object',
    `fixture ${fixture.id} expected must be an object`,
  );
  // expected should have at least one check type
  const expected = fixture.expected;
  const hasCheckType = [
    expected.contains,
    expected.notContains,
    expected.regex,
    expected.jsonSchema,
    expected.maxTokens,
    expected.maxLatencyMs,
  ].some((v) => v !== undefined && v !== null);
  assert.ok(hasCheckType, `fixture ${fixture.id} expected must have at least one check type`);
}
