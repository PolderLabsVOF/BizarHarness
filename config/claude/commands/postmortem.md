---
description: Drive a production incident from a ticket through RCA, fix, runbook update, durable postmortem, and OpenKan action items.
argument-hint: "<incident-id-or-url>"
disable-model-invocation: true
allowed-tools: Skill
---

Invoke the Skill tool exactly once. For `/bizar-harness:postmortem`, select the installed `bizar-harness:postmortem` skill; for project `/postmortem`, select the installed `postmortem` skill. Pass `$ARGUMENTS` unchanged. Do not invoke this command again or reimplement the skill.
