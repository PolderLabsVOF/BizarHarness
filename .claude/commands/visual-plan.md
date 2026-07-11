---
description: Toggle the Bizar visual plan canvas or check its current status.
---

# /visual-plan — Toggle Visual Plan Canvas

Toggle the Bizar visual plan canvas or check its current status.

The full arguments are available as `$ARGUMENTS` (and `$1`).

## Usage

```
/visual-plan on   — Enable the visual plan canvas in the current session
/visual-plan off  — Disable the visual plan canvas
/visual-plan status — Show whether the canvas is currently enabled
```

## Notes

The visual plan canvas shows plans as interactive node graphs. When enabled, plan elements appear as draggable nodes on a canvas that agents can manipulate directly. This is useful for visual thinkers or when planning complex multi-step work.

This is a session-level toggle — it affects the current Claude Code
session only.