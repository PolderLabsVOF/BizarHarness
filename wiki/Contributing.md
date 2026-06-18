# Contributing

Thanks for your interest in BizarHarness. This page covers the repository structure, the development workflow, the code style, and the PR process. The BizarHarness project follows a **spec → Forseti audit → parallel impl** workflow for non-trivial changes.

## Repository structure

```
BizarHarness/
├── cli/                  # the bizar CLI (ESM .mjs files)
│   ├── bin.mjs           # entry point
│   ├── install.mjs       # interactive installer
│   ├── init.mjs          # per-project .bizar/ init
│   ├── plan.mjs          # visual plan tool
│   ├── audit.mjs         # security audit
│   ├── export.mjs        # cross-harness config export
│   ├── copy.mjs          # file-copy helpers
│   ├── prompts.mjs       # inquirer prompts
│   ├── utils.mjs         # path detection, env detection
│   ├── banner.mjs        # ASCII art
│   └── plan.test.mjs     # plan unit tests
├── config/               # opencode config templates (copied by installer)
│   ├── agents/           # the 12 agent definitions + semble-search helper
│   ├── rules/            # always-on rules (general, javascript, python, git, testing)
│   ├── hooks/            # opencode hooks
│   ├── commands/         # slash commands
│   ├── skills/           # bundled skills
│   ├── AGENTS.md         # master routing config (copied verbatim)
│   └── opencode.json     # the opencode.json template
├── plugins/
│   └── bizar/            # the bundled opencode plugin
│       ├── index.ts      # plugin entry
│       ├── src/          # source modules
│       ├── tests/        # unit tests
│       ├── scripts/      # CI scripts (forbidden imports check)
│       └── README.md     # plugin docs
├── templates/
│   └── plan/             # plan viewer/editor templates
├── .bizar/               # project metadata, specs, self-improvement log
│   ├── PROJECT.md        # project description
│   ├── AGENTS_SELF_IMPROVEMENT.md  # the running lesson log
│   └── plugin-architecture-*.md    # spec history
├── install.sh            # source-install script
└── package.json          # npm package metadata
```

A sibling project, `BizarHarness-dev`, lives next to this one and contains the Docker-based dev sandbox. It's the recommended environment for testing changes to the plugin, the agent definitions, and the install flow.

## Dev workflow

For non-trivial changes (anything that touches more than a single file or has security implications), the workflow is:

1. **Spec** — write a spec in `.bizar/`. The file naming convention is `feature-name-v<version>.md`. The spec should describe the problem, the proposed solution, the alternatives considered, and the open questions.

2. **Forseti audit** — dispatch the spec to Forseti (via `@forseti` or a direct dispatch from Odin). Forseti reads the spec and produces an audit document with severity-ranked findings (HIGH, MEDIUM, LOW). The audit catches internal contradictions, missing edge cases, security gaps, and unclear requirements **before any code is written**.

3. **Parallel impl** — once the audit issues are resolved, dispatch the implementation to two agents in parallel:
   - `@thor` (M2.7) for the moderate-complexity parts (CLI, file copy, install flow).
   - `@tyr` (M3) for the complex parts (spec adherence, security-sensitive code, agent prompts).

   The two streams should have **explicit interface contracts** to avoid merge conflicts. Naming conventions, function signatures, and data shapes should be pinned in the task prompt.

4. **Test gate** — after both streams complete, run `bizar test-gate` to detect and run the project's test suite. For the BizarHarness repo itself, this runs `npm test`.

5. **Review and merge** — open a PR. A second agent (or a human reviewer) reviews the diff. The PR is merged after CI passes and review approves.

For trivial changes (typo fixes, formatting, single-file edits), skip the spec and Forseti audit. Just make the change, run the tests, and open a PR.

## Testing in the dev sandbox

All plugin and config changes should be tested in the dev sandbox before opening a PR. The sandbox:

