import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInstalledAgent } from '../commands/claude-cmd.mjs';

test('subagent aliases resolve by frontmatter name, not only filename', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizar-agent-alias-'));
  try {
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(join(root, 'agents', 'senior-engineer.md'), '---\nname: todd\ndescription: test\n---\n');
    assert.equal(resolveInstalledAgent('todd', root), join(root, 'agents', 'senior-engineer.md'));
    assert.equal(resolveInstalledAgent('missing', root), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
