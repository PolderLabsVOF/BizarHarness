> **Updated v6.3.0 (Claude Code migration).** Hook shape changed from Cline's `beforeTool` to Claude Code's `PreToolUse`. The decision vocabulary (`allow` / `require-approval` / `deny`) is preserved inside the harness and translated to Claude Code's `hookSpecificOutput.permissionDecision` (`allow` / `ask` / `deny`) at the hook boundary. The 36-pattern list is unchanged.

# DEC-007 — Tool approval gate (DANGEROUS_PATTERNS)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @karen
**Related:** DEC-001, DEC-008, DEC-011

## Context

The plugin's `PreToolUse` hook ran without any approval gate
(Cline-era name: `beforeTool`; v6.3.0 rename below).
Any tool call reached the host unchanged. A malicious or
accidentally-misguided tool could `rm -rf /`, exfiltrate AWS
credentials via the metadata IP, or inject prompt-injection
content into a tool result.

Bizar already had a `loopThresholdWarn` for runaway loops
(see `state.ts:36`), but no equivalent for content safety.

The reference systems have well-tested approval gates:

- **Hermes Agent** — 30+ regex patterns in
  `tools/approval.py:546-770` (`DANGEROUS_PATTERNS`).
- **OpenFang** — `crates/openfang-skills/src/verify.rs:109-179`
  scans skill content for prompt-injection patterns.
- **OpenClaw** — `src/security/external-content.ts:28-43` —
  14 `SUSPICIOUS_PATTERNS`.

## Decision

Implement a central `DANGEROUS_PATTERNS` list in
`plugins/bizar/src/dangerous-patterns.ts` with **36 patterns**:

- **25 deny** — `rm -rf /`, sudo to /, SSRF (AWS/GCP/Azure
  metadata), fork bomb, prompt injection, /etc/shadow read,
  ~/.ssh/ read, force-push to main, shutdown, kill PID 1, crypto
  miners, /proc/.../environ, …
- **11 require-approval** — sudo, chmod 777, chown root, git
  reset --hard, git clean -fd, path traversal, /etc/(shadow|passwd|sudoers), …

Wire the gate into `PreToolUse`:

```ts
// plugins/bizar/index.ts (v6.3.0)
PreToolUse: async (toolCtx) => {
  // ... existing state-store + loop-guard logic ...
  try {
    const safety = checkDangerous(args as Record<string, unknown>);
    if (safety.decision === "deny") {
      ctx.logger.warn(
        `bizar: blocked tool '${tool}' — dangerous pattern '${safety.pattern}': ${safety.reason}`,
      );
      // Claude Code typed hook output: deny via hookSpecificOutput.
      // Cline-era equivalent was { stop: true, reason }.
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `dangerous_pattern:${safety.pattern}:${safety.reason}`,
        },
      };
    }
    if (safety.decision === "require-approval") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: `require_approval:${safety.pattern}:${safety.reason}`,
        },
      };
    }
  } catch { /* safety checks are best-effort */ }
  // ... rest of the hook ...
}
```

## Consequences

### Positive

- Tool calls with `decision: deny` are stopped **before** they
  reach the host. The host never sees the dangerous call.
- 36 patterns cover the common exploits without false positives
  on legitimate dev work.
- The gate is **always-on** (no env var to disable) — security
  primitives should be opt-out, not opt-in.

### Negative

- Some legitimate commands match patterns (e.g., `git reset
  --hard` is `require-approval`, even in a sandbox).
- Adding a new pattern requires a plugin version bump.

### Neutral

- The gate is best-effort: if `checkDangerous()` throws, the tool
  call is allowed (fail-open for now; queueing fail-closed for
  v6.1.0).
- Future versions may add a "policy file" so users can override
  the deny list per-project.

## Pattern list (full)

```ts
// plugins/bizar/src/dangerous-patterns.ts
const DANGEROUS_PATTERNS = [
  // Filesystem destruction (deny)
  { name: "rm-rf-root", pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/\s*$/i, decision: "deny" },
  { name: "rm-rf-etc", pattern: /\brm\s+(-\w*r\w*f\w*\s+)*\/(etc|var|usr|boot|home)\b/i, decision: "deny" },
  { name: "mkfs", pattern: /\bmkfs(\.\w+)?\s+\/dev\//i, decision: "deny" },
  { name: "dd-of-dev", pattern: /\bdd\s+.*of=\/dev\//i, decision: "deny" },
  { name: "fork-bomb", pattern: /:\(\)\s*\{.*:\|:.*\}\s*;:/i, decision: "deny" },
  // SSRF (deny)
  { name: "curl-metadata", pattern: /169\.254\.169\.254/i, decision: "deny" },
  { name: "curl-google-metadata", pattern: /metadata\.google\.internal/i, decision: "deny" },
  { name: "curl-azure-metadata", pattern: /metadata\.azure\.com/i, decision: "deny" },
  // Process control (deny)
  { name: "kill-init", pattern: /\bkill\s+(-9\s+)?1\b/i, decision: "deny" },
  { name: "shutdown", pattern: /\b(shutdown|halt|poweroff|reboot)\b/i, decision: "deny" },
  { name: "init-0", pattern: /\binit\s+0\b/i, decision: "deny" },
  // Sensitive file reads (deny)
  { name: "read-ssh", pattern: /\.ssh\//i, decision: "deny" },
  { name: "read-aws-creds", pattern: /~\/\.aws\/credentials/i, decision: "deny" },
  { name: "read-gcp-creds", pattern: /~\/\.config\/gcloud/i, decision: "deny" },
  { name: "read-env", pattern: /\/proc\/.*\/environ/i, decision: "deny" },
  // Git (deny)
  { name: "git-force-push-main", pattern: /\bgit\s+push\s+(-f|--force).*origin\s+(main|master)\b/i, decision: "deny" },
  // Prompt injection (deny)
  { name: "ignore-previous", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i, decision: "deny" },
  { name: "system-prompt-leak", pattern: /reveal\s+(your\s+)?system\s+prompt/i, decision: "deny" },
  // ... (18 more, see source)
];
```

## References

- `plugins/bizar/src/dangerous-patterns.ts` (149 lines)
- `plugins/bizar/index.ts` — `PreToolUse` hook integration (v6.3.0;
  was `beforeTool` under Cline)
- `plugins/bizar/tests/safety.test.ts` — 11 unit tests
- https://github.com/walkinglabs/awesome-harness-engineering —
  "Constraints, Guardrails & Safe Autonomy" section
- https://www.anthropic.com/engineering/claude-code-sandboxing —
  Anthropic's sandboxing approach
- DEC-011 — Claude Code migration (v6.3.0)
