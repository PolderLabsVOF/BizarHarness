#!/usr/bin/env node
/**
 * .claude/hooks/learning-extract.mjs — SessionEnd hook.
 *
 * On session end, extract lightweight instincts from the session
 * transcript and append to `.bizar/learning/instincts.jsonl`.
 *
 * Heuristics (deliberately conservative — quality > quantity):
 *  - Edit/Write failures captured as `pitfall` instincts (low confidence).
 *  - Successful complex edits captured as `pattern` instincts (mid).
 *  - User corrections captured as `preference` instincts (mid).
 *
 * Wired into `.claude/settings.json` SessionEnd. Reads transcript
 * via stdin + transcript_path from input JSON.
 *
 * Output: JSON via stdout, status 0 on success.
 */
'use strict';

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  { type: 'pitfall', re: /Error: ENOENT|Error: EACCES|command not found|Permission denied/i, confidence: 0.4 },
  { type: 'pattern', re: /fixed by updating .* to use \.\//i, confidence: 0.55 },
  { type: 'pattern', re: /\bmoved .* from .* to \.\//i, confidence: 0.55 },
];

function extract(transcriptText) {
  const out = [];
  const lines = transcriptText.split('\n');
  for (const line of lines) {
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        const m = line.match(p.re);
        out.push({
          trigger: m[0].slice(0, 200),
          action: 'investigate path/env mismatch',
          type: p.type,
          confidence: p.confidence,
        });
        break;
      }
    }
  }
  return out.slice(0, 5); // cap per session
}

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', async () => {
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

    const cwd = input.cwd || process.cwd();
    const transcript = input.transcript_path;
    let text = '';
    if (transcript && existsSync(transcript)) {
      try { text = await readFile(transcript, 'utf8'); } catch { text = ''; }
    }

    const out = extract(text);
    if (out.length === 0) {
      process.stdout.write(JSON.stringify({ continue: true, extracted: 0 }) + '\n');
      return;
    }

    const learningFile = path.join(cwd, '.bizar', 'learning', 'instincts.jsonl');
    await mkdir(path.dirname(learningFile), { recursive: true });
    for (const i of out) {
      const entry = {
        id: 'I-' + Math.random().toString(36).slice(2, 10),
        ...i,
        scope: 'project',
        source: 'observed',
        files: [],
        created_at: new Date().toISOString(),
        last_validated_at: new Date().toISOString(),
      };
      await appendFile(learningFile, JSON.stringify(entry) + '\n');
    }
    process.stdout.write(JSON.stringify({ continue: true, extracted: out.length }) + '\n');
  });
}

main().catch((err) => {
  process.stderr.write(`learning-extract: ${err.message}\n`);
  process.stdout.write(JSON.stringify({ continue: true, error: err.message }) + '\n');
});