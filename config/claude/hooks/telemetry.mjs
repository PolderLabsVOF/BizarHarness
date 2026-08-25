#!/usr/bin/env node
/**
 * Local-only session correlation and rejected-action feedback telemetry.
 * No network calls and no note-vault integration.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
const stateDir = join(homedir(), '.config', 'bizar', 'telemetry');
mkdirSync(stateDir, { recursive: true });
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
  appendFileSync(join(stateDir, 'reject-feedback.jsonl'), JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: input.session_id || null,
    chatId: existsSync(chatFile) ? readFileSync(chatFile, 'utf8').trim() : null,
    tool,
    category,
    excerpt: prompt.slice(0, 200),
  }) + '\n');
}
