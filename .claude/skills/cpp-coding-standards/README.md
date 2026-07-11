# C++ Coding Standards Skill

Modern C++17/20 standards skill for Claude Code. Loads when an agent is writing, reviewing, or refactoring C++ code. Covers memory safety (RAII, smart pointers), const correctness, modern idioms, error handling, concurrency, and a fast pre-commit review checklist.

## What it provides

- **SKILL.md** — quick-start checklist + 5 deep-dive references
- **references/memory-safety.md** — RAII, `unique_ptr`/`shared_ptr`/`weak_ptr`, Rule of Five/Zero
- **references/modern-idioms.md** — C++17/20 features with examples
- **references/error-handling.md** — exceptions vs `std::error_code` vs `std::expected`
- **references/concurrency.md** — mutex, lock_guard, atomic, jthread
- **references/review-checklist.md** — fast pre-commit gate

## When it triggers

- Editing or reviewing `.cpp`/`.hpp`/`.cc`/`.h` files
- Fixing C++ build errors
- Refactoring legacy C++ to modern idioms
- Reviewing C++ pull requests

## Manual install

```bash
# Copy whole folder to Claude Code's skills dir
cp -R SKILL.md references ~/.claude/skills/cpp-coding-standards/
```

The BizarHarness installer can also install this automatically — select the **C++ coding standards** component.
