#!/usr/bin/env node
/**
 * advisor-context.mjs — Claude Code SubagentStart leaf hook.
 *
 * Inject a SHORT, FILTERED slice of the parent transcript into reviewer /
 * debug-specialist subagents (`@linda`, `@carl`). The previous version
 * dumped up to 30kB of raw parent transcript on every dispatch of
 * `linda|karen|carl|qa-reviewer|principal-engineer|debug-specialist`. Two
 * failure modes followed:
 *
 *   1. The dump was too noisy — reviewers only need the recent intent
 *      and the changed files, not arbitrary chitchat from earlier in
 *      the session.
 *   2. The JSONL transcript persists across sessions on the same
 *      project (Claude Code appends to `~/.claude/projects/.../<id>.jsonl`
 *      rather than rotating per session). Reading the "tail" of that
 *      file can surface content from a previous, unrelated session —
 *      including prior user prompts, spinner/status text, and stuff the
 *      current session has no business knowing.
 *
 * The fix below:
 *   - Take only the last 8 user/assistant records (was 60).
 *   - Skip non-substantive records entirely: `isSidechain`, `isMeta`,
 *     `type: 'attachment'`, `type: 'system'`, `type: 'last-prompt'`,
 *     `type: 'ai-title'`, `type: 'agent-name'`,
 *     `type: 'stop_hook_summary'`.
 *   - Per-record cap: 800 chars (was 3000).
 *   - Hard total cap: 6kB (was 30kB).
 *   - Strip `<system-reminder>` and `<total_tokens>` blocks inside text
 *     content.
 *   - Fall back to "could not be reconstructed" when the dump is too
 *     short to be useful (< 100 chars).
 *
 * Output envelope (unchanged from the previous version):
 *   { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext } }
 */

import { readFileSync } from 'node:fs';

const MAX_RECORDS = 8;
const PER_RECORD_CAP = 800;
const TOTAL_CAP = 6_000;
const MIN_USEFUL_LENGTH = 100;

// Records that should never be replayed as "parent context" — they are
// bookkeeping, meta, or status output rather than substantive session
// content.
const SKIP_TYPES = new Set([
  'attachment',
  'system',
  'last-prompt',
  'ai-title',
  'agent-name',
  'stop_hook_summary',
  'queue-operation',
]);

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const TOTAL_TOKENS_RE = /<total_tokens>[\s\S]*?<\/total_tokens>/g;
const CCR_RE = /\[\s*CCR\s+retrieve[^\]]*\]/g;

function clip(value, limit) {
  return value.length > limit ? `${value.slice(0, limit)} …[truncated]` : value;
}

function cleanText(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text
    .replace(SYSTEM_REMINDER_RE, '')
    .replace(TOTAL_TOKENS_RE, '')
    .replace(CCR_RE, '[compacted context omitted]')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function isSubstantiveRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.isSidechain === true || record.isMeta === true) return false;
  if (SKIP_TYPES.has(record.type)) return false;
  return record.type === 'user' || record.type === 'assistant';
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}

function readTranscriptLines(transcriptPath) {
  if (!transcriptPath) return [];
  let text;
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean);
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }

const lines = readTranscriptLines(input.transcript_path);
const records = [];
for (let index = lines.length - 1; index >= 0 && records.length < MAX_RECORDS; index--) {
  let record;
  try { record = JSON.parse(lines[index]); } catch { continue; }
  if (!isSubstantiveRecord(record)) continue;
  const text = cleanText(extractText(record.message?.content));
  if (!text) continue;
  records.push(`${record.type}: ${clip(text, PER_RECORD_CAP)}`);
}

records.reverse();
let recent = records.join('\n\n---\n\n');
if (recent.length > TOTAL_CAP) recent = `…[older turns truncated]\n${recent.slice(-TOTAL_CAP)}`;

const additionalContext = recent.length >= MIN_USEFUL_LENGTH
  ? `Recent parent transcript (last ${records.length} records, capped at ${TOTAL_CAP} chars):\n\n<recent-conversation>\n${recent}\n</recent-conversation>`
  : 'The parent transcript could not be reconstructed. State any context needed before making a strong claim.';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext },
}) + '\n');
