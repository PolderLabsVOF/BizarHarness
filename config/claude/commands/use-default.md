---
description: Show the configured model Bizar will use for ordinary work.
allowed-tools: Bash
disable-model-invocation: true
---

# /use-default

Run `bizar tier --agent mike --json "ordinary repository task"`. Report the
first enabled configured candidate and the global router path. Do not hardcode
a provider or write project-local model settings. To change the global picks,
run `bizar models`.
