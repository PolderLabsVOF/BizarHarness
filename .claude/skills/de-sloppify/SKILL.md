# de-sloppify — Clean AI Slop from Code

Detects and proposes fixes for common low-quality patterns introduced by LLMs:
empty catch blocks, redundant `return await`, redundant comments, dead code, and `console.log` left in.

## Usage

```
/slop [diff=<git diff string>]
```

When invoked, this skill scans the recent git diff for AI-slop patterns and
proposes reversible changes via a new git diff.

## Patterns Detected

| Pattern | Severity | Description |
|---|---|---|
| Empty catch | HIGH | `catch {}` or `catch (e) {}` — swallows errors silently |
| Redundant return await | MEDIUM | `return await` inside an async function — no effect |
| Redundant comment | LOW | Comment that restates the code (`// increment x`, `x++`) |
| Dead code | HIGH | Unreachable code, commented-out blocks that look intentional |
| console.log left in | CRITICAL | Debug logging committed to source |

## Proposes Reversible Changes

All fixes are proposed as a `git diff` patch. The operator reviews and applies
with `git apply`. No auto-commit.

## Requirements

- `git` available in PATH
- Run from a git repository root
