---
description: Run bizar init to detect project stack, install relevant skills, and create .bizar/PROJECT.md.
allowed-tools: Read, Bash, Write, Glob
---

# /init — Initialize `.bizar/` in the current project

Run `bizar init` from the project root to:
1. Detect the project stack (language, framework, database, tools)
2. Install relevant skills from the skills registry
3. Create `.bizar/PROJECT.md` with stack and conventions
4. Create the bounded `.bizar/learning/project-lessons.json` store (only if missing)

After init, run `bizar doctor` to validate setup.
