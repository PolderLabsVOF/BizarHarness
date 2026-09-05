# Releasing

1. Claim the release task in OpenKan `.ok/` and keep its verification evidence current.
2. Run targeted tests, `make verify-removed-surfaces`, `make check-arch`, `make test`, `make e2e`, `make clean-check`, and `make check`.
3. Update version, changelog, OpenKan task evidence, and docs together.
4. Run `/simplify` on the staged diff.
5. Create one conventional commit through the approval gate.
6. Publish a package, release, tag, push, or PR only after the corresponding human confirmation.
