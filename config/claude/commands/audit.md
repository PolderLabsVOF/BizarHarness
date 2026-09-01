---
description: Run the current repository audit and write its evidence report.
allowed-tools: Read, Write, Bash
---

# /audit

Run `node scripts/audit.mjs --write`, then report its actual category results
and the path `.harness/audit/latest.json`. The script is the source of truth for
categories, weights, commands, and output fields; do not restate a copied score
table in this command because it drifts when the audit evolves.
