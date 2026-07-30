# Releasing

1. Keep one active feature and update `PROGRESS.md` before editing.
2. Run targeted tests, `make verify-removed-surfaces`, `make check-arch`, `make test`, `make e2e`, `make clean-check`, and `make check`.
3. Update version, changelog, feature evidence, and docs together.
4. Run `/simplify` on the staged diff.
5. Create one conventional commit through the approval gate.
6. Publish a package, release, tag, push, or PR only after the corresponding human confirmation.
