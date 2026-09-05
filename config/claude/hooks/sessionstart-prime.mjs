#!/usr/bin/env node
/**
 * sessionstart-prime.mjs — Claude Code SessionStart hook.
 *
 * Primes every Bizar session with project-state context so the first turn
 * can ship instead of spending 5 turns orienting.
 *
 * Reads (lazily, best-effort — never throws):
 *   1. OpenKan `.ok/`         → active tasks, plans, and PRD goals
 *   2. git log --oneline -10  → recent commits
 *   3. .bizar/PROJECT.md      → project name + one-line summary
 *
 * Branches on `source`:
 *   - startup  → all 4 sources, full briefing
 *   - clear    → last commit only (OpenKan remains durable state)
 *   - resume   → reads .bizar/session-state.json (handoff from SessionEnd)
 *
 * Claude Code SessionStart input:
 *   { session_id, transcript_path, cwd, hook_event_name, source }
 *
 * Claude Code SessionStart output:
 *   { hookSpecificOutput: { hookEventName, additionalContext: <briefing> } }
 *
 * Always exits 0 — priming is a hint, not a gate.
 */

'use strict';

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLearningContext } from '../../../cli/commands/learn.mjs';
import { resolveBizarHome } from '../../../cli/config-paths.mjs';
import { listOpenKanGoals, listOpenKanPlans, listOpenKanTasks } from '../../../cli/openkan-store.mjs';

const MAX_BRIEFING = 1200; // hard cap, characters (was 800; +400 to fit the F-207 goal line)
const PROJECT_NAME = 'BizarHarness';
const SESSION_STATE = '.bizar/session-state.json';

// ── Tiny helpers (no external deps) ────────────────────────────────────────

function readIfExists(absPath) {
  try {
    if (!existsSync(absPath)) return null;
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function clip(s, n) {
  if (!s) return '';
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= n ? oneLine : oneLine.slice(0, n - 1) + '…';
}

function lineAfter(src, marker) {
  if (!src) return '';
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.startsWith(marker));
  return i >= 0 && i + 1 < lines.length ? clip(lines[i + 1], 240) : '';
}

function firstParagraphAfter(src, marker) {
  if (!src) return '';
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.startsWith(marker));
  if (i < 0) return '';
  const buf = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j].trim();
    if (line === '' || line.startsWith('## ')) break;
    if (line.startsWith('#') || line.startsWith('-')) continue;
    buf.push(line);
    if (buf.length >= 4) break;
  }
  return clip(buf.filter(Boolean).join(' '), 240);
}

function logLifecycle(cwd, sessionId, source) {
  try {
    const dir = join(resolveBizarHome({ cwd }), 'hook-logs');
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(dir, `task-start-${today}.jsonl`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(
      logFile,
      JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: sessionId || null,
        source,
      }) + '\n',
      { mode: 0o600 },
    );
  } catch {
    /* best-effort */
  }
}

function gitRecent(cwd, n = 10) {
  try {
    const r = spawnSync('git', ['log', '--oneline', `-${n}`], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (r.status !== 0 || !r.stdout) return [];
    return r.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => clip(line, 80));
  } catch {
    return [];
  }
}

function projectSummary(cwd) {
  const src = readIfExists(join(cwd, '.bizar', 'PROJECT.md'));
  if (!src) return '';
  const lines = src.split('\n');
  // First heading + first non-heading line (one-line summary).
  let summary = '';
  for (const line of lines.slice(0, 10)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    summary = clip(t, 200);
    break;
  }
  return summary;
}

function openKanBrief(cwd) {
  try {
    const tasks = listOpenKanTasks(cwd);
    const plans = listOpenKanPlans(cwd);
    const goals = listOpenKanGoals(cwd);
    return {
      exists: tasks.length + plans.length + goals.length > 0 || existsSync(join(cwd, '.ok')),
      tasks,
      plans,
      goals,
      active: tasks.filter((task) => ['in_progress', 'review'].includes(task.status)),
    };
  } catch { return null; }
}

function sessionState(cwd) {
  const path = join(cwd, SESSION_STATE);
  const src = readIfExists(path);
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch {
    return null;
  }
}

// ── Briefing builders ──────────────────────────────────────────────────────

