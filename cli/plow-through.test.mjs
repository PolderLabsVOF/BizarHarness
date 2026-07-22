/**
 * cli/plow-through.test.mjs
 *
 * Tests for the /plow-through slash command file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
// F-107: slash commands canonical at .claude/commands/. Legacy config/commands/ removed (Cline-era).
const CMD_PATH = join(PROJECT_ROOT, '.claude', 'commands', 'plow-through.md');

describe('/plow-through command file', () => {
  test('file exists at .claude/commands/plow-through.md', () => {
    assert.equal(existsSync(CMD_PATH), true, 'plow-through.md must exist');
  });

  test('YAML frontmatter has description field', () => {
    const content = readFileSync(CMD_PATH, 'utf8');
    assert.match(content, /^---\ndescription:/m, 'frontmatter must have description');
  });

  // F-107: legacy `agent: mike` frontmatter field was removed when slash
  // commands were migrated to Claude Code's `run_in_background: true`
  // Agent dispatch model. Routed agents are now inferred from the
  // command body via the thinking-route hook.

  test('body has content (more than 5 lines)', () => {
    const content = readFileSync(CMD_PATH, 'utf8');
    // Strip frontmatter
    const body = content.replace(/^---[\s\S]*?---\n/, '');
    const lines = body.trim().split('\n').filter(l => l.trim().length > 0);
    assert.ok(lines.length > 5, `body should have content, got ${lines.length} non-empty lines`);
  });

  test('body contains autonomous-mode contract keywords', () => {
    const content = readFileSync(CMD_PATH, 'utf8');
    const body = content.replace(/^---[\s\S]*?---\n/, '');
    const lower = body.toLowerCase();
    assert.ok(lower.includes('no clarifying questions') || lower.includes('no clarifying'), 'body must state no clarifying questions');
    assert.ok(lower.includes('parallel') || lower.includes('dispatch'), 'body must mention parallel dispatch');
    assert.ok(lower.includes('work to completion') || lower.includes('complete'), 'body must state work-to-completion');
  });

  test('body contains when NOT to use section', () => {
    const content = readFileSync(CMD_PATH, 'utf8');
    const lower = content.toLowerCase();
    assert.ok(lower.includes('when not to use'), 'body must have a when NOT to use section');
  });
});

console.log('  plow-through.test.mjs loaded — run with: node --test cli/plow-through.test.mjs');
