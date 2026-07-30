# C++ Testing Skill

C++ testing patterns for Claude Code. Covers unit, integration, and host-side tests, framework selection (GoogleTest / Catch2 / doctest), mocking strategies, TDD workflow, and the 80% coverage gate.

## What it provides

- **SKILL.md** — framework selection + 5 deep-dive references
- **references/framework-compare.md** — GoogleTest vs Catch2 vs doctest with code samples
- **references/host-test-for-embedded.md** — pure-CMake host test for firmware `.cpp` without `idf.py`/FreeRTOS
- **references/mocking.md** — abstract interfaces, link-time seam, `std::function` injection, gmock
- **references/tdd-workflow.md** — red-green-refactor in C++
- **references/coverage.md** — gcov/lcov, 80% gate on `main/` and `components/`

## When it triggers

- Writing a new C++ unit or host test
- Choosing a test framework
- Setting up a host-side test binary that links firmware code without ESP-IDF
- Running a test-gate before merging
- Applying TDD to firmware policy/payload modules

## Manual install

```bash
cp -R SKILL.md references ~/.claude/skills/cpp-testing/
```

The BizarHarness installer can also install this automatically — select the **C++ testing** component.
