/**
 * tests/yaml.test.mjs
 *
 * Tests for the YAML frontmatter parser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseFrontmatter, serializeFrontmatter, parseBlock, serializeBlock } from '../src/server/yaml.mjs';

describe('parseFrontmatter', () => {
  it('parses empty frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter('hello world');
    assert.deepStrictEqual(frontmatter, {});
    assert.strictEqual(body, 'hello world');
  });

  it('parses scalar fields', () => {
    const raw = `---\ntitle: Test Note\ncount: 42\nactive: true\n---\n\nBody content`;
    const { frontmatter, body } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.title, 'Test Note');
    assert.strictEqual(frontmatter.count, 42);
    assert.strictEqual(frontmatter.active, true);
    assert.strictEqual(body, 'Body content');
  });

  it('parses integer and float', () => {
    const raw = `---\na: 42\nb: 3.14\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.a, 42);
    assert.strictEqual(frontmatter.b, 3.14);
  });

  it('parses boolean values', () => {
    const raw = `---\na: true\nb: false\nc: yes\nd: no\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.a, true);
    assert.strictEqual(frontmatter.b, false);
    assert.strictEqual(frontmatter.c, true);
    assert.strictEqual(frontmatter.d, false);
  });

  it('parses inline list', () => {
    const raw = `---\ntags: [memory, architecture, planning]\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.deepStrictEqual(frontmatter.tags, ['memory', 'architecture', 'planning']);
  });

  it('parses block list', () => {
    const raw = `---\ntags:\n  - memory\n  - architecture\n  - planning\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.deepStrictEqual(frontmatter.tags, ['memory', 'architecture', 'planning']);
  });

  it('parses multi-line literal block', () => {
    const raw = `---\nbody: |\n  line one\n  line two\n  line three\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.body, 'line one\nline two\nline three');
  });

  it('ignores comment lines', () => {
    const raw = `---\n# this is a comment\ntitle: Test\n# another comment\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.title, 'Test');
    assert(!('title # another comment' in frontmatter));
  });

  it('parses quoted strings', () => {
    const raw = `---\ntitle: "Hello World"\nsubtitle: 'Subtitle Here'\n---\n`;
    const { frontmatter } = parseFrontmatter(raw);
    assert.strictEqual(frontmatter.title, 'Hello World');
    assert.strictEqual(frontmatter.subtitle, 'Subtitle Here');
  });

  it('roundtrips through serialize + parse', () => {
    const original = { title: 'Test', count: 42, tags: ['a', 'b'] };
    const serialized = serializeBlock(original);
    const reparsed = parseBlock(serialized);
    assert.strictEqual(reparsed.title, 'Test');
    assert.strictEqual(reparsed.count, 42);
    assert.deepStrictEqual(reparsed.tags, ['a', 'b']);
  });
});

describe('serializeFrontmatter', () => {
  it('serializes scalars', () => {
    const fm = { title: 'My Note', count: 10, active: true };
    const out = serializeFrontmatter(fm);
    assert.ok(out.includes('title: My Note'));
    assert.ok(out.includes('count: 10'));
    assert.ok(out.includes('active: true'));
  });

  it('serializes arrays as inline lists when possible', () => {
    const fm = { tags: ['memory', 'arch'] };
    const out = serializeFrontmatter(fm);
    assert.ok(out.includes('tags: [memory, arch]'));
  });

  it('serializes multi-line strings as literal blocks', () => {
    const fm = { body: 'line1\nline2\nline3' };
    const out = serializeFrontmatter(fm);
    assert.ok(out.includes('body: |'));
    assert.ok(out.includes('  line1'));
  });

  it('empty frontmatter returns empty string', () => {
    assert.strictEqual(serializeFrontmatter({}), '');
  });
});

describe('parseBlock', () => {
  it('parses a simple key-value block', () => {
    const result = parseBlock('title: Hello\nstatus: active');
    assert.strictEqual(result.title, 'Hello');
    assert.strictEqual(result.status, 'active');
  });

  it('handles empty block', () => {
    const result = parseBlock('');
    assert.deepStrictEqual(result, {});
  });

  it('parses ISO date strings as-is', () => {
    const result = parseBlock('created: 2026-01-15T10:30:00Z');
    assert.strictEqual(result.created, '2026-01-15T10:30:00Z');
  });
});
