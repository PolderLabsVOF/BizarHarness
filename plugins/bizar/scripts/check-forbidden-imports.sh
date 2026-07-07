#!/usr/bin/env bash
# CI: forbid network-bearing node: imports in plugin source (bizar spec §7.5)
#
# Fails fast (exit 1) if any source file in src/ imports a network-bearing
# node: module. Network-bearing modules: dns, net, http, https.
# Other node: modules (fs, path, os, util, crypto, etc.) are allowed.
#
# Exception (NEW-H1 / HIGH-24): `node:crypto` is allowed ONLY in
# `src/serve.ts`, where the 32-byte password is generated for the
# cline serve child's authentication. The legacy `src/fingerprint.ts`
# also uses `node:crypto` (for SHA-256 hashing) and is allowed as a
# pre-existing exception; any NEW use of `node:crypto` outside serve.ts
# and fingerprint.ts fails the check.
#
# grep -E (extended regex) is used rather than grep -F (fixed string) so the
# alternation works on minimal BusyBox / Alpine CI images where extended
# regex is in the default grep build.
set -euo pipefail

# Check 1: network-bearing imports are forbidden everywhere.
if grep -rE 'from "node:(dns|net|http|https)"' src/; then
  echo "FAIL: src/ contains a forbidden node: import (dns|net|http|https)" >&2
  exit 1
fi

# Check 2: `node:crypto` is allowed ONLY in src/serve.ts and src/fingerprint.ts.
# We grep for `from "node:crypto"` in src/, then exclude those two files.
# Any other file with `node:crypto` fails.
if grep -rE 'from "node:crypto"' src/ | grep -vE '^src/(serve|fingerprint)\.ts:'; then
  echo "FAIL: src/ contains 'from \"node:crypto\"' outside src/serve.ts and src/fingerprint.ts" >&2
  echo "      (node:crypto is allowed only in src/serve.ts and src/fingerprint.ts; see spec §6.1 / NEW-H1)" >&2
  exit 1
fi
