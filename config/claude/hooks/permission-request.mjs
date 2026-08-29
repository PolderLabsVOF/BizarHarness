#!/usr/bin/env node
/**
 * PermissionRequest policy.
 *
 * Two layers of enforcement (audit F-176 + audit #81):
 *
 *   1. Tier-4 destructive floor. These are always denied regardless of
 *      role. Lives in `prohibited` below; preserved verbatim from the
 *      F-176 baseline (see `docs/decisions/AUTONOMY_CONTRACT.md`).
 *
 *   2. Role-based capability segregation (audit #81). The hook reads
 *      `BIZAR_AGENT_ROLE` from the environment (default `worker`) and
 *      tightens the policy for non-worker roles:
 *
 *        worker       — Tier 1 autonomy within the task scope. No
 *                       additional restrictions beyond Tier 4.
 *        planner      — Read-only; may write to `.bizar/` (sprint
 *                       contracts, learning ledgers).
 *        research     — Read-only filesystem + WebSearch/WebFetch. No
 *                       git mutations, no package publication.
 *        verifier     — Strict read-only. No filesystem writes, no
 *                       git mutations, no deployments.
 *        integrator   — Writes allowed ONLY for paths listed in
 *                       `BIZAR_INTEGRATION_PATHS` (newline-separated
 *                       absolute or cwd-relative paths).
 *        operator     — Bypass (escape hatch for the human operator).
 *
 *      The hook also reads `BIZAR_INTEGRATION_PATHS` for the
 *      integrator role. Empty list = integrator may not write
 *      anywhere.
 *
 * The hook returns `{ "decision": { "behavior": "deny", ... } }` on
 * any violation and `{}` (allow) otherwise. PreToolUse hooks are
 * advisory per F-176, but PermissionRequest is the *hard* floor — a
 * `deny` here blocks the tool regardless of `permissions.allow`.
 */

import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }

