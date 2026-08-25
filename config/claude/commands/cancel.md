---
description: Cancel the current durable Bizar workflow without deleting state or unrelated work.
argument-hint: "[reason]"
disable-model-invocation: true
allowed-tools: Skill
---

Invoke the Skill tool exactly once. For `/bizar-harness:cancel`, select the installed `bizar-harness:cancel` skill; for project `/cancel`, select the installed `cancel` skill. Pass `$ARGUMENTS` unchanged. Do not invoke this command again or reimplement the skill.
