---
description: Re-provision the currently installed Bizar package into Claude Code.
allowed-tools: Read, Bash
---

# /update

Run `bizar update`. This re-emits the assets from the currently executing Bizar
package; it does not download a newer npm version. To upgrade first, install the
desired `@polderlabs/bizar` version with npm, then run `bizar update --force
--yes` and `bizar validate`.
