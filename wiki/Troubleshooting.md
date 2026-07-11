# Troubleshooting

Common issues you might hit when using BizarHarness, with concrete fixes.

## "claude won't start" after install

**Symptom:** `claude` exits immediately or hangs.

**Cause:** Most often a missing or invalid `auth.json` at `~/.local/share/claude-code/auth.json`.

**Fix:**

1. Run `claude` once to trigger the auth setup prompt.
2. If the TUI doesn't open, run `claude auth` to add an API key manually.
3. Verify the file exists and is readable: `ls -la ~/.local/share/claude-code/auth.json`.

For dev sandbox users: the same file is mounted read-only from your host into the container, so set it up on the host first.

## "Agent loops forever" or stuck subagent

**Symptom:** A subagent makes the same tool call repeatedly, even after the loop guard warns it.

**Cause:** Two possibilities — the Bizar plugin isn't loaded, or the subagent prompt doesn't include the `## Loop Guard Handling` section.

**Fix:**

1. **Confirm the plugin is loaded.** In Claude Code, run `/plugins` and check that `bizar` appears. If not, check `~/.claude/settings.json` for the `plugin` array and verify `./plugins/bizar/index.ts` is present.
2. **Check the plugin logs.** Look at `~/.cache/bizar/logs/<sessionId>.log`. You should see per-tool-call lines. If the file is empty, the plugin is not running.
3. **Disable the plugin for one session** to recover: `BIZAR_DISABLE=1 claude`.
4. **Disable only the loop guard** if status reporting is useful: `BIZAR_DISABLE_LOOP=1 claude`.
5. **If you added custom agents,** make sure they include the canonical `## Loop Guard Handling` section. Without it, the loop guard will throw at threshold 12 but the agent will keep retrying. See [Bizar Plugin](Bizar-Plugin) for the full limitations list.

## "Subagent not found" error

**Symptom:** Odin reports it can't find a specific agent.

**Cause:** The agent's `.md` file is missing from `~/.claude/agents/`.

**Fix:**

1. List installed agents: `ls ~/.claude/agents/`. You should see `odin.md`, `frigg.md`, `vor.md`, `quick.md`, `mimir.md`, `heimdall.md`, `hermod.md`, `thor.md`, `baldr.md`, `tyr.md`, `vidarr.md`, `forseti.md`, and `semble-search.md`.
2. If a file is missing, re-run the installer: `bizar`.
3. For per-project installs, also check `<project>/.claude/agents/`.
4. Restart Claude Code after re-installing.

## "Permission denied" running bash commands

**Symptom:** Subagents (or Odin) get permission errors when running `bash`.

**Cause:** Claude Code's permission system is blocking the tool. BizarHarness doesn't grant permissions — it relies on the user's existing `~/.claude/settings.json` config.

**Fix:**

1. Check the `permission` section of `~/.claude/settings.json`.
2. For unblocked tools, you can add entries like:
   ```jsonc
   "permission": {
     "bash": "allow",
     "edit": "allow"
   }
   ```
3. For per-tool rules, see the Claude Code permission docs.
4. **Don't enable `dangerously-skip-permissions` for production agents** — only for short-lived test sessions in a sandbox.

## "Rate limit" or cost runaway

**Symptom:** API calls start failing with 429 errors, or you notice a sudden jump in your bill.

**Cause:** Too many parallel subagent dispatches, or a subagent running too long.

**Fix:**

1. **Reduce parallelism.** If Odin is firing 5+ parallel tasks, narrow the request. Claude Code is rate-limited per provider; 5 parallel M2.7 calls is fine, 5 parallel M3 calls can hit limits.
2. **Use the background-agent tool-call cap.** Set `BIZAR_BACKGROUND_TOOL_CALL_CAP=200` to abort background instances that have run too long.
3. **Use the test gate.** After implementation, run `bizar test-gate` instead of asking Odin to keep iterating.
4. **Temporarily disable high-cost tiers.** Edit `config/agents/tyr.md` and change the model to `minimax/minimax-m2.7` (one tier down). Re-run the installer.
5. **For emergency stop,** Ctrl-C the Claude Code session. The Bizar MCP server will mark all in-flight background instances as failed and abort the serve child.

## "Memory Service" not working or memory errors

**Symptom:** Agents report they can't recall past sessions, or `bizar memory status` shows unexpected state.

