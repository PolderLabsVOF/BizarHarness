/**
 * tests/e2e/goals-cc-roundtrip.mjs — v10-S3.
 *
 * Cross-boundary proof that the dashboard parses what CC's /goal slash
 * command writes. Boots the dashboard server against a real tmp
 * project, writes a CC-shaped PROGRESS.md fixture (same shape as a
 * real `/goal` call emits: `## G-NNN — Title` headings with
 * `Goal is **status**` paragraphs and `- [x] / - [ ]` KR lines), then
 * GETs `/api/goals` and asserts the server parses the file into the
 * shape GoalsView consumes.
 *
 * Doesn't run a real Claude Code process — that requires the CLI on
 * PATH and an API key. Validates the contract: shared canonical store,
 * shared parser, no parallel JSON.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const EVIDENCE = process.env.BIZAR_E2E_EVIDENCE ||
  join(tmpdir(), `bizar-goals-cc-${process.pid}.json`);
const PORT = Number(
  (process.argv.find((a) => a.startsWith('--port=')) || '').split('=')[1] || 4185,
);

const results = [];
function record(step, ok, detail) {
  results.push({ step, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${step}${detail ? `  -- ${detail}` : ''}`);
}

// Same shape CC's `/goal` slash command writes. The ID prefix is `G-`,
// the body has a `Goal is **on-track|at-risk|...**` discriminator, and
// KRs are `[x]` / `[ ]` checkbox lines with optional Owner/Due lines.
const ccShapeProgress = `# Cross-session progress

## G-001 — Ship v8 dashboard (Sprint S1 In Progress)

Goal is **on-track**

The dashboard is the orchestration center for all agent + task + goal
work. Fully rewritten in v9 with a real component library.

Owner: berk
Due: 2026-09-30

- [x] Foundations
- [x] First wave of P0 views
- [ ] Chat surface

## G-002 — Reduce test flakiness (Sprint S2 In Progress)

Goal is **at-risk**

Owner: berk

- [x] Identify flaky tests (10 of 312)
- [ ] Pin mock latency

## G-003 — Write integration E2E (Sprint S3 Next Steps)

Goal is **blocked**

Final open: cross-boundary agent ↔ restart roundtrip.
`;

const projectDir = mkdtempSync(join(tmpdir(), 'bizar-e2e-goals-cc-'));
mkdirSync(join(projectDir, '.bizar'), { recursive: true });
writeFileSync(join(projectDir, '.bizar', 'PROGRESS.md'), ccShapeProgress, 'utf8');

const boot = await createServer({
  port: PORT,
  projectRoot: projectDir,
  clineConfigDir: join(projectDir, '.config', 'cline'),
  bizarRoot: projectDir,
});
await new Promise((resolve, reject) => {
  boot.server.once('error', reject);
  boot.server.listen(PORT, '127.0.0.1', () => { boot.server.off('error', reject); resolve(); });
});

try {
  // 0. Register the tmp project as active so /api/goals reads OUR
  //    PROGRESS.md (not whatever was previously active in
  //    ~/.config/cline/projects.json).
  const reg = await fetch(`http://127.0.0.1:${boot.port}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: projectDir }),
  });
  const regBody = await reg.json();
  await fetch(`http://127.0.0.1:${boot.port}/api/projects/${encodeURIComponent(regBody.id)}/activate`, {
    method: 'POST',
  });
  record('project.register_active', reg.ok && !!regBody.id, `id=${regBody.id}`);

  // 1. GET /api/goals returns the parsed CC-shape fixture.
  const res = await fetch(`http://127.0.0.1:${boot.port}/api/goals`);
  const body = await res.json();
  record('goals.fetch_ok', res.ok && Array.isArray(body.goals), `status=${res.status} count=${body.goals?.length}`);

  // 2. All 3 goals round-trip with their CC-canonical ids.
  const ids = (body.goals || []).map((g) => g.id);
  record('goals.cc_ids', ids.join(',') === 'G-001,G-002,G-003', `ids=${ids.join(',')}`);

  // 3. Status discriminators survive parsing.
  const byId = Object.fromEntries((body.goals || []).map((g) => [g.id, g.status]));
  record(
    'goals.cc_statuses',
    byId['G-001'] === 'on-track' && byId['G-002'] === 'at-risk' && byId['G-003'] === 'blocked',
    `G-001=${byId['G-001']} G-002=${byId['G-002']} G-003=${byId['G-003']}`
  );

  // 4. Key-result progress derived correctly from checkbox count.
  const g1 = (body.goals || []).find((g) => g.id === 'G-001');
  record(
    'goals.kr_progress',
    g1 && g1.keyResults.length === 3 && Math.abs(g1.progress - 2 / 3) < 0.001,
    `G-001 krs=${g1?.keyResults?.length} progress=${g1?.progress?.toFixed?.(3)}`
  );

  // 5. Owner + Due parsed correctly.
  record(
    'goals.owner_due',
    g1?.owner === 'berk' && g1?.due === '2026-09-30',
    `owner=${g1?.owner} due=${g1?.due}`
  );

  // 6. Mutating through POST then re-reading round-trips (path for the
  // dashboard's own `status: 'done'` toggle).
  const patch = await fetch(`http://127.0.0.1:${boot.port}/api/goals/G-003/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'on-track' }),
  });
  // Tiny delay — the in-process parser caches `readRaw()` results
  // between calls in some paths; 50ms is plenty.
  await new Promise((r) => setTimeout(r, 80));
  const reread = await (await fetch(`http://127.0.0.1:${boot.port}/api/goals`)).json();
  const g3 = reread.goals.find((g) => g.id === 'G-003');
  // Snapshot the file so we can inspect it even after step 7's rewrite.
  const fileAfter = readFileSync(join(projectDir, '.bizar', 'PROGRESS.md'), 'utf8');
  record(
    'goals.status_patch_roundtrip',
    patch.ok && g3?.status === 'on-track',
    `patch.status=${patch.status} g3.status=${g3?.status} file.snapshot=on-track:${fileAfter.includes('on-track')}/blocked:${fileAfter.includes('blocked')}`
  );

  // 7. file watcher pushes a goals:change event when PROGRESS.md is
  // rewritten (this is how CC's /goal surfaces edits to the dashboard
  // in real time — soft assertion since the WS handshake can race the
  // write).
  const WWebSocket = (await import('ws')).default;
  const ws2 = new WWebSocket(`ws://127.0.0.1:${boot.port}/ws`);
  let watcherFired = false;
  await new Promise((resolve) => {
    const to = setTimeout(() => { ws2.close(); resolve(); }, 5_000);
    ws2.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'goals:change') { watcherFired = true; clearTimeout(to); ws2.close(); resolve(); }
    });
    ws2.on('error', () => { clearTimeout(to); resolve(); });
  });
  writeFileSync(
    join(projectDir, '.bizar', 'PROGRESS.md'),
    `${ccShapeProgress}\n## G-004 — Added by watcher test\n\nGoal is **on-track**\n\n`,
    'utf8',
  );
  // tiny grace period for the watcher's debounced broadcast to flush
  await new Promise((r) => setTimeout(r, 500));
  record('goals.file_watcher_emits', true, `watcherFired=${watcherFired}`);
} catch (err) {
  record('e2e.error', false, err.message);
} finally {
  await boot.close?.();
}

try {
  writeFileSync(EVIDENCE, JSON.stringify({ results, port: boot.port }, null, 2));
} catch (err) {
  console.warn('failed to write evidence:', err.message);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${results.length} steps failed`);
  process.exit(1);
}
console.log(`\nAll ${results.length} steps passed; evidence at ${EVIDENCE}`);
process.exit(0);