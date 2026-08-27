#!/usr/bin/env node
/**
 * Human-facing text guard adapted from the upstream humanize hook.
 * It checks Markdown/text writes, code comments, and commit/PR messages.
 */

const swaps = new Map([
  ['delve', 'look at'],
  ['leverage', 'use'],
  ['utilize', 'use'],
  ['plethora', 'many'],
  ['myriad', 'many'],
  ['tapestry', 'mix'],
  ['showcase', 'show'],
  ['transformative', 'major'],
  ['unprecedented', 'new'],
  ['streamline', 'simplify'],
  ['seamlessly', 'remove the claim or explain how'],
  ['game-changing', 'state the concrete effect'],
  ['cutting-edge', 'latest'],
]);
const phrases = [
  ['as an ai language model', 'remove the AI disclaimer'],
  ['it is important to note', 'state the point directly'],
  ['in conclusion', 'remove the stock conclusion'],
  ['in summary', 'remove the stock summary'],
  ['a testament to', 'state what it proves'],
];

function textFrom(input) {
  const tool = String(input.tool_name || '');
  const data = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (/^(Write|Edit|MultiEdit)$/.test(tool)) {
    const path = String(data.file_path || '');
    if (!/\.(md|mdx|txt|rst)$/i.test(path)) return '';
    return [data.content, data.new_string, ...(Array.isArray(data.edits) ? data.edits.map((edit) => edit?.new_string) : [])]
      .filter((value) => typeof value === 'string')
      .join('\n');
  }
  if (tool === 'Bash') {
    const command = Array.isArray(data.command) ? data.command.join(' ') : String(data.command || '');
    return /\b(?:git\s+commit|gh\s+pr)\b/i.test(command) ? command : '';
  }
  return '';
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
  const text = textFrom(input);
  if (!text) return;

  const notes = [];
  const lower = text.toLowerCase();
  for (const [word, replacement] of swaps) {
    if (new RegExp(`\\b${word.replace('-', '[- ]')}\\b`, 'i').test(text)) notes.push(`"${word}" → ${replacement}`);
  }
  for (const [phrase, replacement] of phrases) {
    if (lower.includes(phrase)) notes.push(`"${phrase}" → ${replacement}`);
  }
  if (notes.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: `🟡 Style suggestion: humanize the text before publishing. ${notes.join('; ')}. The write will proceed regardless.`,
      },
    }) + '\n');
  }
});
