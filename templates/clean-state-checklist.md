# Clean-State Checklist — Session Exit Gate

> A session is "clean" when ALL FIVE dimensions below pass.
> Use `make clean-check` to verify. Do NOT commit a session that
> fails any dimension.

## The 5 dimensions

### 1. Build passes

- [ ] `make check` exits 0
- [ ] TypeScript: 0 errors
- [ ] No `any` warnings in newly added code

### 2. Tests pass

- [ ] `make test` exits 0
- [ ] All touched-module tests pass
- [ ] No skipped tests added without justification
- [ ] No `.only()` left in test files

### 3. Feature list updated

- [ ] `feature_list.json` reflects actual feature state
  - `passing` features have `evidence` field populated
  - `active` features have a clear owner
  - `not_started` features remain untouched
- [ ] VCR ratio documented in PROGRESS.md

### 4. No debug artifacts

- [ ] No `console.log` in `src/`
- [ ] No `debugger` statements
- [ ] No `*.only()` in test files
- [ ] No commented-out code blocks (>5 lines)
- [ ] No `// TODO` without owner

### 5. Startup path works

- [ ] `make e2e` exits 0
- [ ] Bizar MCP server registers in Claude Code without errors
- [ ] All SDK tools register (≥15 in `BIZAR_TOOLS`)
- [ ] All Claude Code lifecycle hooks wired (SessionStart / PreToolUse / PostToolUse / UserPromptSubmit)
- [ ] Memory tools round-trip (write → read → list → search)

## Dual-mode cleanup strategy

- **Immediate (every clock-out):** Run `make clean-check` and fix
  any failures before committing.
- **Periodic (weekly/monthly):** Run a full structural sweep:
  - Unused files / dead code
  - Stale dependencies (`bun outdated`)
  - Orphaned tests (no matching source file)
  - Outdated docs (references to removed APIs)
  - Security audit (`bun audit`)
