#!/usr/bin/env node
/**
 * pretooluse-bash.mjs — Claude Code PreToolUse hook (matcher: Bash).
 *
 * F-176 (full permissions + advisory hooks):
 *   Agents have full permissions by default. Hooks never return
 *   `permissionDecision: "deny"` or `"ask"`; they inject safety guidance
 *   via `hookSpecificOutput.additionalContext` and always return `"allow"`.
 *   The hook's job is to remind the agent of proper technique for any
 *   pattern that USED to be blocked under F-200. This is the new shape
 *   for all Bizar guard hooks.
 *
 * F-200 history:
 *   - `rm -rf` of user-owned sub-paths (`/home`, `/tmp`, `~/`, any user
 *     project directory) is now ALLOWED. Only true destruction
 *     (`rm -rf /`, `rm -rf /etc|var|usr|boot`) used to be denied.
 *   - `read-ssh` and `read-aws-creds` patterns removed — the secret
 *     guard is git-only (see `git-workflow-guard.mjs`). Agents can read
 *     env and credential files locally; only pushing them to git was
 *     ever denied.
 *   - `read-shadow` kept (`/etc/shadow|passwd|sudoers`); this is system
 *     safety, not workspace path restriction.
 *
 * Claude Code PreToolUse input schema:
 *   { session_id, cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description } }
 *
 * Claude Code PreToolUse output schema (F-176):
 *   { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: "<advisory>" } }
 */

'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch { input = {}; }
  const toolInput = (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};
  const command = String(toolInput.command || '');

  // Inline dangerous-pattern scanner. Mirrors
  // `packages/sdk/src/dangerous-patterns.ts` — kept inline so this hook
  // works without importing the SDK at runtime.
  //
  // F-176: every pattern is now advisory. The `decision` and `reason`
  // fields document the old behaviour so the human reading the hook can
  // see what each regex was meant to catch; the runtime never acts on
  // them. Output is always `permissionDecision: "allow"` plus a
  // guidance string the agent sees on its next turn.
  const DANGEROUS = [
    { name: 'rm-rf-root',       pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/(?:\s|$|;|\|)/i, severity: 'critical', reason: 'Recursive delete of root filesystem' },
    { name: 'rm-rf-system',     pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/(?:etc|usr|boot)\b/i, severity: 'critical', reason: 'Recursive delete of system directory' },
    { name: 'rm-rf-wildcard',   pattern: /\brm\s+-\w*r\w*f\w*\s+\*[\s;]*/i, severity: 'warn', reason: 'Recursive delete with wildcard' },
    { name: 'mkfs',             pattern: /\bmkfs(\.\w+)?\s+\/dev\//i, severity: 'critical', reason: 'Format filesystem' },
    { name: 'dd-of-dev',        pattern: /\bdd\s+.*of=\/dev\//i, severity: 'critical', reason: 'dd to raw device' },
    { name: 'sudo',             pattern: /(^|\s|;|&&|\|\|)sudo\b/i, severity: 'warn', reason: 'Sudo escalation' },
    { name: 'su-root',          pattern: /\bsu\s+-?\s*root\b/i, severity: 'warn', reason: 'su to root' },
    { name: 'curl-metadata',    pattern: /169\.254\.169\.254/i, severity: 'warn', reason: 'AWS metadata IP' },
    { name: 'curl-google-metadata', pattern: /metadata\.google\.internal/i, severity: 'warn', reason: 'GCP metadata hostname' },
    { name: 'curl-azure-metadata', pattern: /metadata\.azure\.com/i, severity: 'warn', reason: 'Azure metadata hostname' },
    { name: 'nc-backdoor',      pattern: /\bnc\s+(-[a-z]*\s+)*-[a-z]*e\b/i, severity: 'critical', reason: 'nc execute backdoor' },
    { name: 'wget-pipe-shell',  pattern: /\bwget\s+.*\|\s*(ba)?sh\b/i, severity: 'critical', reason: 'wget piped to shell' },
    { name: 'curl-pipe-shell',  pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/i, severity: 'critical', reason: 'curl piped to shell' },
    { name: 'kill-init',        pattern: /\bkill\s+(-9\s+)?1\b/i, severity: 'critical', reason: 'Kill PID 1 (init)' },
    { name: 'shutdown',         pattern: /\b(shutdown|halt|poweroff|reboot)\b/i, severity: 'critical', reason: 'System shutdown' },
    { name: 'xmrig',            pattern: /\b(xmrig|minerd|cpuminer|cgminer)\b/i, severity: 'critical', reason: 'Crypto miner' },
    { name: 'read-shadow',      pattern: /\/etc\/(shadow|passwd|sudoers)\b/i, severity: 'warn', reason: 'Read sensitive system file' },
    { name: 'git-force-push-main', pattern: /\bgit\s+push\s+(-f|--force)(\s+--.*)?\s+origin\s+(main|master)\b/i, severity: 'warn', reason: 'Force push to main/master' },
    { name: 'git-reset-hard',   pattern: /\bgit\s+reset\s+--hard\b/i, severity: 'warn', reason: 'git reset --hard' },
  ];

  for (const p of DANGEROUS) {
    if (p.pattern.test(command)) {
      const tag = p.severity === 'critical' ? '[advisory:critical]' : '[advisory]';
      const out = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `dangerous_pattern:${p.name}: ${p.reason}`,
          additionalContext:
            `${tag} Heads up: ${p.reason} (pattern ${p.name}). ` +
            `This used to be blocked under F-200. Confirm intent with the user before proceeding, ` +
            `and prefer a more targeted command when possible.`,
        },
      };
      process.stdout.write(JSON.stringify(out) + '\n');
      return;
    }
  }

  // No dangerous pattern: silent pass-through.
  process.stdout.write('{}\n');
});