function startupBriefing(cwd, planning, recentCommits, projectLine) {
  const lines = ['Bizar SessionStart (startup):'];
  if (projectLine) lines.push(`- Project: ${projectLine}.`);
  if (!planning?.exists) {
    lines.push('- OpenKan: .ok/ is not initialised. First move: run `ok init`, then create a scoped task or PRD.');
  } else if (planning.active.length === 0) {
    lines.push(`- OpenKan: ${planning.tasks.length} task(s), ${planning.plans.length} plan(s), ${planning.goals.length} PRD(s); no active task.`);
  } else {
    lines.push(`- OpenKan active: ${planning.active.map((task) => `${task.id} — ${clip(task.title || '', 100)}`).join(' | ')}.`);
  }
  if (recentCommits.length > 0) {
    lines.push(`- Last commit: ${recentCommits[0]}.`);
    if (recentCommits.length > 1) {
      lines.push(`- Recent: ${recentCommits.slice(1, 6).join(' | ')}.`);
    }
  }
  lines.push('- You are @mike. For non-tiny work, do bounded read-only orientation, then form a native Agent team by default. Ask one concise clarification only when a material choice, acceptance criterion, or safety boundary remains unresolved; otherwise continue autonomously. /quick is the explicit direct-execution exception. Use worktrees for editors and explicit Bizar models for every Agent.');
  lines.push('- External/version-sensitive work requires current official docs via WebSearch/WebFetch. Use relevant installed skills. OpenKan .ok is the sole task/progress/goals authority.');
  lines.push('- TaskCompleted/SubagentStop/<task-notification> is terminal: consume its original <result> once, mark done/failed, merge queued work, and continue the objective. Never turn a terminal notification into a worker follow-up or replace that result with a later status reply.');
  // Default-first-stop hint when nothing is active yet.
  if (planning && planning.active.length === 0) {
    lines.push('- First move: inspect `ok task list` and `ok prd list`, claim the selected task, then form the default team when the outcome is clear.');
  }
  return lines.join('\n');
}

function clearBriefing(cwd, recentCommits) {
  const lines = ['Bizar SessionStart (clear):'];
  if (recentCommits.length > 0) lines.push(`- Last commit: ${recentCommits[0]}.`);
  lines.push('- Context preserved in same repo / cwd — only the model turn was reset.');
  lines.push('- You are @mike: continue the active coordination plan; adapt it when new evidence changes the fit.');
  lines.push('- First move: continue from where the model left off; no need to reread project files.');
  return lines.join('\n');
}

function resumeBriefing(cwd, state) {
  const lines = ['Bizar SessionStart (resume):'];
  lines.push('- You are @mike: restore state, then continue the active coordination plan and adapt it if the evidence changed.');
  if (state) {
    if (state.activeTask) lines.push(`- Last active OpenKan task: ${state.activeTask}.`);
    if (state.reason) lines.push(`- Last session ended with: ${state.reason}.`);
    if (state.nextStep) lines.push(`- Last nextStep: ${state.nextStep}.`);
    if (Array.isArray(state.filesTouched) && state.filesTouched.length > 0) {
      lines.push(`- Last files touched: ${state.filesTouched.slice(0, 5).join(', ')}.`);
    }
    if (Array.isArray(state.blockers) && state.blockers.length > 0) {
      lines.push(`- Open blockers: ${state.blockers.join(' | ')}.`);
    }
    if (state.lastSessionEnd) lines.push(`- Last session end: ${state.lastSessionEnd}.`);
    lines.push('- WARNING: context may have been compacted since the last run; verify scope before continuing.');
  } else {
    lines.push('- No prior session-state.json found — treating as fresh start.');
    lines.push('- First move: read OpenKan .ok state with `ok task list` and `ok prd list` to orient.');
  }
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

function buildBriefing(input) {
  const source = String(input.source || 'startup');
  const cwd = String(input.cwd || process.cwd());
  const planning = openKanBrief(cwd);
  const goalLine = planning?.goals.find((prd) => prd.status === 'active')
    ? `OpenKan goal: ${planning.goals.find((prd) => prd.status === 'active').id} — active.`
    : 'OpenKan goal: no active PRD.';

  if (source === 'resume') {
    const state = sessionState(cwd);
    return clip([goalLine, resumeBriefing(cwd, state), buildLearningContext({ cwd })].filter(Boolean).join('\n'), MAX_BRIEFING);
  }

  const recentCommits = gitRecent(cwd, 10);
  const projectLine = projectSummary(cwd);

  if (source === 'clear') {
    return clip([goalLine, clearBriefing(cwd, recentCommits), buildLearningContext({ cwd })].filter(Boolean).join('\n'), MAX_BRIEFING);
  }

  // Default: startup.
  return clip(
    [goalLine, startupBriefing(cwd, planning, recentCommits, projectLine), buildLearningContext({ cwd })].filter(Boolean).join('\n'),
    MAX_BRIEFING,
  );
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {
    input = {};
  }

  const source = String(input.source || 'startup');
  const sessionId = String(input.session_id || '');
  const cwd = String(input.cwd || process.cwd());

  logLifecycle(cwd, sessionId, source);

  const briefing = buildBriefing(input);

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: briefing,
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
