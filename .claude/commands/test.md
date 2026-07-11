---
description: Run the project's test suite via the Bizar test gate. Auto-detects jest/vitest/bun/pytest/cargo/go. Exits non-zero on failure.
allowed-tools: Read, Bash
---

# /test — Run the Project's Test Suite

The `/test` command is a thin wrapper around `bizar test-gate`. It
auto-detects the project's test runner and runs the full suite.

## What It Does

1. Detects the project stack (one of: npm, pytest, cargo, go).
2. Runs the matching test command:
   - `package.json` present → `npm test`
   - `pyproject.toml` present → `pytest`
   - `Cargo.toml` present → `cargo test`
   - `go.mod` present → `go test ./...`
3. Streams the test output to the user.
4. Exits non-zero on test failures.

## Exit Codes

| Code | Meaning                          |
|------|----------------------------------|
| 0    | All tests passed                 |
| 1    | Tests failed                     |
| 2    | No test runner detected          |

## How to Use

Invoke `/test` from the project root. The test gate inspects the
current directory and picks the right runner.

To run a specific Bizar test scope instead, pass arguments to
`/test`. The arguments are forwarded to the underlying runner and
are available as `$ARGUMENTS` (or `$1`, `$2`, ...):

- `/test plugins/bizar` — run only the Bizar plugin tests (bun)
- `/test --testPathPattern=auth` — pass a flag to the runner

## When to Use

- After any non-trivial code change
- Before committing (`@hermod` should always run `/test` first)
- As the final step of a `/team` mission — gate quality with tests

## Common Patterns

- **Post-implementation gate** — after Thor and Tyr finish their
  parallel work, dispatch `thor` to run `/test`. If failures, fix
  and re-run.
- **PR check** — run `/test` in CI before merging.
- **Debug a flaky test** — run `/test` twice; if the second run
  passes, the test is order-dependent (fix or quarantine).

## Related

- `bizar test-gate` — the underlying CLI command
- `bizar doctor` — checks the Bizar install itself (not project tests)
- `make check` — typecheck + tests (full pipeline, dev only)
- `make e2e` — Bizar plugin end-to-end (dev only)