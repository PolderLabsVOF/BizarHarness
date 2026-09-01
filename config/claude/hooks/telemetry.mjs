#!/usr/bin/env node
/**
 * Local-only session correlation and rejected-action feedback telemetry.
 * No network calls and no note-vault integration.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBizarHome } from '../../../cli/config-paths.mjs';

const categories = [
  ['wrong_target', /\b(?:wrong (?:file|repo|branch|directory)|not that|i meant)\b/i],
  ['tool_steering', /\b(?:use|prefer)\b.*\b(?:rg|grep|gh|bun|npm|web search)\b|\binstead of\b/i],
  ['scope_drift', /\b(?:only|don'?t touch|don'?t change|overengineer|no need)\b/i],
  ['verify_first', /\b(?:check|read|verify).*(?:first|docs|code|source)\b/i],
  ['rule_setting', /\b(?:never|always|from now on|next time)\b/i],
  ['retry_request', /\b(?:try again|redo|retry|once more)\b/i],
];

function recentReject(path) {
  if (!path || !existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n').slice(-30).reverse();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const result = entry.toolUseResult;
    if (result?.interrupted) return result.name || 'unknown';
    const content = entry.message?.content;
    if (Array.isArray(content) && content.some((block) => block?.type === 'tool_result' && block.is_error)) {
      return result?.name || 'unknown';
    }
  }
  return null;
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
const cwd = String(input.cwd || process.cwd());
const stateDir = join(resolveBizarHome({ cwd }), 'telemetry');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const projectId = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
const chatFile = join(stateDir, `chat-${projectId}`);

if (input.hook_event_name === 'SessionStart') {
  const chatId = process.env.BIZAR_NEW_CHAT === '1' || !existsSync(chatFile)
    ? randomUUID()
    : readFileSync(chatFile, 'utf8').trim();
  writeFileSync(chatFile, chatId, { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Bizar telemetry correlation id: ${chatId}.`,
    },
  }) + '\n');
} else if (input.hook_event_name === 'UserPromptSubmit') {
  const prompt = String(input.prompt || input.user_prompt || '');
  const tool = recentReject(input.transcript_path);
  if (!tool || !prompt) process.exit(0);
  const category = categories.find(([, pattern]) => pattern.test(prompt))?.[0] || 'uncategorized';
  const feedbackPath = join(stateDir, 'reject-feedback.jsonl');
  appendFileSync(feedbackPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: input.session_id || null,
    chatId: existsSync(chatFile) ? readFileSync(chatFile, 'utf8').trim() : null,
    tool,
    category,
    promptFingerprint: createHash('sha256').update(prompt.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16),
  }) + '\n', { mode: 0o600 });
  try {
    const rows = readFileSync(feedbackPath, 'utf8').split('\n').filter(Boolean);
    if (rows.length > 256) writeFileSync(feedbackPath, `${rows.slice(-256).join('\n')}\n`, { mode: 0o600 });
  } catch { /* telemetry never blocks */ }
}
