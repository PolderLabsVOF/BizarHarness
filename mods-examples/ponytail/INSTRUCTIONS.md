---
name: ponytail-instructions
description: Always-on rules installed by the Ponytail mod. Ponytail enforces lazy senior-dev mode — existing? reuse. Stdlib? use it. Native? use it. Dependency? use it. One line? one line. The best code is the code you never wrote.
---

# Ponytail — Installed Instructions

These rules apply whenever the **ponytail** mod is enabled. The current active level lives at `.obsidian/ponytail/state.json` in the project vault.

## How to Read the Level

At session start, check `.obsidian/ponytail/state.json`:

```bash
cat .obsidian/ponytail/state.json
```

| Level | Meaning |
|-------|---------|
| `lite` | Tiny change. One function, one edit, one line. Do not refactor adjacent code. |
| `full` | Feature work. New module allowed if no reusable surface exists. |
| `ultra` | Refactor / audit. Existing-first is mandatory. Removing code is a win. |
| `off` | Ponytail is bypassed. Write the code the user asked for, no matter the cost. |

## Rules (All Agents, All Levels)

1. **Existing first.** Before adding a new function, file, or dependency, search the project (`semble search`) for an existing primitive that does the same thing. If you find one, use it.
2. **Stdlib first.** Before reaching for `npm install <pkg>`, check whether the runtime or the project already has the primitive. Reach for a dependency only when stdlib cannot do it without significant code.
3. **No speculative abstractions.** Do not add `class FooFactory<T>` for one call site. Do not parameterize a function that is called once with one type. Three similar lines beat one clever abstraction.
4. **No "while I'm here" cleanup.** You were asked to do X. Do X. Do not reformat, rename, or refactor adjacent code in the same edit. Leave a one-line note at the end of your summary if you noticed something worth cleaning up later.
5. **Comments only when they earn it.** Comments explain WHY (the non-obvious decision). They do not restate the code. Remove a comment if it disappears when you rename a variable.
6. **Tests count as code.** Apply the same rules to test code. Do not write 200 lines of mock-heavy tests for a 10-line function.

## Rules by Level

### lite
- Single file or single function change.
- Reuse over write — if a helper exists, call it.
- Do not introduce a new dependency.
- Do not modify the public API of any module.

### full
- Multi-file feature.
- New module is OK if no reusable surface exists.
- One new dependency is OK if it removes more lines than it adds.
- Tests required for any new public function.

### ultra
- Refactor / audit mode.
- Existing-first is mandatory: every new function must justify why an existing one cannot be used.
- Removing code is a win. Net LOC must drop, or the change is not worth shipping.
- Reach for `git grep` / `semble search` to find existing primitives before writing anything.

### off
- Bypass mode. Write whatever the user asked for.
- Still: no obvious anti-patterns (null pointer bombs, unbounded recursion, no error handling on critical paths).

## Agent-Specific Overrides

### @thor (medium-complexity implementation)
- Default level: `full`.
- Stop at the first rung that holds. If `existing? reuse` resolves, do not proceed to `stdlib? use it` — you have already won.
- After every edit, run `git diff --stat` and ask: "Did I add more lines than I removed?" If yes, justify each new line in your summary or remove it.

### @tyr (complex implementation)
- Default level: `ultra` for refactors/audits, `full` for new features.
- You have the most expensive model. Spend that budget on harder problems, not on writing more code.

### @heimdall (mechanical work)
- Default level: `lite`.
- Mechanical edits should be small and direct. Do not refactor adjacent code.

### @odin (router)
- When dispatching, tell the agent which level to use if it differs from the default.

## How to Override the Level

The user can change the active level in two ways:

1. **Dashboard** — Mods tab → Ponytail → pick a level.
2. **Direct edit** — `.obsidian/ponytail/state.json` → set `level` to one of `lite` / `full` / `ultra` / `off`.

If a task explicitly asks for a different posture ("just write it", "be thorough", "refactor audit"), trust the user and override the level for that task. State the override in your summary: "Ponytail was at `full`, user asked for an audit, switched to `ultra` for this task."

## Conflict Resolution

If Ponytail says "reuse existing X" and the user explicitly says "do not use X", the user's instruction wins. Surface the conflict in one line and proceed: "Ponytail suggested reusing `X`; per your instruction I did not. If you want to revisit, say so."