**Cause:** As of v3.24.0, the Hindsight MCP is disabled. Memory is now provided by the local **Memory Service** (file-based, Git-managed). If you're still seeing Hindsight references, the project hasn't been re-initialized against the new memory backend.

**Fix:**

1. **Verify the Memory Service is initialized.** Run `bizar memory status` from the project root. You should see the mode (`local-only` or `managed`), the link target, the dirty count, and the last sync timestamp.
2. **If status reports "not initialized":** run `bizar memory init`. This creates `.bizar/memory.json` and the per-project vault (default `local-only`) or links to the managed repo you specify.
3. **For a full health check:** run `bizar memory doctor`. It runs schema, secrets, and Git checks in one pass and prints per-check pass/fail with details.
4. **For migration from a previous Hindsight-backed setup:** notes held in Hindsight are not auto-migrated. If you need to preserve them, export from the Hindsight dashboard (if available) and import as Markdown files into `<project>/.obsidian/`. The Memory Service schema requires the 8-field frontmatter; you may need to massage the imports with `bizar memory schema/validate` (or `POST /api/memory/schema/validate`).

## "`bizar memory sync` blocks on secret detection"

**Symptom:** `bizar memory sync` (or `commit`) aborts with `secret detected: <pattern-id> in <file>:<line>` and a non-zero exit code.

**Cause:** A note body (or its YAML frontmatter) matches one of the 12 HIGH-severity secret patterns — PEM private keys, AWS access keys, GitHub PATs, Stripe live keys, or bearer tokens. The scanner blocks HIGH matches to prevent accidental secret commits to the memory repo.

**Fix:**

1. **Identify the offending note.** The error prints the path and line. Open the note, remove the secret, and replace with a reference (`<AWS_ACCESS_KEY>` or similar placeholder).
2. **Re-scan before retrying:**
   ```bash
   bizar memory scan-secrets .obsidian/projects/<projectId>/<note>.md
   ```
3. **Retry the sync:**
   ```bash
   bizar memory sync
   ```
4. **If the secret was a real production credential,** rotate it immediately at the issuing service — the secret scanner only blocks commits; it can't un-commit a previously pushed leak.

Patterns are defined in `bizar-dash/src/server/memory-secrets.mjs`. To temporarily allow a MEDIUM-severity match (test API keys, absolute paths, private IPs), pass `--allow-medium` to `bizar memory commit`. HIGH-severity matches cannot be overridden.

## "`bizar memory init` doesn't create `.bizar/memory.json`"

**Symptom:** Running `bizar memory init` exits cleanly but `.bizar/memory.json` is missing, or the command prints "skipped — non-TTY".

**Cause:** Two common causes — `BIZAR_SKIP_INSTALL=1` was set in the environment (CI / sandbox mode), or stdin isn't a TTY (the command prompts for memory mode and aborts if it can't read an answer).

**Fix:**

1. **Force the mode and skip the prompt:**
   ```bash
   bizar memory init --memory-mode local-only
   ```
   Other valid modes: `--memory-mode managed --memory-repo <path>`.
2. **If running under CI**, set `BIZAR_SKIP_INSTALL=0` (or unset it). The `init` command checks this flag and bails early when it's set.
3. **Verify the file was created:**
   ```bash
   ls -la .bizar/memory.json
   jq . .bizar/memory.json
   ```
   You should see `{ "mode": "local-only", "vault": ".obsidian/", ... }` (or the managed-mode equivalent).

## "Lock contention on shared memory repo"

**Symptom:** `bizar memory sync` (or any git operation on the managed repo) fails with `fatal: Unable to create '.sync.lock': File exists` or hangs indefinitely.

**Cause:** Another process is mid-sync against the same managed repo. The lock file at `~/.local/share/bizar/memory/<name>/.sync.lock` holds the PID of the holder.

**Fix:**

1. **Check the holder's PID.** `cat ~/.local/share/bizar/memory/<name>/.sync.lock` — note the PID.
2. **If the PID is alive and busy:** wait for the other sync to finish (it should be quick — pull/commit/push is fast). Re-run after a few seconds.
3. **If the PID is dead** (process exited without releasing the lock): the next `bizar memory sync` will detect the dead PID via liveness check and release the lock automatically. If you need to force-clear immediately, `rm ~/.local/share/bizar/memory/<name>/.sync.lock` (safe — the lock is advisory, not a `flock`).
4. **To detect this proactively:** run `bizar memory doctor` — it checks for stale lock files alongside schema, secrets, and Git health.

