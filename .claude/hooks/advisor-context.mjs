#!/usr/bin/env node
/**
 * Inject the recent parent transcript into review-oriented subagents.
 * Reads newest-first with hard record and character caps.
 */

import { readFileSync } from 'node:fs';

const clip = (value, limit) => value.length > limit ? `${value.slice(0, limit)} …[truncated]` : value;

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }

let rendered = [];
try {
  const lines = readFileSync(input.transcript_path, 'utf8').split('\n');
  for (let index = lines.length - 1; index >= 0 && rendered.length < 60; index--) {
    let record;
    try { record = JSON.parse(lines[index]); } catch { continue; }
    if (record.isSidechain || record.isMeta || !['user', 'assistant'].includes(record.type)) continue;
    const content = record.message?.content;
    if (typeof content === 'string') rendered.push(`${record.type}: ${clip(content, 3_000)}`);
    else if (Array.isArray(content)) {
      const text = content
        .filter((block) => block?.type === 'text')
        .map((block) => block.text || '')
        .join('\n');
      if (text) rendered.push(`${record.type}: ${clip(text, 3_000)}`);
    }
  }
} catch { rendered = []; }

rendered.reverse();
let recent = rendered.join('\n\n---\n\n');
if (recent.length > 30_000) recent = `…[older turns truncated]\n${recent.slice(-30_000)}`;
const additionalContext = recent
  ? `Review the caller's request against this recent parent-session evidence, not only its summary:\n\n<recent-conversation>\n${recent}\n</recent-conversation>`
  : 'The parent transcript could not be reconstructed. State any context needed before making a strong claim.';

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext },
}) + '\n');
