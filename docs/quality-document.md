# Quality and verification

| Module | Grade | Evidence gate | Primary risk |
| --- | --- | --- | --- |
| Claude configuration | A- | hook unit tests + settings validation | runtime schema drift |
| SDK and MCP | A | TypeScript + Vitest + E2E tool inventory | optional Agent SDK availability |
| CLI/provision | B+ | serial Node tests + command help validation | historical compatibility branches |
| Skills and agents | A- | skill mirror/metadata checks + agent audit | documentation drift |
| Harness scripts | A- | script unit tests + architecture/absence gates | platform-specific shell behavior |

## Required sequence

1. Targeted test for the changed behavior.
2. `make check` for TypeScript.
3. `make test` for retained unit/integration surfaces.
4. `make e2e` for SDK/MCP/Claude Code wiring.
5. `make verify-removed-surfaces`, `make check-arch`, and `make clean-check` for repository invariants.

Fresh output, not historical evidence, is required for completion claims.