const toolName = String(input.tool_name || '');
const toolInput = (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};
const command = toolName === 'Bash' ? String(toolInput.command || '') : '';
const filePath = (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit' || toolName === 'NotebookEdit')
  ? String(toolInput.file_path ?? toolInput.notebook_path ?? '')
  : '';

const role = String(process.env.BIZAR_AGENT_ROLE || 'worker').toLowerCase();
const integrationPaths = String(process.env.BIZAR_INTEGRATION_PATHS || '')
  .split('\n')
  .map((p) => p.trim())
  .filter(Boolean);

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * Tier-4 destructive floor. Applied to `Bash` commands regardless of
 * role. The strings below must match the regex tokens that
 * `scripts/__tests__/autonomy-contract.test.mjs:permission-request.mjs hard-denies the Tier-4 destructive floor`
 * asserts are present.
 */
const TIER4_BASH = [
  [/(?:^|\s)git\s+push\b[^\n]*(?:--force|-f)\b/i, 'force-push is prohibited by Bizar policy'],
  [/(?:^|\s)git\s+rebase\b/i, 'rebase is prohibited by Bizar policy'],
  [/\brm\s+-[^\s]*r[^\s]*f[^\s]*\s+(?:\/|~\/?)(?:\s|$|;)/i, 'recursive deletion of a root/home boundary is prohibited'],
  [/\b(?:mkfs|shutdown|halt|poweroff|reboot)\b/i, 'system-destructive operation is prohibited'],
];

/** Bash command shapes with a write or external side-effect. Used by
 *  the read-only roles to refuse anything that mutates state. */
const WRITE_BASH_SHAPES = [
  /\bgit\s+(?:commit|push|merge|rebase|reset\s+--hard|checkout\s+--|branch\s+-[dDm]|tag\s+-[df]|update-ref\s+-d)/i,
  /\bgh\s+(?:pr|release|repo|workflow|secret)\s+(?:create|merge|edit|delete|publish|run|enable|disable|set|delete|remove)/i,
  /\b(?:npm|bun|pnpm)\s+publish\b/i,
  /\b(?:vercel|wrangler|flyctl|netlify|heroku|render|surge)\s+(?:deploy|publish)/i,
  /\b(?:rm|mv|cp|chmod|chown|mkdir|rmdir|touch|truncate)\s+/i,
  /\b(?:curl|wget|fetch|Invoke-WebRequest)\b[\s\S]*?-(?:X[\s'"]*(?:POST|PUT|DELETE|PATCH)|-d(?:ata)?[\s'"]|--upload-file|-o[\s'"])/i,
  />\s*[^\s|]/,
  />>\s*[^\s|]/,
  /\btee\s+/i,
  /\bsed\s+-i\b/i,
];

const GIT_MUTATION_SHAPES = /\bgit\s+(?:commit|push|merge|rebase|reset|checkout)\b/i;

function isInIntegrationPaths(p) {
  if (!p) return false;
  return integrationPaths.some((prefix) => p === prefix || p.startsWith(prefix));
}

function evaluate() {
  // Tier 4 floor: applies to Bash regardless of role.
  if (toolName === 'Bash') {
    for (const [pattern, reason] of TIER4_BASH) {
      if (pattern.test(command)) return { reason, source: 'tier4' };
    }
  }
  if (role === 'operator') return null;
  if (role === 'verifier') {
    if (WRITE_TOOLS.has(toolName)) {
      return { reason: `verifier role may not use ${toolName} (read-only)`, source: 'role' };
    }
    if (toolName === 'Bash') {
      for (const shape of WRITE_BASH_SHAPES) {
        if (shape.test(command)) {
          return {
            reason: `verifier role may not run write-shape command: ${command.slice(0, 120)}`,
            source: 'role',
          };
        }
      }
    }
    return null;
  }
  if (role === 'research') {
    if (WRITE_TOOLS.has(toolName)) {
      return { reason: `research role may not use ${toolName} (read-only)`, source: 'role' };
    }
    if (toolName === 'Bash' && GIT_MUTATION_SHAPES.test(command)) {
      return {
        reason: `research role may not run git mutations: ${command.slice(0, 120)}`,
        source: 'role',
      };
    }
    if (toolName === 'Bash') {
      for (const shape of WRITE_BASH_SHAPES) {
        if (shape.test(command)) {
          return {
            reason: `research role may not run write-shape command: ${command.slice(0, 120)}`,
            source: 'role',
          };
        }
      }
    }
    return null;
  }
  if (role === 'planner') {
    // Planners may write into .bizar/ (sprint contracts, learning ledgers).
    if (WRITE_TOOLS.has(toolName)) {
      const allowed = filePath.startsWith('.bizar/') || filePath.includes('/.bizar/');
      if (!allowed) {
        return {
          reason: `planner role may only write under .bizar/ (got ${filePath})`,
          source: 'role',
        };
      }
      return null;
    }
    if (toolName === 'Bash' && GIT_MUTATION_SHAPES.test(command)) {
      return {
        reason: `planner role may not run git mutations: ${command.slice(0, 120)}`,
        source: 'role',
      };
    }
    return null;
  }
  if (role === 'integrator') {
    if (WRITE_TOOLS.has(toolName)) {
      if (integrationPaths.length === 0) {
        return {
          reason: `integrator role has empty BIZAR_INTEGRATION_PATHS; refusing ${toolName} ${filePath}`,
          source: 'role',
        };
      }
      if (!isInIntegrationPaths(filePath)) {
        return {
          reason: `integrator role may only write paths listed in BIZAR_INTEGRATION_PATHS (got ${filePath})`,
          source: 'role',
        };
      }
      return null;
    }
    if (toolName === 'Bash' && GIT_MUTATION_SHAPES.test(command)) {
      return null; // integrator may push, merge, etc.
    }
    return null;
  }
  // role === 'worker' (default): only Tier 4 applies.
  return null;
}

const violation = evaluate();
if (violation) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'deny', message: violation.reason, interrupt: true },
    },
  }) + '\n');
} else {
  process.stdout.write('{}\n');
}