## "Plugin not loading" (no Bizar in /plugins)

**Symptom:** `/plugins` in Claude Code doesn't show the Bizar plugin.

**Cause:** The plugin entry is missing from `settings.json`, or the `plugins/bizar/` directory is missing.

**Fix:**

1. Check `~/.claude/settings.json` for a `plugin` array:
   ```bash
   jq '.plugin' ~/.claude/settings.json
   ```
   You should see an entry like `["./plugins/bizar/index.ts", { ... }]`.
2. If the array is missing or empty, re-run `./install.sh` from the BizarHarness repo. The script idempotently adds the plugin entry.
3. Check the plugin files are present:
   ```bash
   ls ~/.claude/plugins/bizar/
   ```
   You should see `index.ts`, `src/`, `tests/`, `package.json`, etc.
4. Restart Claude Code.

## "npm install" warnings about peer dependencies

**Symptom:** `npm install -g @polderlabs/bizar` prints warnings about peer dependencies.

**Cause:** Some BizarHarness dependencies (like `inquirer` v12) require Node 20+. If you're on an older Node, you get warnings.

**Fix:**

- Upgrade Node: use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to install Node 20+.
- The warnings don't block installation; BizarHarness will still run on Node 18+ with reduced functionality (some `node:fs/promises` features may be missing).

## "Vör keeps asking generic questions"

**Symptom:** Vör asks "what framework" or "what files" before reading any project context.

**Cause:** Vör's research-first protocol is broken or the agent file is out of date.

**Fix:**

1. **Fill in `.bizar/PROJECT.md`.** Vör reads this file before asking. If it's empty, Vör will ask generic questions. A good `PROJECT.md` lists the language, framework, database, conventions, and entry points.
2. **Verify the Memory Service vault exists** for the project. Vör checks the vault before asking. If the vault is missing, Vör will ask more than necessary — run `bizar memory init` and confirm `bizar memory status` reports a healthy vault.
3. **If the Vör file is out of date,** re-run the installer. The current `vor.md` includes the research-first protocol.

## "Install says 'claude not detected' but claude is installed"

**Symptom:** The installer reports Claude Code is missing.

**Cause:** `claude` is not on the installer's `$PATH` lookup.

**Fix:**

1. Verify: `which claude`. If it returns nothing, the binary is not on `$PATH`.
2. If claude is installed via npm, add the npm global bin to your shell rc:
   ```bash
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```
3. If claude is installed via another method (curl, brew, source), make sure the install location is on `$PATH`.
4. Restart your shell.

## "Background agent never finishes"

**Symptom:** A `bizar_collect` call hangs or times out.

**Cause:** The background instance is stuck in a loop, the serve child crashed, or the instance is making slow progress.

**Fix:**

1. **Call `bizar_status(instanceId)`** to see the current state. Check `toolCallCount` — if it's near 500, the cap is about to fire.
2. **If stuck, kill it:** `bizar_kill(instanceId)`.
3. **If the serve child died,** check the plugin log at `~/.cache/bizar/logs/`. Look for "serve child exited unexpectedly" — the plugin will auto-retry on the next spawn.
4. **Reduce the timeout** for slow tasks: `bizar_collect(instanceId, { timeoutMs: 60_000 })`. If you need more time, increase the cap with `BIZAR_MAX_CONCURRENT_INSTANCES` and `BIZAR_BACKGROUND_TOOL_CALL_CAP` (if your instance is hitting it).

## "bizar_spawn_background" fails with "sessionId must be non-empty"

**Symptom:** Calling `bizar_spawn_background` (or any Odin dispatch that uses it) immediately returns:

```
EventStream.onSessionEvent: sessionId must be non-empty
```

**Cause:** The installed plugin is **pre-v0.5.1**. The bug was that `InstanceManager.add()` synchronously called `attachEventHandler` with the draft's empty `sessionId`. Fixed in v0.5.1.

**Fix:**

1. **Verify the installed version.** From the BizarHarness repo on the same machine:
   ```bash
   grep version ~/.claude/plugins/bizar/package.json
   ```
   Should be `0.5.1` or later.
