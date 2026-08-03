import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const skillPath = resolve('config/skills/i-have-adhd/SKILL.md');
const raw = readFileSync(skillPath, 'utf8');

describe('i-have-adhd skill', () => {
  it('has a name field set to i-have-adhd', () => {
    const match = raw.match(/^name:\s*(\S+)/m);
    assert.ok(match, 'name field present');
    assert.strictEqual(match[1], 'i-have-adhd');
  });

  it('has a description field', () => {
    const match = raw.match(/^description:\s*(.+)/m);
    assert.ok(match, 'description field present');
    assert.ok(match[1].length > 10, 'description is non-empty');
  });

  it('does NOT have disable-model-invocation in frontmatter', () => {
    // Must not have the key in YAML frontmatter; the body comment is required
    assert.ok(
      !raw.match(/^disable-model-invocation:/m),
      'disable-model-invocation frontmatter key must not be present — skill stays always-on'
    );
  });

  it('has a comment explaining the omission', () => {
    assert.ok(
      raw.includes('disable-model-invocation deliberately omitted'),
      'omission comment must be present in body'
    );
  });
});
