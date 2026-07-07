# Installation

BizarHarness can be installed three ways: from npm, from source, or per-project. The npm install is right for almost everyone; the source install is for contributors; the per-project install is for CI or sandboxed environments.

> **v4.0.0:** `@polderlabs/bizar` ships as a single package — the dashboard server, cline plugin, and typed SDK are bundled inside. There is no separate `@polderlabs/bizar-dash` install step.

## npm (recommended)

The package is published to npm at [`bizar`](https://www.npmjs.com/package/bizar).

### Run without installing

The fastest way to try BizarHarness without leaving anything on your machine:

```bash
npx bizar
```

`npx` downloads the package to a temp directory, runs the interactive installer, and cleans up. Use this to evaluate BizarHarness before committing to a global install.

### Install globally

For an install that sticks:

```bash
npm install -g @polderlabs/bizar
bizar
```

This puts the `bizar` binary on your `$PATH`. Verify with:

```bash
bizar --help
```

You should see the help text with usage, subcommands (`audit`, `init`, `export`, `plan`, `test-gate`), and the install hint.

### Add to a project as a dev dependency

If you want `bizar` to be available only inside a specific project (and tracked in `package.json`):

```bash
npm install --save-dev bizar
npx bizar
```

The `--save-dev` flag keeps the install out of production dependencies. The `npx` invocation is needed because the binary isn't on the global `$PATH` from a local install.

### Verify the install

```bash
bizar --version
```

The current version is `1.2.1`. If the command is not found, your `$PATH` does not include the npm global bin directory. On most systems this is `~/.npm-global/bin` (custom) or `$(npm config get prefix)/bin` (default). Add it to your shell rc.

## Manual install from source

Use this if you want to hack on BizarHarness itself — change an agent's prompt, add a new agent, or test a plugin patch.

```bash
git clone git@github.com:DrB0rk/BizarHarness.git
cd BizarHarness
chmod +x install.sh
./install.sh
```

The script:

1. Creates `~/.config/cline/agents/` if it doesn't exist.
2. Copies every file from `config/agents/*.md` into that directory.
3. Copies the master `config/AGENTS.md` to `~/.config/cline/AGENTS.md`.
4. Installs bundled skills (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF) to `~/.cline/skills/`.
5. Copies the bundled plugin from `plugins/bizar/` to `~/.config/cline/plugins/bizar/`, excluding `node_modules`, `dist`, and `*.log`.
6. Merges the template `config/cline.json` into your existing `~/.config/cline/cline.json` using `jq`. If `jq` is missing, it falls back to a copy. If a config already exists, it's backed up to `cline.json.bak` first.
7. Idempotently ensures the Bizar plugin entry is in the `plugin` array, even if the merge step replaced the array.
8. Prints next steps (edit `cline.json`, restart cline, `/connect`).

After the script runs, restart cline and run `/connect`.

## Per-project install (bizar init)

If you want BizarHarness to live inside a single project — useful for monorepos, multi-tenant setups, or contributors who don't want a global install — use `init`:

```bash
cd ~/my-project
bizar init
```

`init` is a lighter-weight version of the full installer. It:

- Detects the project stack (Next.js, Django, Rust, etc.) from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`.
- Installs relevant skill packs based on the detected stack.
- Creates `.bizar/PROJECT.md` with stack, conventions, and entry points.
- Creates `.bizar/AGENTS_SELF_IMPROVEMENT.md` with starter active rules.
- Prompts for the memory backend mode (`local-only` is the default; pick `managed` if you want memory shared across projects).
- Initializes project memory: `bizar memory init` creates `.bizar/memory.json` and the project's vault at `.obsidian/` (local-only) or links to `~/.local/share/bizar/memory/<repoName>/` (managed).

`init` does **not** copy agent files into `~/.config/cline/`. It assumes the global install already happened (so all the agents are available), and just configures the project for use with BizarHarness.

### Memory bootstrap step

After `init`, project memory is ready. The default mode is `local-only` — a per-project Obsidian vault at `.obsidian/` that holds conventions, ADRs, bug patterns, and command snippets. To opt into the managed mode (one shared user repo at `~/.local/share/bizar/memory/<repoName>/` with three namespaces — `projects/<id>/`, `global/bizar/`, `users/<id>/`), either pick `managed` at `init` time or run:

```bash
bizar memory link ~/.local/share/bizar/memory/<repoName>/
bizar memory sync
```

The `sync` command runs `git pull → reindex → commit → push` and scans every note for HIGH/MEDIUM secrets before committing. See [Commands Reference → Memory Commands](Commands-Reference#memory-commands) for the full subcommand list.

## Uninstall

To remove BizarHarness globally:

```bash
npm uninstall -g bizar
```

Then clean up the artifacts it left behind:

```bash
# Agent definitions
rm -rf ~/.config/cline/agents/

# Master AGENTS.md (verify no other harness needs it first)
rm -f ~/.config/cline/AGENTS.md

# Bizar plugin
rm -rf ~/.config/cline/plugins/bizar/

# Plugin entry from cline.json (manual edit; or restore from backup)
cp ~/.config/cline/cline.json.bak ~/.config/cline/cline.json
```

If you used a per-project install, delete the `.bizar/` folder from the project root:

```bash
rm -rf .bizar/
```

Note: `Headroom`, `Semble`, and the `Skills CLI` are installed as side-effects of the BizarHarness installer. Remove them only if you're sure no other project depends on them.

```bash
# Headroom
pip uninstall headroom-ai
# Semble
uv tool uninstall semble
# Skills CLI
npm uninstall -g skills
```

## Troubleshooting install issues

**`bizar: command not found` after `npm install -g`.**

Your npm global bin directory is not on `$PATH`. Find it with `npm config get prefix`, then add `<prefix>/bin` to your shell rc. Restart the shell.

**`EACCES: permission denied` during install.**

You installed Node with sudo and npm can't write to the global directory. Fix the permissions on the npm prefix, or use a version manager (nvm, fnm) to install Node in your home directory.

**Installer hangs on "Detecting cline".**

The pre-flight check runs `cline --version`. If cline isn't on `$PATH`, the check should fail gracefully and prompt to continue. If it hangs, cancel with Ctrl-C and check `which cline`.

**`jq: command not found` during `./install.sh`.**

The install script falls back to copying the template `cline.json` instead of merging. You'll lose any custom config you had. Install `jq` (`brew install jq`, `apt install jq`) and re-run the script — it will preserve your existing config on the second run.

**Plugin copy fails with "no such file or directory" on Windows.**

The `find` command in `install.sh` uses POSIX semantics. On Windows, use Git Bash or WSL, not cmd.exe.

**`cline` restarts but the new agents don't appear.**

The cline TUI caches the agent list at startup. After running the installer, fully quit cline (Ctrl-C twice) and start it again — `/agents` should now show Odin, Thor, Tyr, etc.

**`bizar init` doesn't detect my stack.**

`init` only recognizes `package.json`, `pyproject.toml`, `Cargo.toml`, and `go.mod`. If your project uses something else (Bun, Deno, a Makefile-only build), `init` will report the language as "unknown" and skip skill pack installation. The `.bizar/PROJECT.md` file is still created and can be edited by hand.

## Next steps

Next: [Quick Start](Quick-Start) — a five-minute tour of the agent system in action.

For the full architecture, see [Architecture](Architecture).
