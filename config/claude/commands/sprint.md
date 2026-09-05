---
description: Auto-fill a sprint contract from an OpenKan PRD or plan ID.
allowed-tools: Read, Write, Bash
---

# /sprint — Auto-Fill Sprint Contract from Goal

Reads a durable goal from OpenKan `.ok/` and pre-fills
`templates/sprint-contract.md` with its title and key results.

## Usage

```
/sprint <goal-id>
```

Example: `/sprint F-099`

## What it does

1. Reads every PRD under `.ok/prds/` and finds the matching goal id (e.g. `F-099`)
3. Reads `templates/sprint-contract.md` as the template
4. Pre-fills:
   - **Feature ID** → `goal-id`
   - **Title** → goal title
   - **Scope (in)** → key results (uncompleted first, completed below)
   - **Scope (out)** → empty (explicitly excluded items are sprint-specific)
   - **Definition of Done (DoD)** → standard checkboxes left open until evidence exists
5. Writes to `.bizar/sprints/<goal-id>-YYYY-MM-DD.md`
6. Prints the path so the agent can open/edit it

## Error handling

- Goal not found → `Error: goal '<id>' not found in OpenKan .ok`
- No key results → Scope (in) section left blank with a `<fill>` placeholder
- File write failure → prints the pre-filled content to stdout as fallback

## Constraints

- Never overwrite an existing sprint file for the same goal+date
- Always use today's date in the filename (ISO 8601: YYYY-MM-DD)
- DoD checkboxes remain unchecked; mark them complete only after verification
