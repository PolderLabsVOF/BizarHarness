# Troubleshooting

Common issues you might hit when using BizarHarness, with concrete fixes.

## "opencode won't start" after install

**Symptom:** `opencode` exits immediately or hangs.

**Cause:** Most often a missing or invalid `auth.json` at `~/.local/share/opencode/auth.json`.

**Fix:**

1. Run `opencode` once to trigger the auth setup prompt.
2. If the TUI doesn't open, run `opencode /connect` to add an API key manually.
3. If you have a Hindsight API key, set `HINDSIGHT_API_KEY` in your environment or `.env` file.
4. Verify the file exists and is readable: `ls -la ~/.local/share/opencode/auth.json`.

For dev sandbox users: the same file is mounted read-only from your host into the container, so set it up on the host first.

## "Agent loops forever" or stuck subagent

**Symptom:** A subagent makes the same tool call repeatedly, even after the loop guard warns it.

**Cause:** Two possibilities — the Bizar plugin isn't loaded, or the subagent prompt doesn't include the `## Loop Guard Handling` section.

**Fix:**

1. **Confirm the plugin is loaded.** In opencode, run `/plugins` and check that `bizar` appears. If not, check `opencode.json` for the `plugin` array and verify `./plugins/bizar/index.ts` is present.
2. **Check the plugin logs.** Look at `~/.cache/bizarharness/logs/<sessionId>.log`. You should see per-tool-call lines. If the file is empty, the plugin is not running.
3. **Disable the plugin for one session** to recover: `BIZAR_DISABLE=1 opencode`.
4. **Disable only the loop guard** if status reporting is useful: `BIZAR_DISABLE_LOOP=1 opencode`.
5. **If you added custom agents,** make sure they include the canonical `## Loop Guard Handling` section. Without it, the loop guard will throw at threshold 12 but the agent will keep retrying. See [Bizar Plugin](Bizar-Plugin) for the full limitations list.

## "Subagent not found" error

**Symptom:** Odin reports it can't find a specific agent.

**Cause:** The agent's `.md` file is missing from `~/.config/opencode/agents/`.

**Fix:**

1. List installed agents: `ls ~/.config/opencode/agents/`. You should see `odin.md`, `frigg.md`, `vor.md`, `quick.md`, `mimir.md`, `heimdall.md`, `hermod.md`, `thor.md`, `baldr.md`, `tyr.md`, `vidarr.md`, `forseti.md`, and `semble-search.md`.
2. If a file is missing, re-run the installer: `bizarharness`.
3. For per-project installs, also check `<project>/.opencode/agents/`.
4. Restart opencode after re-installing.

## "Permission denied" running bash commands

**Symptom:** Subagents (or Odin) get permission errors when running `bash`.

**Cause:** opencode's permission system is blocking the tool. BizarHarness doesn't grant permissions — it relies on the user's existing `opencode.json` config.

**Fix:**

1. Check the `permission` section of `~/.config/opencode/opencode.json`.
2. For unblocked tools, you can add entries like:
   ```jsonc
   "permission": {
     "bash": "allow",
     "edit": "allow"
   }
   ```
3. For per-tool rules, see the opencode permission docs.
4. **Don't enable `dangerously-skip-permissions` for production agents** — only for short-lived test sessions in a sandbox.

## "Rate limit" or cost runaway

**Symptom:** API calls start failing with 429 errors, or you notice a sudden jump in your bill.

**Cause:** Too many parallel subagent dispatches, or a subagent running too long.

**Fix:**

1. **Reduce parallelism.** If Odin is firing 5+ parallel tasks, narrow the request. Opencode is rate-limited per provider; 5 parallel M2.7 calls is fine, 5 parallel M3 calls can hit limits.
2. **Use the background-agent tool-call cap.** Set `BIZAR_BACKGROUND_TOOL_CALL_CAP=200` to abort background instances that have run too long.
3. **Use the test gate.** After implementation, run `bizarharness test-gate` instead of asking Odin to keep iterating.
4. **Temporarily disable high-cost tiers.** Edit `config/agents/tyr.md` and change the model to `minimax/MiniMax-M2.7` (one tier down). Re-run the installer.
5. **For emergency stop,** Ctrl-C the opencode session. The Bizar plugin will mark all in-flight background instances as failed and abort the serve child.

## "Hindsight not working" or memory errors

**Symptom:** Agents report they can't recall past sessions, or `hindsight_recall` returns errors.

**Cause:** Missing or invalid `HINDSIGHT_API_KEY`, or wrong bank ID.