2. **If older:** re-run `bash install.sh` from the BizarHarness repo. This copies the new source to `~/.claude/plugins/bizar/`.
3. **If the version is correct but the error still appears:** the plugin was loaded by the *old* source at Claude Code startup. **Restart Claude Code** to load the new code. The plugin has no hot-reload.
4. **Run the regression test** to confirm the fix is in the source you deployed:
   ```bash
   cd ~/.claude/plugins/bizar && export PATH="$HOME/.bun/bin:$PATH" && bun test tests/attach-handler-bug.test.ts
   ```
   All 3 tests should pass.

## Installed plugin source changes aren't taking effect

**Symptom:** You edited a file in `plugins/bizar/src/` and re-ran `install.sh`, but Claude Code is still using the old behavior. No error, just no change.

**Cause:** The Bizar MCP server has **no hot-reload**. Claude Code loads the plugin at process start and keeps it in memory for the session lifetime. `install.sh` only copies files to disk — it does not signal Claude Code to reload.

**Fix:**

1. **Restart Claude Code.** This is the only reliable way. There's no in-process reload.
2. If you're seeing this frequently during development, consider using the [Dev Sandbox](Dev-Sandbox) — the Docker-based sibling repo reloads the plugin on every Claude Code restart in a fresh container, which is much faster than restarting your main Claude Code.

## "install.sh" didn't deploy the latest commands

**Symptom:** You `git pull`'d BizarHarness and see new commands in `config/commands/`, but `/help` in Claude Code doesn't show them.

**Cause:** Pre-v0.5.1, `install.sh` only copied `agents/`, `skills/`, and the Bizar MCP server. Slash commands and hooks were not deployed.

**Fix:**

1. Re-run `bash install.sh`. The v0.5.1 installer copies `config/commands/*.md` and `config/hooks/*` (recursive).
2. Restart Claude Code to pick up the new commands.
3. Verify with `ls ~/.claude/commands/` — your new commands should appear.

## "tailscale serve" hangs forever

**Symptom:** You run `/tailscale-serve` (or `tailscale serve --bg <port>`) and the command never returns.

**Cause:** `tailscale serve` may try to open a browser to walk you through admin enable flow. If you're on a headless box (SSH, no `$DISPLAY`), the browser never opens, the prompt never resolves, and the command hangs.

**Fix:**

1. **Cancel the hanging command** (Ctrl-C).
2. **Run with a timeout** from a script:
   ```bash
   timeout 5 tailscale serve --bg --https=443 http://127.0.0.1:8765
   ```
3. **Or use the `/tailscale-serve` command** shipped with BizarHarness — it has the timeout built in and surfaces the admin-enable URL clearly if serve is not yet enabled.
4. **If you need serve enabled but can't reach a browser:** visit `https://login.tailscale.com/f/serve?node=<your-node-id>` from any device logged into the tailnet. The node ID is shown in `tailscale status --json` (`Self.ID`).

## "/tailscale-serve" says "Serve is not enabled"

**Symptom:** The command reports the admin-enable URL.

**Cause:** Tailscale Serve is a tailnet-level setting. The admin (you) must enable it once for the whole tailnet — there is no per-device flag.

**Fix:**

1. Click the URL the command printed, or visit `https://login.tailscale.com/f/serve?node=<node-id>` from any tailnet device.
2. Confirm the enable.
3. Re-run `/tailscale-serve` — the command will now succeed and print the `https://<magicdns>/` URL.

**Workaround while waiting for admin enable:** the demo's `npm run host:start` script binds the static server to `0.0.0.0:8765` and lets you reach it at `http://devbox.<your-tailnet>.ts.net:8765/`. Plain HTTP, but safe inside the tailnet (WireGuard-encrypted). Don't expose port 8765 to the public internet.

## Where to get more help

- **GitHub Issues:** https://github.com/DrB0rk/BizarHarness/issues
- **Discussions:** https://github.com/DrB0rk/BizarHarness/discussions
- **Self-improvement log:** `.bizar/AGENTS_SELF_IMPROVEMENT.md` in your project may have a fix for an issue you're seeing.
- **Claude Code docs:** https://docs.claude.com/claude-code

## Next steps

Next: [FAQ](FAQ) — common questions about the project, the model choices, and the plugin.
