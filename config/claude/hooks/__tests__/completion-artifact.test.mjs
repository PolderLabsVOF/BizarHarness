import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifactSetting } from '../../../../cli/commands/artifact.mjs';
import { COMPLETE_MARKER, createCompletionArtifact } from '../completion-artifact.mjs';

test('completion artifact uses global toggle, escapes HTML, and opens once', () => {
  const home = mkdtempSync(join(tmpdir(), 'bizar-artifact-'));
  try {
    const env = { BIZAR_HOME: home };
    writeArtifactSetting(true, { env, cwd: '/tmp/a' });
    const opened = [];
    const result = createCompletionArtifact({ cwd: '/tmp/b', session_id: 's1', last_assistant_message: `Done <script>x</script> ${COMPLETE_MARKER}` }, { env, open: (path) => opened.push(path), now: new Date('2026-09-01T12:00:00Z') });
    assert.equal(result.created, true);
    assert.equal(opened.length, 1);
    const html = readFileSync(result.path, 'utf8');
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
    assert.doesNotMatch(html, /bizar:complete/);
    writeArtifactSetting(false, { env, cwd: '/tmp/c' });
    assert.deepEqual(createCompletionArtifact({ cwd: '/tmp/a', last_assistant_message: COMPLETE_MARKER }, { env, open: () => opened.push('bad') }), { created: false, reason: 'disabled' });
    assert.equal(opened.length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('ordinary and in-progress responses do not create artifacts', () => {
  assert.deepEqual(createCompletionArtifact({ last_assistant_message: 'Still working' }, { env: { BIZAR_HOME: '/tmp/unused' }, open() {} }), { created: false, reason: 'not-complete' });
});
