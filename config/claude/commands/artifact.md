---
description: Toggle the browser completion artifact created after finished work.
argument-hint: "[on|off|status]"
allowed-tools: Bash
disable-model-invocation: true
---

# /artifact

Run `bizar artifact ${ARGUMENTS:-status}`. The setting is global under
`BIZAR_HOME`, so it applies in every project. When enabled, genuinely completed
top-level work creates a bounded local HTML summary and opens it in the default
browser. Subagent and in-progress responses do not create artifacts.
