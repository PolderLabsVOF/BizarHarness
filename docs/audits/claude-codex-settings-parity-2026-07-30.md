# `claude-codex-settings` parity audit — 2026-07-30

Authoritative source: [fcakyon/claude-codex-settings](https://github.com/fcakyon/claude-codex-settings), commit `39b67e9d244124a575d648364b19e85c510e48a8` (2026-07-29). Applicability was judged against Bizar's purpose: autonomous local software work with explicit human approval at external, irreversible, credential-sensitive, and production boundaries.

| Upstream surface | Bizar result | Implementation / rationale |
| --- | --- | --- |
| Git AI-attribution block | Implemented | `git-workflow-guard.mjs` denies assistant trailers and generated links. |
| Commit-type block | Implemented | Conventional allowlist with a clear repair message. |
| Commit confirmation | Implemented | Every valid commit attempt returns `permissionDecision: ask`. |
| PR confirmation | Implemented | Create/edit/merge/close/reopen are approval-gated. |
| Visual proof | Implemented | Visual-file PRs with inline bodies require image evidence. |
| Force-push block | Implemented | All force variants denied; rebase also denied by Bizar policy. |
| `commit-staged` workflow | Implemented | Exact staged scope, tests, simplify, conventional subject, approval. |
| `create-pr` workflow | Implemented | Branch/diff/test/proof workflow with push and publication approval. |
| Review/comment/summary workflows | Implemented | Read-only review default; fixes and external updates are evidence- and approval-gated. |
| Gone-branch cleanup | Implemented | Only merged local branches, never `-D` or remote deletion, approval required. |
| Simplify skill + commit guard | Implemented | Four-pass review; per-worktree single-use marker consumed per commit attempt. |
| Humanize content hook | Implemented, narrowed | Checks Markdown/text and commit/PR content to avoid false positives in identifiers and code. |
| Intelligent PreCompact priorities | Implemented | Preserves questions, causes, exact evidence, decisions, approvals, and remaining work. |
| Advisor transcript forwarding | Adapted | Recent parent transcript is injected into Bizar review/debug agents with record and size caps. No external advisor binary is required. |
| Sticky session correlation | Implemented locally | Project-scoped UUID under `~/.config/bizar/telemetry`; no network exporter. |
| Rejection categorization | Implemented locally | Recent denied tool feedback is classified into local JSONL telemetry. |
| Marketplace auto-sync | Excluded | Bizar removed its plugin marketplace/install surface; canonical skill mirroring is the supported replacement. |
| Tavily WebFetch/WebSearch redirects | Equivalent | Existing 9Router web-search/web-fetch skills provide provider fallback; forced tool substitution would conflict with user-selected tools. |
| Ultralytics Python/Markdown/Prettier hooks | Excluded | Organization/repository-specific formatting belongs to target project toolchains, not a universal harness. The force-push safety portion was ported. |
| Cloud/vendor skill bundles | Excluded by applicability | Azure, GCP, MongoDB, Supabase, Stripe, LiveKit, research, and office bundles are optional domain dependencies, not harness behavior. |
| ADHD output style | Excluded | Presentation preference is not an autonomy or safety workflow. Bizar keeps concise outcome-first agent instructions. |
| `enableWorkflows`, thinking summaries, auto-dream/always-thinking, empty attribution | Implemented | Present in project and provisioned settings. |
| Upstream `defaultMode: auto` | Adapted | Bizar uses portable `acceptEdits` by default and includes an `autoMode` policy. Claude Code Auto mode currently requires eligible plans/models and direct Anthropic API access; Bizar's default 9Router endpoint may not qualify. Operators may opt in when supported. |

## Hook ordering and control

Claude Code runs hooks in parallel and resolves decisions by precedence. Bizar therefore separates independent guards: danger/protected-path and Git-policy denials override simplify/publication asks. Safe hooks omit `permissionDecision` instead of returning `allow`, so project/user deny and ask rules remain effective.

## Human-in-the-loop boundary

Local reads, edits, tests, builds, declared dependency installs, and reversible cleanup proceed automatically. The settings and hooks ask before commits, pushes, PR mutations, releases, publishing, and deployments; they deny history rewriting and high-confidence destructive/security hazards. Production/shared-infrastructure changes and credential/public-exposure actions remain explicit approval work even when Auto mode is available.
