#!/usr/bin/env node
/** PermissionRequest policy: deny prohibited operations, never auto-approve. */

import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }

const toolName = String(input.tool_name || '');
const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
const command = toolName === 'Bash' ? String(toolInput.command || '') : '';
const prohibited = [
  [/(?:^|\s)git\s+push\b[^\n]*(?:--force|-f)\b/i, 'force-push is prohibited by Bizar policy'],
  [/(?:^|\s)git\s+rebase\b/i, 'rebase is prohibited by Bizar policy'],
  [/\brm\s+-[^\s]*r[^\s]*f[^\s]*\s+(?:\/|~\/?)(?:\s|$|;)/i, 'recursive deletion of a root/home boundary is prohibited'],
  [/\b(?:mkfs|shutdown|halt|poweroff|reboot)\b/i, 'system-destructive operation is prohibited'],
];
const match = prohibited.find(([pattern]) => pattern.test(command));

if (!match) {
  process.stdout.write('{}\n');
} else {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: match[1], interrupt: true },
    },
  })}\n`);
}
