#!/usr/bin/env node
/**
 * SubagentStop verifier for editing agents.
 *
 * Claude Code supplies `agent_id`, `agent_type`, `agent_transcript_path`, and
 * `last_assistant_message`. This hook accepts only bounded, correlated tool
 * evidence from the agent transcript or a completed Bizar task claim; it never
 * treats success-sounding final prose by itself as proof of delivery.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { TaskLedger, resolveTaskDatabase } from '../../cli/task-ledger.mjs';

const EDITING_AGENTS = new Set([
  'senior-engineer',
  'principal-engineer',
  'office-coordinator',
  'it-lead',
  'brand-designer',
  'exec-assistant',
  'ui-designer',
  'debug-specialist',
  // Retained aliases used by older installed agent registries.
  'brad', 'carl', 'pam', 'brenda', 'karen', 'todd', 'ria',
]);

const CHANGED_PATH_PATTERN = /(?:^|[\s`'"(])(?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|json|jsx|md|mjs|py|rs|scss|sh|sql|svelte|toml|ts|tsx|vue|yaml|yml)(?=$|[\s`'"),:;])/i;
const VERIFY_COMMAND_PATTERN = /(?:^|\s|&&|;)(?:make\s+(?:check|test|e2e)|(?:npm|pnpm|bun)\s+(?:test|run\s+(?:test|typecheck|build))|node\s+--test|(?:npx\s+)?(?:vitest|jest|tsc|eslint)\b|pytest\b|cargo\s+test\b|go\s+test\b)/i;
const SUCCESS_PATTERN = /(?:\b(?:all\s+)?tests?\s+pass(?:ed)?\b|\b\d+\s+pass(?:ed)?\b|\b(?:process\s+)?exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0\b|\bzero failures?\b|✓)/i;
const FAILURE_PATTERN = /(?:\b(?:failed|failure|error)\b|\bexit(?:ed)?\s+(?:with\s+)?(?:code\s+)?[1-9]\d*\b)/i;
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_LINES = 500;

function textContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string' || Array.isArray(value.content)) return textContent(value.content);
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return '';
}

function successfulResult(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.is_error === true || value.isError === true) return false;
  const exitCode = value.exit_code ?? value.exitCode ?? value.code;
  if (Number.isInteger(exitCode)) return exitCode === 0;
  const text = textContent(value.content ?? value.output ?? value.result ?? value);
  const withoutZeroFailures = text.replace(/\bzero failures?\b/ig, '');
  if (FAILURE_PATTERN.test(withoutZeroFailures)) return false;
  return SUCCESS_PATTERN.test(text);
}

export function readTranscriptEvidence(path) {
  if (typeof path !== 'string' || !path.trim()) return { valid: false, verified: false, paths: [] };
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TRANSCRIPT_BYTES) {
      return { valid: false, verified: false, paths: [] };
    }
  } catch {
    return { valid: false, verified: false, paths: [] };
  }

  const uses = new Map();
  const paths = new Set();
  let sequence = 0;
  let lastMutationIndex = -1;
  let lastVerificationIndex = -1;
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  if (lines.length > MAX_TRANSCRIPT_LINES) return { valid: false, verified: false, paths: [] };
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { return { valid: false, verified: false, paths: [] }; }
    const blocks = Array.isArray(entry.message?.content)
      ? entry.message.content
      : Array.isArray(entry.content) ? entry.content : [];
    for (const block of blocks) {
      sequence++;
      if (block?.type === 'tool_use') {
        const name = String(block.name || '');
        const toolInput = block.input && typeof block.input === 'object' ? block.input : {};
        if (/^(?:Edit|Write|MultiEdit)$/.test(name) && toolInput.file_path) {
          paths.add(String(toolInput.file_path));
          lastMutationIndex = sequence;
        }
        if (name === 'Bash' && VERIFY_COMMAND_PATTERN.test(String(toolInput.command || ''))) {
          uses.set(String(block.id || ''), sequence);
        }
      } else if (block?.type === 'tool_result') {
        const id = String(block.tool_use_id || '');
        if (uses.has(id) && successfulResult(block)) lastVerificationIndex = sequence;
      }
    }

    if (entry.tool_name === 'Bash' && VERIFY_COMMAND_PATTERN.test(String(entry.tool_input?.command || ''))) {
      sequence++;
      if (successfulResult(entry.tool_response || entry.tool_result || entry.toolUseResult || {})) {
        lastVerificationIndex = sequence;
      }
    }
    if (/^(?:Edit|Write|MultiEdit)$/.test(String(entry.tool_name || '')) && entry.tool_input?.file_path) {
      sequence++;
      paths.add(String(entry.tool_input.file_path));
      lastMutationIndex = sequence;
    }
  }
  return {
    valid: true,
    verified: lastVerificationIndex > lastMutationIndex,
    paths: [...paths],
    lastMutationIndex,
    lastVerificationIndex,
  };
}

function taskCompletion(input) {
  const taskId = String(input.task_id || input.task?.id || process.env.BIZAR_TASK_ID || '').trim();
  if (!taskId) return null;
  const cwd = String(input.cwd || process.cwd());
  let ledger;
  try {
    const dbPath = resolveTaskDatabase(cwd, process.env.BIZAR_TASK_DB);
    if (!existsSync(dbPath)) return false;
    ledger = new TaskLedger({ dbPath });
    const task = ledger.getTask(taskId);
    return ['completed', 'integrated'].includes(task.state) && Boolean(String(task.evidence || '').trim());
  } catch {
    return false;
  } finally {
    try { ledger?.close(); } catch { /* fail open cleanup */ }
  }
}

export function verifyDeliverables(input) {
  if (!input || typeof input !== 'object' || input.hook_event_name !== 'SubagentStop') return {};
  if (input.stop_hook_active === true) return {};
  const agentType = String(input.agent_type || '').trim();
  if (!EDITING_AGENTS.has(agentType)) return {};

  const finalMessage = typeof input.last_assistant_message === 'string'
    ? input.last_assistant_message.trim()
    : '';
  const completedTask = taskCompletion(input);
  const transcript = readTranscriptEvidence(input.agent_transcript_path);
  const hasPathEvidence = CHANGED_PATH_PATTERN.test(finalMessage) || transcript.paths.length > 0;
  const hasConcreteEvidence = transcript.valid && transcript.verified && hasPathEvidence;
  const problems = [];
  if (!finalMessage) problems.push('provide a final response describing the delivered result');
  else if (!hasConcreteEvidence && completedTask !== true) {
    problems.push('provide a bounded transcript with a concrete changed path and a successful verification command/result');
  }
  if (completedTask === false) problems.push('complete the bound Bizar task claim with evidence');
  if (problems.length === 0) return {};

  return {
    decision: 'block',
    reason:
      `Bizar cannot verify @${agentType}'s deliverable yet: ${problems.join('; ')}. ` +
      'Do not claim success. Finish the bounded work, record fresh evidence, and then return a concise final response.',
  };
}

export function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
  let input;
  try { input = JSON.parse(raw || '{}'); } catch {
    process.stdout.write('{}\n');
    return;
  }
  process.stdout.write(`${JSON.stringify(verifyDeliverables(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
