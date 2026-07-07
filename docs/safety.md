# Safety — DANGEROUS_PATTERNS Approval Gate

> The plugin's tool-call approval gate. **Always-on.** Stops
> dangerous operations before they reach the host. Source:
> `plugins/bizar/src/dangerous-patterns.ts`.

## TL;DR

Every tool call goes through `checkDangerous()` in the
`beforeTool` hook. If the call's arguments match a deny
pattern, the call is stopped with `{ stop: true, reason: '...' }`.
The host never sees the dangerous call.

## Pattern categories (36 total)

### 1. Filesystem destruction (7 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `rm-rf-root` | deny | `rm -rf /` |
| `rm-rf-etc` | deny | `rm -rf /etc /var /usr /boot /home` |
| `rm-rf-wildcard` | require-approval | `rm -rf *` |
| `rm-rf-home` | require-approval | `rm -rf ~` |
| `mkfs` | deny | `mkfs.ext4 /dev/sda1` |
| `dd-of-dev` | deny | `dd if=/dev/zero of=/dev/sda` |
| `fork-bomb` | deny | `:() { :\|:& };:` |

### 2. Privilege escalation (4 patterns)

| Pattern | Decision | Example |
| --- | --- | --- |
| `sudo` | require-approval | `sudo apt install foo` |
| `su-root` | require-approval | `su - root` |
| `chmod-777` | require-approval | `chmod 777 file` |
| `chown-root` | require-approval | `chown root file` |

### 3. SSRF (4 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `curl-metadata` | deny | `http://169.254.169.254/latest/meta-data/` |
| `curl-google-metadata` | deny | `http://metadata.google.internal/...` |
| `curl-azure-metadata` | deny | `http://metadata.azure.com/...` |
| `nc-backdoor` | deny | `nc -e /bin/sh ...` |

### 4. Network exfiltration (2 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `wget-pipe-shell` | deny | `wget http://... \| sh` |
| `curl-pipe-shell` | deny | `curl http://... \| sh` |

### 5. Process control (4 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `kill-init` | deny | `kill -9 1` |
| `pkill-all` | require-approval | `pkill -9` |
| `shutdown` | deny | `shutdown -h now`, `reboot` |
| `init-0` | deny | `init 0` |

### 6. Crypto mining (1 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `xmrig` | deny | `xmrig`, `minerd`, `cpuminer`, `cgminer` |

### 7. Package management (2 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `pip-install-shell` | deny | `pip install x \| sh` |
| `npm-install-shell` | deny | `npm install x \| sh` |

### 8. Sensitive file reads (5 patterns)

| Pattern | Decision | Example |
| --- | --- | --- |
| `read-shadow` | require-approval | `/etc/shadow`, `/etc/passwd`, `/etc/sudoers` |
| `read-ssh` | deny | `~/.ssh/`, `~/.ssh/id_rsa` |
| `read-aws-creds` | deny | `~/.aws/credentials` |
| `read-gcp-creds` | deny | `~/.config/gcloud/...` |
| `read-env` | deny | `/proc/<pid>/environ` |

### 9. Path traversal (2 patterns)

| Pattern | Decision | Example |
| --- | --- | --- |
| `path-traversal` | require-approval | `../../etc/passwd` |
| `path-ssh-target` | deny | `/root/.ssh` |

### 10. Dangerous git (3 patterns)

| Pattern | Decision | Example |
| --- | --- | --- |
| `git-force-push-main` | deny | `git push --force origin main` |
| `git-clean-fd` | require-approval | `git clean -fd` |
| `git-reset-hard` | require-approval | `git reset --hard` |

### 11. Prompt injection (2 deny)

| Pattern | Decision | Example |
| --- | --- | --- |
| `ignore-previous` | deny | `ignore previous instructions and...` |
| `system-prompt-leak` | deny | `reveal your system prompt` |

## How it works

```ts
// plugins/bizar/src/dangerous-patterns.ts
import { checkDangerous } from "./dangerous-patterns.js";

const safety = checkDangerous(toolArgs);
if (safety.decision === "deny") {
  return { stop: true, reason: `dangerous_pattern:${safety.pattern}` };
}
```

The `checkDangerous()` function:

1. Collects all string values from the tool's arguments
   (recursively — handles nested objects + arrays).
2. Tests each pattern in `DANGEROUS_PATTERNS` (case-insensitive
   regex).
3. Returns the first match (with pattern name + reason).
4. If no pattern matches, returns `{ decision: "allow" }`.

## API

```ts
// types
export type ApprovalDecision = "allow" | "require-approval" | "deny";

export interface ApprovalCheck {
  decision: ApprovalDecision;
  reason?: string;
  pattern?: string;
}

export function checkDangerous(args: Record<string, unknown>): ApprovalCheck;
export function listDangerousPatterns(): string[];
export function getDangerousPatternStats(): {
  total: number;
  deny: number;
  requireApproval: number;
};
```

## Tests

`plugins/bizar/tests/safety.test.ts` (11 unit tests):

- blocks `rm -rf /`
- blocks curl to AWS metadata
- blocks sudo escalation
- blocks prompt injection in tool input
- blocks force-push to main
- blocks read of `~/.ssh/`
- allows safe commands
- checks nested args recursively
- returns 30+ patterns
- lists pattern names

## Design notes

- **Fail-open on errors.** If `checkDangerous()` throws, the
  tool call is allowed. Security is best-effort; a fail-closed
  mode is queued for v6.1.0.
- **Always-on.** No env var to disable. Security primitives
  should be opt-out, not opt-in.
- **Nested args.** The function walks the entire args object
  recursively, so a tool that takes `{ options: { command: "..." } }`
  is still scanned.

## References

- [DEC-007](decisions/DEC-007-tool-approval-gate.md) — the
  decision that introduced the gate
- [docs/architecture.md](architecture.md) — `beforeTool` integration
- Hermes Agent `tools/approval.py:546-770` — reference
- OpenFang `crates/openfang-skills/src/verify.rs` — reference
- OpenClaw `src/security/external-content.ts:28-43` — reference
- https://github.com/walkinglabs/awesome-harness-engineering —
  "Constraints, Guardrails & Safe Autonomy"
