---
description: Restore Bizar state from a previous /backup snapshot.
allowed-tools: Read, Bash
---

# /restore — recover Bizar state from a backup

Runs `bizar restore <snapshot-path>`. The snapshot path is the timestamped
directory `bizar backup` wrote under `~/.config/bizar/backups/<UTC>/`.

Before restoring, Bizar verifies that:

1. The snapshot is signed by the same machine id that created it.
2. The schema version of the contained `feature_list.json` and
   `tasks.sqlite` is compatible with the currently installed `@polderlabs/bizar-sdk`.
3. The target directories do not contain newer state — newer state is
   preserved into a parallel `<snapshot>-before-restore/` folder.

Restoration is reversible: nothing in the target directory is deleted
until the safe-copy step succeeds.