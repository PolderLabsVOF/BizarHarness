import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const HOOK = join(ROOT, 'precompact-priorities.sh');

test('precompact hook checkpoints bounded state and emits recovery instructions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-compact-'));
  const project = mkdtempSync(join(tmpdir(), 'bizar-project-'));
  mkdirSync(join(project, '.ok'), { recursive: true });
  writeFileSync(join(project, 'DECISIONS.md'), 'decision record\n'.repeat(2000));
  writeFileSync(join(project, '.ok', 'index.json'), '{"tasks":["tsk-1"]}');
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreCompact',
      session_id: 'session/with unsafe chars',
      trigger: 'auto',
      custom_instructions: `password=hunter2 ${'private '.repeat(100)}`,
      cwd: project,
      transcript_path: '/tmp/transcript.jsonl',
    }),
    env: { ...process.env, BIZAR_COMPACTION_DIR: dir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /priority-preservation-instructions/);
  assert.match(result.stdout, /Durable checkpoint:/);
  const checkpointPath = join(dir, 'session_with_unsafe_chars.json');
  const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
  assert.equal(checkpoint.schema, 'bizar.compaction-checkpoint.v1');
  assert.equal(checkpoint.trigger, 'auto');
  assert.equal(checkpoint.transcriptPath, '/tmp/transcript.jsonl');
  assert.equal('customInstructions' in checkpoint, false);
  assert.match(checkpoint.customInstructionsHash, /^[a-f0-9]{64}$/);
  assert.ok(checkpoint.customInstructionsBytes > 100);
  assert.equal(checkpoint.openKanIndex, '{"tasks":["tsk-1"]}');
  assert.equal('featureList' in checkpoint, false);
  assert.equal('progress' in checkpoint, false);
  assert.ok(checkpoint.decisions.length <= 16000);
  assert.ok(readFileSync(checkpointPath).length < 60_000);
  assert.match(checkpoint.contentHash, /^[a-f0-9]{64}$/);
});
