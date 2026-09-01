---
description: Review or manage bounded global user preferences and project debugging lessons.
argument-hint: "[status|list|remember|forget|compact] [--scope user|project]"
allowed-tools: Bash
disable-model-invocation: true
---

# /learn

Run `bizar learn ${ARGUMENTS:-status}`.

- `--scope user` stores explicit stable preferences globally under
  `BIZAR_HOME`, available in every project.
- `--scope project` stores debugging tricks and pitfalls only in the current
  project's `.bizar/learning` directory.

Use `remember --key <key> --value <text>` only for explicit preferences or
evidence-backed project lessons. The store rejects secret-like/sensitive data,
caps field and record sizes, and injects only a short untrusted-data summary.
