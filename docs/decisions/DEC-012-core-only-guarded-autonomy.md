# DEC-012 — Core-only guarded autonomy

**Status:** Accepted
**Date:** 2026-07-30

## Decision

Bizar is a CLI/configuration/SDK harness, not an application control plane. Remove all web-control-plane and general note-vault/search functionality. Retain only bounded session handoff and learning records required for autonomous continuation and routing.

Use `acceptEdits` as the portable project default. Eligible users may opt into Claude Code Auto mode. Deterministic PreToolUse hooks deny force-push, rebase, dangerous commands, protected-path writes, and invalid publication content. Commits, pushes, PR mutations, releases, publishing, deployments, and external/irreversible actions escalate to a human.

## Consequences

The install is smaller, has fewer dependencies and no service lifecycle, and can operate entirely inside Claude Code. Operators lose browser-based control and note CRUD/search, but gain a narrower trust boundary and executable absence checks.
