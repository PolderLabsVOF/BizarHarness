#!/usr/bin/env node
/**
 * pretooluse-bash.mjs — Claude Code PreToolUse hook (matcher: Bash).
 *
 * Runs the Bizar dangerous-pattern scanner on Bash commands before they
 * execute. Blocks destructive patterns (rm -rf, sudo, SSRF, etc.) via
 * the 36-pattern DANGEROUS_PATTERNS regex list maintained in
 * `@polderlabs/bizar-sdk/dist/dangerous-patterns.js`.
 *
 * Claude Code PreToolUse input schema:
 *   { session_id, cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description } }
 *
 * Claude Code PreToolUse output schema:
 *   { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason }, additionalContext? }
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
  const DANGEROUS = [
    { name: 'rm-rf-root', pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/\s*$/i, decision: 'deny', reason: 'Recursive delete of root filesystem' },
    { name: 'rm-rf-etc', pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/(etc|var|usr|boot|home)\b/i, decision: 'deny', reason: 'Recursive delete of system directory' },
    { name: 'rm-rf-wildcard', pattern: /\brm\s+-\w*r\w*f\w*\s+\*/i, decision: 'ask', reason: 'Recursive delete with wildcard' },
    { name: 'rm-rf-home', pattern: /\brm\s+(-\w*r\w*f\w*\s+)*~?\//i, decision: 'ask', reason: 'Recursive delete of home directory' },
    { name: 'mkfs', pattern: /\bmkfs(\.\w+)?\s+\/dev\//i, decision: 'deny', reason: 'Format filesystem' },
    { name: 'dd-of-dev', pattern: /\bdd\s+.*of=\/dev\//i, decision: 'deny', reason: 'dd to raw device' },
    { name: 'sudo', pattern: /(^|\s|;|&&|\|\|)sudo\b/i, decision: 'ask', reason: 'Sudo escalation' },
    { name: 'su-root', pattern: /\bsu\s+-?\s*root\b/i, decision: 'ask', reason: 'su to root' },
    { name: 'curl-metadata', pattern: /169\.254\.169\.254/i, decision: 'deny', reason: 'AWS metadata IP' },
    { name: 'curl-google-metadata', pattern: /metadata\.google\.internal/i, decision: 'deny', reason: 'GCP metadata hostname' },
    { name: 'curl-azure-metadata', pattern: /metadata\.azure\.com/i, decision: 'deny', reason: 'Azure metadata hostname' },
    { name: 'nc-backdoor', pattern: /\bnc\s+(-[a-z]*\s+)*-[a-z]*e\b/i, decision: 'deny', reason: 'nc execute backdoor' },
    { name: 'wget-pipe-shell', pattern: /\bwget\s+.*\|\s*(ba)?sh\b/i, decision: 'deny', reason: 'wget piped to shell' },
    { name: 'curl-pipe-shell', pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/i, decision: 'deny', reason: 'curl piped to shell' },
    { name: 'kill-init', pattern: /\bkill\s+(-9\s+)?1\b/i, decision: 'deny', reason: 'Kill PID 1 (init)' },
    { name: 'shutdown', pattern: /\b(shutdown|halt|poweroff|reboot)\b/i, decision: 'deny', reason: 'System shutdown' },
    { name: 'xmrig', pattern: /\b(xmrig|minerd|cpuminer|cgminer)\b/i, decision: 'deny', reason: 'Crypto miner' },
    { name: 'read-shadow', pattern: /\/etc\/(shadow|passwd|sudoers)\b/i, decision: 'ask', reason: 'Read sensitive system file' },
    { name: 'read-ssh', pattern: /\.ssh\//i, decision: 'deny', reason: 'Read SSH keys' },
    { name: 'read-aws-creds', pattern: /~\/\.aws\/credentials/i, decision: 'deny', reason: 'Read AWS credentials' },
    { name: 'path-traversal', pattern: /(\.\.\/){2,}/i, decision: 'ask', reason: 'Multiple path traversal' },
    { name: 'git-force-push-main', pattern: /\bgit\s+push\s+(-f|--force)(\s+--.*)?\s+origin\s+(main|master)\b/i, decision: 'deny', reason: 'Force push to main/master' },
    { name: 'git-reset-hard', pattern: /\bgit\s+reset\s+--hard\b/i, decision: 'ask', reason: 'git reset --hard' },
  ];

  for (const p of DANGEROUS) {
    if (p.pattern.test(command)) {
      const decision = p.decision === 'deny' ? 'deny' : 'ask';
      const out = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: decision,
          permissionDecisionReason: `dangerous_pattern:${p.name}: ${p.reason}`,
        },
      };
      process.stdout.write(JSON.stringify(out) + '\n');
      return;
    }
  }

  // No dangerous pattern — allow.
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
    additionalContext: `Bizar PreToolUse(Bash): scanned ${command.length} chars, no dangerous pattern.`,
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});