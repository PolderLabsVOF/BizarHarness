/**
 * tests/memory-schema.test.mjs
 *
 * Tests for the memory schema validator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateNote, defaultFrontmatter, REQUIRED_FIELDS, VALID_TYPES, VALID_STATUSES, VALID_CONFIDENCES } from '../src/server/memory-schema.mjs';

const NOW = new Date().toISOString();

describe('validateNote', () => {
  it('passes note with all required fields', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: ['arch', 'api'],
    };
    const { valid, errors } = validateNote(fm, 'Some body content');
    assert.strictEqual(valid, true);
    assert.deepStrictEqual(errors, []);
  });

  it('fails when memory_id is missing', () => {
    const fm = {
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: [],
    };
    const { valid, errors } = validateNote(fm, 'body');
    assert.strictEqual(valid, false);
    assert.ok(errors.some((e) => e.includes('memory_id')));
  });

  it('fails when type is invalid', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'unknown_type',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: [],
    };
    const { valid, errors } = validateNote(fm, 'body');
    assert.strictEqual(valid, false);
    assert.ok(errors.some((e) => e.includes('invalid type')));
  });

  it('fails when status is invalid', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'bogus',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: [],
    };
    const { valid, errors } = validateNote(fm, 'body');
    assert.strictEqual(valid, false);
    assert.ok(errors.some((e) => e.includes('invalid status')));
  });

  it('fails when confidence is invalid', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'bogus',
      created: NOW,
      updated: NOW,
      tags: [],
    };
    const { valid, errors } = validateNote(fm, 'body');
    assert.strictEqual(valid, false);
    assert.ok(errors.some((e) => e.includes('invalid confidence')));
  });

  it('fails when tags is not an array', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: 'not-an-array',
    };
    const { valid, errors } = validateNote(fm, 'body');
    assert.strictEqual(valid, false);
    assert.ok(errors.some((e) => e.includes('tags must be an array')));
  });

  it('warns when body is empty', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: NOW,
      updated: NOW,
      tags: [],
    };
    const { warnings } = validateNote(fm, '   \n\n  ');
    assert.ok(warnings.some((w) => w.includes('body is empty')));
  });

  it('warns when created/updated is not ISO date', () => {
    const fm = {
      memory_id: 'test_123',
      type: 'architecture_decision',
      project_id: 'my-project',
      status: 'active',
      confidence: 'verified',
      created: 'not-a-date',
      updated: 'also-not-a-date',
      tags: [],
    };
    const { warnings } = validateNote(fm, 'body');
    assert.ok(warnings.some((w) => w.includes('created')));
    assert.ok(warnings.some((w) => w.includes('updated')));
  });
});

describe('defaultFrontmatter', () => {
  it('fills in all missing required fields', () => {
    const result = defaultFrontmatter({ type: 'bug_pattern' });
    assert.ok(result.memory_id.startsWith('bug_pattern_'));
    assert.strictEqual(result.type, 'bug_pattern');
    assert.strictEqual(result.status, 'draft');
    assert.strictEqual(result.confidence, 'inferred');
    assert.ok(Array.isArray(result.tags));
    assert.ok(result.created);
    assert.ok(result.updated);
  });

  it('preserves user-provided values', () => {
    const result = defaultFrontmatter({
      type: 'command',
      project_id: 'my-project',
      status: 'active',
      tags: ['cli'],
    });
    assert.strictEqual(result.type, 'command');
    assert.strictEqual(result.project_id, 'my-project');
    assert.strictEqual(result.status, 'active');
    assert.deepStrictEqual(result.tags, ['cli']);
  });

  it('does not overwrite explicit memory_id', () => {
    const result = defaultFrontmatter({ memory_id: 'my-custom-id', type: 'session_summary' });
    assert.strictEqual(result.memory_id, 'my-custom-id');
  });
});

describe('schema constants', () => {
  it('REQUIRED_FIELDS has exactly 8 fields', () => {
    assert.strictEqual(REQUIRED_FIELDS.length, 8);
    assert.ok(REQUIRED_FIELDS.includes('memory_id'));
    assert.ok(REQUIRED_FIELDS.includes('type'));
    assert.ok(REQUIRED_FIELDS.includes('tags'));
  });

  it('VALID_TYPES has 11 types', () => {
    assert.strictEqual(VALID_TYPES.length, 11);
    assert.ok(VALID_TYPES.includes('architecture_decision'));
    assert.ok(VALID_TYPES.includes('session_summary'));
  });

  it('VALID_STATUSES has 6 statuses', () => {
    assert.strictEqual(VALID_STATUSES.length, 6);
    assert.ok(VALID_STATUSES.includes('active'));
    assert.ok(VALID_STATUSES.includes('conflict'));
  });

  it('VALID_CONFIDENCES has 3 values', () => {
    assert.strictEqual(VALID_CONFIDENCES.length, 3);
    assert.ok(VALID_CONFIDENCES.includes('verified'));
    assert.ok(VALID_CONFIDENCES.includes('inferred'));
    assert.ok(VALID_CONFIDENCES.includes('speculative'));
  });
});
