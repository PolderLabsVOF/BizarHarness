/**
 * dangerous-patterns.ts — Tool approval gate (v6.0.0)
 *
 * Pattern: Hermes Agent `tools/approval.py:546-770` (30+ regex patterns)
 * + OpenFang `crates/openfang-skills/src/verify.rs` + OpenClaw
 * `src/security/external-content.ts:28-43`.
 *
 * Detects dangerous commands and blocks/requires approval before tool
 * execution. Every tool that takes a "command" or "path" argument runs
 * through `checkDangerous()` before being dispatched. Framework-agnostic
 * — used by both the SDK MCP server and any Claude Code hook scripts.
 */

export type ApprovalDecision = "allow" | "require-approval" | "deny";

export interface ApprovalCheck {
  decision: ApprovalDecision;
  reason?: string;
  /** The pattern that matched (for audit log). */
  pattern?: string;
}

const DANGEROUS_PATTERNS: Array<{ name: string; pattern: RegExp; decision: ApprovalDecision; reason: string }> = [
  // Filesystem destruction
  { name: "rm-rf-root", pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/\s*$/i, decision: "deny", reason: "Recursive delete of root filesystem" },
  { name: "rm-rf-etc", pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/(etc|var|usr|boot|home)\b/i, decision: "deny", reason: "Recursive delete of system directory" },
  { name: "rm-rf-wildcard", pattern: /\brm\s+-\w*r\w*f\w*\s+\*/i, decision: "require-approval", reason: "Recursive delete with wildcard" },
  { name: "rm-rf-home", pattern: /\brm\s+(-\w*r\w*f\w*\s+)*~?\//i, decision: "require-approval", reason: "Recursive delete of home directory" },
  { name: "mkfs", pattern: /\bmkfs(\.\w+)?\s+\/dev\//i, decision: "deny", reason: "Format filesystem" },
  { name: "dd-of-dev", pattern: /\bdd\s+.*of=\/dev\//i, decision: "deny", reason: "dd to raw device" },
  { name: "fork-bomb", pattern: /:\(\)\s*\{.*:\|:.*\}\s*;:/i, decision: "deny", reason: "Bash fork bomb" },

  // Privilege escalation
  { name: "sudo", pattern: /(^|\s|;|&&|\|\|)sudo\b/i, decision: "require-approval", reason: "Sudo escalation" },
  { name: "su-root", pattern: /\bsu\s+-?\s*root\b/i, decision: "require-approval", reason: "su to root" },
  { name: "chmod-777", pattern: /\bchmod\s+(-R\s+)?777\b/i, decision: "require-approval", reason: "chmod 777 (world-writable)" },
  { name: "chown-root", pattern: /\bchown\s+(-R\s+)?root\b/i, decision: "require-approval", reason: "chown to root" },

  // Network exfiltration / SSRF
  { name: "curl-metadata", pattern: /169\.254\.169\.254/i, decision: "deny", reason: "AWS metadata IP" },
  { name: "curl-google-metadata", pattern: /metadata\.google\.internal/i, decision: "deny", reason: "GCP metadata hostname" },
  { name: "curl-azure-metadata", pattern: /metadata\.azure\.com/i, decision: "deny", reason: "Azure metadata hostname" },
  { name: "nc-backdoor", pattern: /\bnc\s+(-[a-z]*\s+)*-[a-z]*e\b/i, decision: "deny", reason: "nc execute backdoor" },
  { name: "wget-pipe-shell", pattern: /\bwget\s+.*\|\s*(ba)?sh\b/i, decision: "deny", reason: "wget piped to shell" },
  { name: "curl-pipe-shell", pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/i, decision: "deny", reason: "curl piped to shell" },

  // Process control
  { name: "kill-init", pattern: /\bkill\s+(-9\s+)?1\b/i, decision: "deny", reason: "Kill PID 1 (init)" },
  { name: "pkill-all", pattern: /\bpkill\s+-9?\s+-e?\s*$/i, decision: "require-approval", reason: "pkill all processes" },
  { name: "shutdown", pattern: /\b(shutdown|halt|poweroff|reboot)\b/i, decision: "deny", reason: "System shutdown" },
  { name: "init-0", pattern: /\binit\s+0\b/i, decision: "deny", reason: "init 0 (shutdown)" },

  // Crypto mining
  { name: "xmrig", pattern: /\b(xmrig|minerd|cpuminer|cgminer)\b/i, decision: "deny", reason: "Crypto miner" },

  // Package management
  { name: "pip-install-shell", pattern: /\bpip\s+install\s+.*\|\s*(ba)?sh\b/i, decision: "deny", reason: "pip install piped to shell" },
  { name: "npm-install-shell", pattern: /\bnpm\s+install\s+.*\|\s*(ba)?sh\b/i, decision: "deny", reason: "npm install piped to shell" },

  // Sensitive file reads
  { name: "read-shadow", pattern: /\/etc\/(shadow|passwd|sudoers)\b/i, decision: "require-approval", reason: "Read sensitive system file" },
  { name: "read-ssh", pattern: /\.ssh\//i, decision: "deny", reason: "Read SSH keys" },
  { name: "read-aws-creds", pattern: /~\/\.aws\/credentials/i, decision: "deny", reason: "Read AWS credentials" },
  { name: "read-gcp-creds", pattern: /~\/\.config\/gcloud/i, decision: "deny", reason: "Read GCP credentials" },
  { name: "read-env", pattern: /\/proc\/.*\/environ/i, decision: "deny", reason: "Read process environment" },

  // Path traversal
  { name: "path-traversal", pattern: /(\.\.\/){2,}/i, decision: "require-approval", reason: "Multiple path traversal" },
  { name: "path-ssh-target", pattern: /\/root\/\.ssh/i, decision: "deny", reason: "Path to root SSH" },

  // Dangerous git operations
  { name: "git-force-push-main", pattern: /\bgit\s+push\s+(-f|--force)(\s+--.*)?\s+origin\s+(main|master)\b/i, decision: "deny", reason: "Force push to main/master" },
  { name: "git-clean-fd", pattern: /\bgit\s+clean\s+-\w*f\w*d\b/i, decision: "require-approval", reason: "git clean -fd" },
  { name: "git-reset-hard", pattern: /\bgit\s+reset\s+--hard\b/i, decision: "require-approval", reason: "git reset --hard" },

  // Prompt-injection-style content
  { name: "ignore-previous", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i, decision: "deny", reason: "Prompt injection attempt" },
  { name: "system-prompt-leak", pattern: /reveal\s+(your\s+)?system\s+prompt/i, decision: "deny", reason: "Prompt extraction attempt" },
];

export function checkDangerous(args: Record<string, unknown>): ApprovalCheck {
  const text = collectStrings(args);
  if (!text) return { decision: "allow" };

  for (const p of DANGEROUS_PATTERNS) {
    if (p.pattern.test(text)) {
      return {
        decision: p.decision,
        reason: p.reason,
        pattern: p.name,
      };
    }
  }
  return { decision: "allow" };
}

function collectStrings(value: unknown, parts: string[] = []): string {
  if (value == null) return parts.join("\n");
  if (typeof value === "string") {
    parts.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, parts);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, parts);
    }
  }
  return parts.join("\n");
}

export function listDangerousPatterns(): string[] {
  return DANGEROUS_PATTERNS.map((p) => p.name);
}

export function getDangerousPatternStats(): {
  total: number;
  deny: number;
  requireApproval: number;
} {
  let deny = 0;
  let requireApproval = 0;
  for (const p of DANGEROUS_PATTERNS) {
    if (p.decision === "deny") deny += 1;
    else if (p.decision === "require-approval") requireApproval += 1;
  }
  return { total: DANGEROUS_PATTERNS.length, deny, requireApproval };
}
