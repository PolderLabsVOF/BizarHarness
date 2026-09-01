#!/usr/bin/env node
/**
 * sessionstart-prime.mjs — Claude Code SessionStart hook.
 *
 * Primes every Bizar session with project-state context so the first turn
 * can ship instead of spending 5 turns orienting.
 *
 * Reads (lazily, best-effort — never throws):
 *   1. PROGRESS.md            → "Current State" line + last `## In Progress` paragraph
 *   2. feature_list.json      → totals + active feature (WIP=1 guard)
 *   3. git log --oneline -10  → recent commits
 *   4. .bizar/PROJECT.md      → project name + one-line summary
 *
 * Branches on `source`:
 *   - startup  → all 4 sources, full briefing
 *   - clear    → PROGRESS.md + last commit only
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

const MAX_BRIEFING = 800; // hard cap, characters
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

function featureListBrief(cwd) {
  const path = join(cwd, 'feature_list.json');
  const src = readIfExists(path);
  if (!src) return null;
  try {
    const data = JSON.parse(src);
    const features = Array.isArray(data.features) ? data.features : [];
    const total = features.length;
    const passing = features.filter((f) => f && f.state === 'passing').length;
    const active = features
      .filter((f) => f && f.state === 'active')
      .map((f) => ({ id: f.id, behavior: clip(f.behavior || '', 120) }));
    return { total, passing, active };
  } catch {
    return null;
  }
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

function startupBriefing(cwd, featureBrief, recentCommits, projectLine, progressLast) {
  const lines = ['Bizar SessionStart (startup):'];
  if (projectLine) lines.push(`- Project: ${projectLine}.`);
  if (featureBrief) {
    if (featureBrief.active.length === 0) {
      lines.push(
        `- Features: ${featureBrief.passing}/${featureBrief.total} passing. No active feature — pick next from not_started.`,
      );
    } else if (featureBrief.active.length === 1) {
      const a = featureBrief.active[0];
      lines.push(`- Active feature: ${a.id} — ${a.behavior}.`);
    } else {
      lines.push(
        `- WIP VIOLATION: ${featureBrief.active.length} active features (${featureBrief.active.map((a) => a.id).join(', ')}). WIP=1 requires resolving extras to passing/not_started.`,
      );
    }
  }
  if (recentCommits.length > 0) {
    lines.push(`- Last commit: ${recentCommits[0]}.`);
    if (recentCommits.length > 1) {
      lines.push(`- Recent: ${recentCommits.slice(1, 6).join(' | ')}.`);
    }
  }
  if (progressLast) lines.push(`- Progress: ${progressLast}.`);
  lines.push('- You are @mike. Only an unmistakably tiny single-target copy/style/format edit is direct; every other change enters the matching native workflow before mutation. Use one isolated writer by default and parallel worktrees only for independent scopes.');
  lines.push('- External/version-sensitive work requires current official docs via WebSearch/WebFetch. Use relevant installed skills; apply i-have-adhd to user output. WIP=1.');
  lines.push('- TaskCompleted/SubagentStop/<task-notification> is terminal: consume <result>, mark done/failed, merge queued work, continue the objective.');
  // Default-first-stop hint when nothing is active yet.
  if (featureBrief && featureBrief.active.length === 0) {
    lines.push(
      '- First move: read PROGRESS.md and feature_list.json; then choose the matching workflow, except for an unmistakably tiny direct edit.',
    );
  }
  return lines.join('\n');
}

function clearBriefing(cwd, recentCommits, progressLast) {
  const lines = ['Bizar SessionStart (clear):'];
  if (progressLast) lines.push(`- Progress: ${progressLast}.`);
  if (recentCommits.length > 0) lines.push(`- Last commit: ${recentCommits[0]}.`);
  lines.push('- Context preserved in same repo / cwd — only the model turn was reset.');
  lines.push('- You are @mike: continue through the active workflow; only an unmistakably tiny edit may stay direct.');
  lines.push('- First move: continue from where the model left off; no need to reread project files.');
  return lines.join('\n');
}

function resumeBriefing(cwd, state) {
  const lines = ['Bizar SessionStart (resume):'];
  lines.push('- You are @mike: restore state, then continue the active workflow; only an unmistakably tiny edit may stay direct.');
  if (state) {
    if (state.activeFeature) lines.push(`- Last active feature: ${state.activeFeature}.`);
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
    lines.push('- First move: read PROGRESS.md and feature_list.json to orient.');
  }
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

function buildBriefing(input) {
  const source = String(input.source || 'startup');
  const cwd = String(input.cwd || process.cwd());

  if (source === 'resume') {
    const state = sessionState(cwd);
    return clip([resumeBriefing(cwd, state), buildLearningContext({ cwd })].filter(Boolean).join('\n'), MAX_BRIEFING);
  }

  const progressSrc = readIfExists(join(cwd, 'PROGRESS.md'));
  const progressLast = firstParagraphAfter(progressSrc, '## In Progress');
  const recentCommits = gitRecent(cwd, 10);
  const featureBrief = featureListBrief(cwd);
  const projectLine = projectSummary(cwd);

  if (source === 'clear') {
    return clip([clearBriefing(cwd, recentCommits, progressLast), buildLearningContext({ cwd })].filter(Boolean).join('\n'), MAX_BRIEFING);
  }

  // Default: startup.
  return clip(
    [startupBriefing(cwd, featureBrief, recentCommits, projectLine, progressLast), buildLearningContext({ cwd })].filter(Boolean).join('\n'),
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