- Uses a separate `~/.config/opencode/` inside the container, so changes don't affect your real install.
- Mounts your project at `/project`, so edits are visible instantly.
- Strips Vidarr and Hindsight by default, so you only need a MiniMax API key.

Quick test loop:

```bash
cd BizarHarness-dev
./scripts/dev.sh
# edit files in BizarHarness on the host — visible inside the container
# rerun ./scripts/dev.sh to restart opencode with the new config
```

After the change is verified, commit and open a PR.

## Code style

- **JavaScript/TypeScript:** ESM modules (`.mjs` for the CLI, `.ts` for the plugin). Use `node:` imports for built-ins. No CommonJS. Run `npm run lint` (if configured) before opening a PR.
- **Agents:** Markdown files in `config/agents/` with YAML frontmatter (`name`, `model`). Body is the agent's prompt. The body must include the canonical `## Hindsight Memory Protocol` and `## Loop Guard Handling` sections — these are byte-identical across all subagents and are verified by SHA256 in the build.
- **Plugins:** TypeScript with strict mode. Run `npm run typecheck` in `plugins/bizar/` before opening a PR. CI runs the forbidden-imports check (`scripts/check-forbidden-imports.sh`).
- **Specs:** Markdown in `.bizar/`. Use the existing spec files as templates — they have a Status line, a Changelog section, and numbered sections referenced by the Forseti audit.
- **CLI prompts:** Use `inquirer` v12. Style: question, separator if needed, helper text where the answer isn't obvious.

Always-on rules (from `rules/`):

- `rules/general.md` — secrets, logging, code quality.
- `rules/javascript.md` — JS/TS conventions.
- `rules/python.md` — Python conventions.
- `rules/git.md` — git and commit conventions.
- `rules/testing.md` — test methodology and coverage.

These are injected into subagent prompts as behavioral constraints. Read them before contributing.

## Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

Scope is the area of the change (`cli`, `plugin`, `config`, `agents`, `docs`, `dev-sandbox`).

Examples:

```
feat(plugin): add threshold-12 hard-block at the tool.execute.before hook

fix(cli): handle Windows path separators in install path resolution

docs(wiki): add Background-Agents page documenting v0.4 async API

refactor(agents): dedupe canonical ## Loop Guard Handling section across 12 subagents
```

## PR process

1. **Open a PR against `main`.** Title should match the commit message format. Body should explain the motivation, the changes, and any trade-offs.
2. **Reference the spec.** For non-trivial changes, link to the spec in `.bizar/` and the Forseti audit (if one was run).
3. **CI must pass.** The CI runs:
   - Lint (for JS/TS).
   - TypeScript typecheck (for the plugin).
   - Unit tests (for the plugin and CLI).
   - The forbidden-imports check (for the plugin).
4. **Reviewer is auto-assigned.** A second agent (or a human) reviews the diff. Look for:
   - Adherence to the spec.
   - Test coverage (80%+ for new code).
   - Security implications (does the change touch a hook? a permission? a network call?).
   - Documentation updates (does the wiki need a new page? does the README need a section?).
5. **Address review feedback.** Push follow-up commits; don't force-push or amend during review.
6. **Squash-merge on approval.** The PR is squash-merged to keep `main` linear. The PR title becomes the squash commit message.

## When to open an issue vs a PR

- **Bug fix or small improvement:** Open a PR directly. Reference any related issues.
- **New feature or behavior change:** Open an issue first to discuss. Once aligned, write a spec, get a Forseti audit, then open a PR.
- **Documentation only:** Open a PR directly. The wiki lives in the repo and PRs to `wiki/` are welcome.

## Communication

- **GitHub Issues** — for bug reports and feature requests.
- **Pull Requests** — for code and documentation contributions.
- **Discussions** — for questions, ideas, and design conversations.

## Next steps

Next: [Troubleshooting](Troubleshooting) — common issues and how to fix them.
