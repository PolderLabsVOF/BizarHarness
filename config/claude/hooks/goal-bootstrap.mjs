#!/usr/bin/env node
/**
 * OpenKan goal briefing for Claude Code SessionStart.
 *
 * OpenKan PRDs are Bizar's durable goal system. This hook is intentionally
 * read-only: it announces the active PRD (or the next safe action) without
 * manufacturing a parallel goal ledger.
 */
'use strict';

import { listOpenKanGoals } from '../../../cli/openkan-store.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { body += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

function briefing(cwd) {
  try {
    const goals = listOpenKanGoals(cwd);
    const active = goals.filter((goal) => goal.status === 'active');
    if (active.length === 1) return `OpenKan goal: resume ${active[0].id} — ${active[0].title || 'untitled PRD'}.`;
    if (active.length > 1) return `OpenKan goals: ${active.map((goal) => `${goal.id} (${goal.title || 'untitled'})`).join(' | ')}. Review and continue the intended PRD.`;
    if (goals.length > 0) return `OpenKan goals: ${goals.length} PRD(s), none active. Use \`ok prd list\` to choose or \`ok prd add\` to create one.`;
    return 'OpenKan goals: no PRD yet. Create one with `ok prd add <title>` when the work needs a durable outcome.';
  } catch {
    return 'OpenKan goals unavailable. Inspect `.ok/` or run `ok init` before planning.';
  }
}

async function main() {
  const input = await readStdin();
  const cwd = String(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing(cwd) },
  }) + '\n');
}

main().catch(() => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'OpenKan goals unavailable; continue with a verified .ok state.' },
  }) + '\n');
});
