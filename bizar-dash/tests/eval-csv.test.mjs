// tests/eval-csv.test.mjs — v5.3.0
// Tests for CSV export functionality in eval.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toCSV } from '../src/server/eval.mjs';

describe('CSV export', () => {
  it('produces valid CSV with headers', () => {
    const csv = toCSV([
      { fixtureId: 'test-1', name: 'Test', ok: true, latencyMs: 100, checks: [] },
    ]);
    assert.ok(csv.split('\n')[0].includes('fixture_id'));
    assert.ok(csv.split('\n')[0].includes('name'));
    assert.ok(csv.split('\n')[0].includes('ok'));
    assert.ok(csv.split('\n')[0].includes('pass_count'));
    assert.ok(csv.split('\n')[0].includes('fail_count'));
    assert.ok(csv.split('\n')[0].includes('latency_ms'));
    assert.ok(csv.split('\n')[0].includes('tokens'));
    assert.ok(csv.split('\n')[0].includes('timestamp'));
  });

  it('escapes commas in values', () => {
    const csv = toCSV([{ fixtureId: 'a,b', ok: true, checks: [] }]);
    assert.ok(csv.includes('"a,b"'));
  });

  it('escapes quotes in values', () => {
    const csv = toCSV([{ fixtureId: 'a"b', ok: true, checks: [] }]);
    assert.ok(csv.includes('"a""b"'));
  });

  it('handles newlines in values', () => {
    const csv = toCSV([{ fixtureId: 'a\nb', ok: true, checks: [] }]);
    assert.ok(csv.includes('"a\nb"'));
  });

  it('outputs ok as 1 or 0', () => {
    const csvPass = toCSV([{ fixtureId: 'p', ok: true, checks: [] }]);
    const csvFail = toCSV([{ fixtureId: 'f', ok: false, checks: [] }]);
    assert.ok(csvPass.match(/,1,/));
    assert.ok(csvFail.match(/,0,/));
  });

  it('counts pass/fail checks correctly', () => {
    const csv = toCSV([
      {
        fixtureId: 'c1',
        ok: false,
        checks: [
          { pass: true },
          { pass: false, message: 'failed check' },
          { pass: true },
        ],
      },
    ]);
    // pass_count=2, fail_count=1
    const row = csv.split('\n')[1];
    assert.ok(row.match(/c1.*,2,1/));
  });

  it('returns empty string for missing optional fields', () => {
    const csv = toCSV([{ fixtureId: 'minimal' }]);
    // Should not throw and should have all 9 columns
    assert.strictEqual(csv.split('\n')[0].split(',').length, 9);
  });
});
