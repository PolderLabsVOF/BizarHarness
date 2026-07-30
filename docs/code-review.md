# Code review policy

Review the smallest relevant diff. Rank findings by severity and include a concrete file/line, consequence, and minimal repair. Distinguish confirmed defects, questions, and non-blocking suggestions. Require regression coverage for behavior changes and fresh validation output before approval. External review actions are read-only unless the user explicitly requests publication.

## Enforced findings

- `repo-structure`: retired roots, runtime manifests, editor metadata, test
  files, duplicate skill mirrors, and local state must not enter source control
  or the npm package. Fix by deleting the stale path or narrowing
  `package.json#files`; verify with `make verify-repo-structure`.