**Fix:**

1. **Verify the key.** Set `HINDSIGHT_API_KEY` in your environment or `.env` file. Run a test recall:
   ```bash
   # In opencode, type:
   @frigg /recall recent project work
   ```
2. **Verify the bank.** At session start, every agent should call `hindsight_list_banks` to see what's available. If the project's bank doesn't exist, agents should create it.
3. **Check that the agent passes `bank_id` correctly.** All `hindsight_retain`, `hindsight_sync_retain`, and `hindsight_recall` calls must pass `bank_id: "<project-name>"`. The default bank is for general knowledge only — never use it for project work.

## "Plugin not loading" (no Bizar in /plugins)

**Symptom:** `/plugins` in opencode doesn't show the Bizar plugin.

**Cause:** The plugin entry is missing from `opencode.json`, or the `plugins/bizar/` directory is missing.

**Fix:**

1. Check `~/.config/opencode/opencode.json` for a `plugin` array:
   ```bash
   jq '.plugin' ~/.config/opencode/opencode.json
   ```
   You should see an entry like `["./plugins/bizar/index.ts", { ... }]`.
2. If the array is missing or empty, re-run `./install.sh` from the BizarHarness repo. The script idempotently adds the plugin entry.
3. Check the plugin files are present:
   ```bash
   ls ~/.config/opencode/plugins/bizar/
   ```
   You should see `index.ts`, `src/`, `tests/`, `package.json`, etc.
4. Restart opencode.

## "npm install" warnings about peer dependencies

**Symptom:** `npm install -g @polderlabs/bizarharness` prints warnings about peer dependencies.

**Cause:** Some BizarHarness dependencies (like `inquirer` v12) require Node 20+. If you're on an older Node, you get warnings.

**Fix:**

- Upgrade Node: use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to install Node 20+.
- The warnings don't block installation; BizarHarness will still run on Node 18+ with reduced functionality (some `node:fs/promises` features may be missing).

## "Vör keeps asking generic questions"

**Symptom:** Vör asks "what framework" or "what files" before reading any project context.

**Cause:** Vör's research-first protocol is broken or the agent file is out of date.

**Fix:**

1. **Fill in `.bizar/PROJECT.md`.** Vör reads this file before asking. If it's empty, Vör will ask generic questions. A good `PROJECT.md` lists the language, framework, database, conventions, and entry points.
2. **Verify the Hindsight bank exists** for the project. Vör checks the bank before asking. If the bank is missing, Vör will ask more than necessary.
3. **If the Vör file is out of date,** re-run the installer. The current `vor.md` includes the research-first protocol.

## "Install says 'opencode not detected' but opencode is installed"

**Symptom:** The installer reports opencode is missing.

**Cause:** `opencode` is not on the installer's `$PATH` lookup.

**Fix:**

1. Verify: `which opencode`. If it returns nothing, the binary is not on `$PATH`.
2. If opencode is installed via npm, add the npm global bin to your shell rc:
   ```bash
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```
3. If opencode is installed via another method (curl, brew, source), make sure the install location is on `$PATH`.
4. Restart your shell.

## "Background agent never finishes"

**Symptom:** A `bizar_collect` call hangs or times out.

**Cause:** The background instance is stuck in a loop, the serve child crashed, or the instance is making slow progress.

**Fix:**

1. **Call `bizar_status(instanceId)`** to see the current state. Check `toolCallCount` — if it's near 500, the cap is about to fire.
2. **If stuck, kill it:** `bizar_kill(instanceId)`.
3. **If the serve child died,** check the plugin log at `~/.cache/bizarharness/logs/`. Look for "serve child exited unexpectedly" — the plugin will auto-retry on the next spawn.
4. **Reduce the timeout** for slow tasks: `bizar_collect(instanceId, { timeoutMs: 60_000 })`. If you need more time, increase the cap with `BIZAR_MAX_CONCURRENT_INSTANCES` and `BIZAR_BACKGROUND_TOOL_CALL_CAP` (if your instance is hitting it).

## Where to get more help

- **GitHub Issues:** https://github.com/DrB0rk/BizarHarness/issues
- **Discussions:** https://github.com/DrB0rk/BizarHarness/discussions
- **Self-improvement log:** `.bizar/AGENTS_SELF_IMPROVEMENT.md` in your project may have a fix for an issue you're seeing.
- **opencode docs:** https://opencode.ai/docs

## Next steps

Next: [FAQ](FAQ) — common questions about the project, the model choices, and the plugin.
