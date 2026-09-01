---
description: Restore Bizar state from a verified backup.
allowed-tools: Read, Bash
---

# /restore — recover Bizar state from a backup

Run `bizar restore <backup-path>`.

Before restoring, Bizar:

1. Verifies the manifest and every recorded SHA-256 file hash.
2. Ignores source paths stored in the manifest and restores only to canonical
   global or current-project destinations.
3. Applies the selected conflict strategy: merge (default), overwrite, or skip.

Preview safely with `bizar restore <path> --dry-run`.
