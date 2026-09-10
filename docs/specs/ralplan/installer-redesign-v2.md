# Installer Redesign v2 — Plan

> Status: draft v2 (paul → architect → critic loop)
> Owner: `@mike` (orchestration) → `@paul` (plan) → `@linda` (audit gate) → implementation agents
> Scope: refactor `bizar install` / `bizar update` into a layered, idempotent, provider-agnostic installer with a deterministic merge strategy and a first-class interactive wizard, without breaking existing CLI entry points or the `~/.claude/settings.json` invariants currently enforced by `cli/install/__tests__/merge-settings.test.mjs`.

## 1. Architecture overview

### Current shape (v10.29.x)

```
cli/install.mjs                  ← back-compat shim (runInstaller)
cli/install/
  index.mjs                      ← runInstaller orchestrator
  paths.mjs                      ← PATHS + printInstallLocations
  banner.mjs                     ← showBanner / sectionHeading
  interactive-setup.mjs           ← readline-based provider prompts
  __tests__/merge-settings.test.mjs   ← canonical settings-merge contract
cli/provision.mjs                ← writeClaudeSettings + installClaudeCli
cli/commands/install.mjs         ← CLI surface
cli/commands/setup-provider.mjs  ← secondary provider command
install.sh                       ← bash deps → node cli/provision.mjs --mode=install --yes
```

### Target shape (v10.30)

```
cli/install/
  index.mjs            ← runInstaller() orchestrator (thin)
  detect.mjs           ← detectInstalledAgents({ env, fs })
  desktop-config.mjs   ← findActiveDesktopConfig / readActiveDesktopConfig / mergeGatewayIntoDesktopConfig
  wizard.mjs           ← @clack/prompts wizard (the visual surface)
  paths.mjs            ← multi-target path card (Claude Code + Desktop)
  banner.mjs           ← chalk-only helpers; clack owns the interactive visuals
  provider.mjs         ← pure provider-config read/write helpers (extracted from interactive-setup.mjs)
  merge-settings.mjs   ← canonical writeClaudeSettings merge (extracted from cli/provision.mjs)
  __tests__/
    detect.test.mjs
    desktop-config.test.mjs
    wizard.test.mjs
    merge-settings.test.mjs (existing, must keep passing)
cli/provision.mjs      ← strips installClaudeCli() default; opt-in only
cli/commands/install.mjs   ← adds --targets and --install-claude-cli
cli/commands/setup-provider.mjs   ← thin wrapper that defers to wizard's gateway page
cli/config-paths.mjs   ← adds resolveDesktopConfigLibrary()
package.json           ← adds @clack/prompts dependency
install.sh             ← unchanged (still routes to provision with --yes)
```

### Layered responsibilities

- **Detect layer** (`detect.mjs`) — pure functions over the filesystem and `process.env`. No writes. Returns `{ claudeCode: { present, path, gatewayConfigured }, desktop: { present, configLibraryPath, activeConfigPath, gatewayConfigured } }`.
- **Provider-config layer** (`provider.mjs` + `desktop-config.mjs`) — pure read/merge functions for Claude Code `settings.json` and Claude Desktop `configLibrary/<id>.json`. No prompts, no I/O orchestration.
- **Merge layer** (`merge-settings.mjs`) — canonical JSON merge with the `__bizar_managed__: true` marker for Bizar-owned keys (`mcpServers`, `permissions`, `hooks`). Already enforced by `merge-settings.test.mjs`.
- **Wizard layer** (`wizard.mjs`) — explicit state machine: `idle → probing → needs-provider → needs-confirm → writing → done | cancelled | failed`. Each transition is a pure function over the wizard state; I/O lives at the edges (one call to `detect.mjs`, one call to `writeClaudeSettings` via the provisioner).
- **Orchestrator** (`index.mjs`) — owns pre/post-install side effects (force-clean, statusline, doctor). Wizard runs only in TTY + non-`--yes` mode.
- **Provisioner** (`cli/provision.mjs`) — single disk-touching module, called by the orchestrator and `install.sh`. The only place that writes `settings.json`, copies agents/skills/commands, etc.

### Why this split

- `merge-settings.test.mjs` is the canonical contract for `settings.json` shape. Extracting `merge-settings.mjs` makes the merge testable independently and stops `provision.mjs` from owning both merge logic and install orchestration.
- The `__bizar_managed__: true` marker distinguishes Bizar-installed MCP servers from operator-added ones. Without a marker, every update either overwrites operator servers (bad) or fails to refresh Bizar servers (also bad). Marker removal is opt-in via `bizar install --prune-managed`.
- The wizard is a pure state machine — every page maps to one state transition. This makes the wizard testable with custom input/output streams from `@clack/prompts` and lets the non-interactive `--yes` path use the same per-target install functions without going through the wizard.

## 2. Module decomposition

### New files

- `cli/install/detect.mjs`
  - `detectInstalledAgents({ env = process.env, fs = nodeFs } = {})` → `{ claudeCode, desktop, openkan }`
  - `findActiveDesktopConfigPath({ env, fs })` — Linux/macOS/Windows resolution via `~/.config/Claude-3p/configLibrary`, `~/Library/Application Support/Claude-3p/configLibrary`, `%LOCALAPPDATA%\Claude-3p\configLibrary`; reads `_meta.json` for `appliedId`
  - `commandOnPath(cmd)` — wraps `child_process.spawnSync('command', ['-v', cmd])` for Claude Code CLI detection
  - `readClaudeCodeSettingsPath({ env, fs })` — reuses `cli/config-paths.mjs#resolveClaudeConfigDir`
- `cli/install/desktop-config.mjs`
  - `readActiveDesktopConfig({ env, fs })` → returns parsed active config JSON
  - `mergeGatewayIntoDesktopConfig({ existing, inferenceProvider = 'gateway', baseUrl, apiKey, authScheme = 'bearer' })` → new config object that **preserves every other field** (`inferenceModels`, `toolSearchEnabled`, `coworkEgressAllowedHosts`, telemetry keys)
  - `backupActiveDesktopConfig({ path, fs, now })` → `<id>.json.bak-<unix-ms>` before any write
  - `detectManagedOverride({ env, fs })` → returns `true` if `/etc/claude-desktop/managed-settings.json` (Linux) or platform-managed location is non-empty; refuse to write if true unless caller passes `{ force: true }`
- `cli/install/wizard.mjs`
  - `runInstallWizard({ detected, env, fs, provider, desktop, provision, statuslineInstall, onCancel })` — top-level clack state machine
  - Pages: `intro → detection → targetSelect → claudeCodeConfig → desktopConfig → gateway → confirm → execute → outro`
  - Each page returns a typed `WizardState` patch; reducer combines them
- `cli/install/merge-settings.mjs`
  - `mergeSettings({ shipped, saved })` extracted from `cli/provision.mjs#writeClaudeSettings`
  - Owns the `__bizar_managed__: true` marker logic
- `cli/install/provider.mjs`
  - `providerSettingsPath(env)`, `readProviderSettings(path)`, `detectProviderConfiguration({ env, settings })` extracted from `interactive-setup.mjs`
  - Pure functions; no prompts

### Modified files

- `cli/install/index.mjs` — orchestrator routes:
  - TTY + no `--yes` → wizard
  - non-TTY or `--yes` → auto-detect mode (install into all detected targets without prompts; skip Claude Code CLI install)
  - update mode → skip wizard, run provision directly
  - force mode → wizard if TTY, else forceClean then auto-detect
- `cli/install/paths.mjs` — multi-target path card showing Claude Code dir AND Desktop configLibrary dir side-by-side
- `cli/install/banner.mjs` — keep chalk helpers; clack owns interactive visuals
- `cli/install/interactive-setup.mjs` — becomes a thin compat shim that re-exports `runInteractiveSetup` for existing tests
- `cli/provision.mjs`:
  - Extract `mergeSettings` to `cli/install/merge-settings.mjs` (keep `writeClaudeSettings` as a thin caller)
  - **`installClaudeCli()` becomes opt-in via the `installClaudeCli` option**: `runProvision(opts)` gains `{ installClaudeCli = false }` (default OFF); line 1190 becomes `if (opts.installClaudeCli) installClaudeCli({ force, dryRun });`. The wizard and `bizar install --install-claude-cli` propagate `installClaudeCli: true`; `install.sh --non-interactive` and `bizar install --yes` propagate `installClaudeCli: false`. The `cli/install/index.mjs` orchestrator reads the wizard/flag state and passes it through. The `cli/commands/install.mjs` parser reads `--install-claude-cli` and threads it to `runProvision`. [F2 resolution]
  - `runProvision` accepts new `targets` parameter (`['claude-code', 'claude-desktop']`); only writes to selected targets
- `cli/config-paths.mjs` — add `resolveDesktopConfigLibrary()` returning platform-correct path
- `cli/commands/install.mjs` — add `--targets=claude-code,claude-desktop` and `--install-claude-cli` flags; update help text
- `cli/commands/setup-provider.mjs` — wrap as a single-target gateway-only mode that defers to the wizard's gateway page
- `package.json` — add `@clack/prompts` (^1.0) as dependency
- `install.sh` — unchanged

### Deleted

- None. `interactive-setup.mjs` stays as a compat shim.

## 3. Detection algorithm

```js
function detectInstalledAgents({ env = process.env, fs = nodeFs } = {}) {
  const claudeCode = {
    present: false,
    binPath: null,
    configDir: resolveClaudeConfigDir({ env }),
    gatewayConfigured: false,
  };

  // Claude Code CLI on PATH
  const cliPath = commandOnPath('claude');
  if (cliPath) {
    claudeCode.present = true;
    claudeCode.binPath = cliPath;
  } else if (fs.existsSync(join(claudeCode.configDir, 'settings.json'))) {
    // Already-installed Claude Code users without CLI on PATH (rare; e.g. portable)
    claudeCode.present = true;
  }

  const settingsPath = join(claudeCode.configDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const detected = detectProviderConfiguration({ env, settings });
    claudeCode.gatewayConfigured = !!(detected.url && detected.key);
  }

  const desktop = {
    present: false,
    configLibraryPath: resolveDesktopConfigLibrary({ env }),
    activeConfigPath: null,
    activeConfigId: null,
    gatewayConfigured: false,
  };

  const metaPath = join(desktop.configLibraryPath, '_meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.appliedId && Array.isArray(meta.entries)) {
      const entry = meta.entries.find((e) => e.id === meta.appliedId);
      if (entry) {
        const activePath = join(desktop.configLibraryPath, `${meta.appliedId}.json`);
        if (fs.existsSync(activePath)) {
          desktop.present = true;
          desktop.activeConfigPath = activePath;
          desktop.activeConfigId = meta.appliedId;
          const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
          desktop.gatewayConfigured = active.inferenceProvider === 'gateway'
            && !!active.inferenceGatewayBaseUrl
            && !!active.inferenceGatewayApiKey;
        }
      }
    }
  }

  const openkan = {
    present: fs.existsSync(resolveOpenKanHome()),
    home: resolveOpenKanHome(),
  };

  return { claudeCode, desktop, openkan };
}
```

## 4. Desktop config merge strategy

```js
function mergeGatewayIntoDesktopConfig({ existing, inferenceProvider = 'gateway', baseUrl, apiKey, authScheme = 'bearer' }) {
  // NEVER touch: managed-source keys, coworkEgressAllowedHosts, toolSearchEnabled,
  // disableEssentialTelemetry, disableNonessentialTelemetry, inferenceModels, modelPrefer1mContext.
  // We also never inject anthropicFamilyTier on any model — Desktop rejects/ removes it for non-Anthropic models.

  // Preservation of existing gateway keys [F4 resolution]:
  // - If existing.inferenceGatewayBaseUrl/ApiKey/AuthScheme is already set AND the wizard did NOT
  //   collect explicit new values (i.e. the user accepted the existing gateway with the "Use
  //   currently configured gateway?" confirm), preserve them verbatim — do NOT overwrite.
  // - If the user explicitly entered new values in the wizard's gateway page, overwrite.
  const preserved = { ...existing };

  if (baseUrl !== undefined) preserved.inferenceGatewayBaseUrl = baseUrl;
  else preserved.inferenceGatewayBaseUrl = existing?.inferenceGatewayBaseUrl;

  if (apiKey !== undefined) preserved.inferenceGatewayApiKey = apiKey;
  else preserved.inferenceGatewayApiKey = existing?.inferenceGatewayApiKey;

  if (authScheme !== undefined) preserved.inferenceGatewayAuthScheme = authScheme;
  else preserved.inferenceGatewayAuthScheme = existing?.inferenceGatewayAuthScheme ?? 'bearer';

  preserved.inferenceProvider = inferenceProvider;

  return preserved;
}
```

Backup before write: `backupActiveDesktopConfig({ path })` writes `<id>.json.bak-<unix-ms>` in the same directory. On read-after-write, the installer verifies the file parses as valid JSON and contains the new `inferenceGatewayBaseUrl`; if not, it rolls back to the backup and exits non-zero.

Managed-source detection: `detectManagedOverride({ env, fs })` checks `/etc/claude-desktop/managed-settings.json` (Linux), `/Library/Application Support/Claude-3p/managed-settings.json` (macOS), and `%PROGRAMDATA%\Claude-3p\managed-settings.json` (Windows). If non-empty, `mergeGatewayIntoDesktopConfig` throws unless `{ force: true }` is passed; the wizard surfaces a `note(...)` explaining that the managed source wins and the user should change gateway config there instead.

## 5. Wizard state model

State machine: `idle → probing → [needs-provider | needs-desktop-config]? → needs-confirm → writing → done | cancelled | failed`.

Each transition is a typed state patch. The wizard consumes patches and applies them to the central state via a reducer.

Pages (in order; skipped if not applicable):

1. **intro** — `intro(...)` shows version + tagline; `note(...)` shows install target preview (paths)
2. **detection** — `spinner(...)` "Detecting installed agents…"; `note(...)` lists detected agents with check/cross marks; if zero detected, `outro(...)` with error and exit `failed`
3. **targetSelect** — `multiselect(...)` over detected agents; at least one required; `isCancel` → exit `cancelled`
4. **claudeCodeConfig** (only if claude-code selected and not present):
   - `confirm(...)` "Install Claude Code CLI? (default NO)" — opt-in
   - `path(...)` "Claude Code config dir?" default `~/.claude` (CLAUDE_CONFIG_DIR override)
   - `note(...)` showing what gets written (settings.json, agents/, skills/, commands/, hooks/)
5. **desktopConfig** (only if desktop selected):
   - `note(...)` showing detected Desktop configLibrary path + active config ID
   - `confirm(...)` "Use currently configured gateway?" — if yes, skip to confirm page; if no, prompt for URL + key
6. **gateway** (only if at least one target needs gateway and none detected):
   - `text(...)` URL with URL validation
   - `password(...)` key
7. **confirm** — `note(...)` plan-of-record (what goes where); `confirm(...)` "Proceed?"
8. **execute** — `tasks(...)` per-target with spinner for each; per-task success/failure summary
9. **outro** — `outro(...)` with summary table; for Desktop install, "Quit and reopen Claude Desktop" reminder

State transitions:

1. `idle → probing`: `intro(...)` then `spinner.start()`
2. `probing → needs-provider`: gateway not detected, Claude Code selected
3. `probing → needs-desktop-config`: gateway not detected, Desktop selected
4. `probing → needs-confirm`: both targets configured
5. `needs-provider → needs-confirm`: provider prompts answered
6. `needs-desktop-config → needs-confirm`: Desktop prompts answered
7. `needs-confirm → writing`: user confirms
8. `writing → done | failed`: calls injected `provision` with `{ mode, force: false, dryRun: false, yes: false, openkanHome, initializeOpenKanProject }`. The provision is the only place that touches disk.
9. `done | cancelled | failed`: terminal. The orchestrator decides whether to run `runStatuslineInstall` and `runDoctor`.

Cancellation handling: every page checks `isCancel(value)` and routes to the reducer's `cancelled` branch. `cancel('Installation cancelled')` exits with code 130 (SIGINT convention).

### Failed-state exit codes [F5 resolution]

| Trigger | Exit code | Wizard message |
|---|---|---|
| Detection finds zero agents | 2 | "No supported agent surfaces detected (Claude Code CLI, Claude Desktop). Run `bizar install` from a host with one of them installed." |
| `writeClaudeSettings` returns `{ ok: false }` | 3 | "Failed to write Claude Code settings. Run `bizar doctor` for diagnostics." |
| `mergeGatewayIntoDesktopConfig` rejects due to managed-source, user declines `--force-targets` | 130 (cancelled) | "Claude Desktop is managed by your organization. Re-run with `bizar install --force-targets desktop` to override." |
| `backupActiveDesktopConfig` succeeds but `mergeGatewayIntoDesktopConfig` write produces invalid JSON (partial-write crash simulated in tests) | 4 | "Desktop config write produced invalid JSON; restored from backup. Run `bizar doctor`." |
| Provisioner throws | 3 | "Install failed: `<error.message>`. Run `bizar doctor`." |
| User cancels at any prompt | 130 | "Installation cancelled." |

## 6. Backward compatibility matrix

| Surface | Change | Reason |
|---|---|---|
| `cli/install.mjs` re-export shim | Unchanged | External imports stable |
| `install.sh --non-interactive` | Unchanged | Routes to provision with `--yes` |
| `bizar install --yes` | Reads targets from `--targets` flag, defaults to detected-present | CLI parity |
| `bizar install --targets=claude-code,claude-desktop` | Multi-target selection | New flag |
| `bizar install --install-claude-cli` | Opt-in to Claude Code CLI native install | New flag (replaces auto-install) |
| `bizar install --force-targets <id>` | Force per-target write past managed-source refusal | New flag (managed-source override; documented in help) |
| `bizar install --force` | Kept; combined with `--targets` applies force on selected targets | Stays a clean-install flag |
| `bizar install` (no flags, TTY) | Wizard | New default |
| `bizar install` (no flags, no TTY) | Non-interactive auto-detect | New default |
| `installClaudeCli()` | Default OFF; only via wizard opt-in or `--install-claude-cli` | User request |
| `bizar update` | Wizard SKIPPED; routes through auto-detect mode regardless of TTY. Reasons: update is a refresh operation; user already accepted the wizard contract on first install. [F6 resolution] | Stays a thin re-run of provision |
| `merge-settings.test.mjs` | Unchanged (hard gate) | Canonical settings-merge contract |
| Existing installer tests | Updated only with explicit rationale | See §7 |
| Managed-source refusal UX | Wizard surfaces: "Claude Desktop is managed by your organization. Use `bizar install --force-targets desktop` to override." | T1 resolution |
| Single-target orchestrator | When `targets` excludes `claude-code`, orchestrator skips writeClaudeSettings, syncAgentFiles, syncSkillFiles, syncCommandFiles, syncHookFiles, syncRulesFiles, setupMcpServer, installClaudeCli. OpenKan + CLAUDE.md mirror runs unchanged (Bizar-side state, not Claude-side). | T3 resolution |
| Worktree discipline | Each commit dispatched via `Agent({ isolation: "worktree" })` from the office-manager; sequencer merges with `bizar worktree-merge --all` per AGENTS.md; branches named `wt/<agent_type>-<short-task-id>` | T4 resolution |

## 7. Test strategy

Three categories:

### Unit tests (new)

- `cli/install/detect.test.mjs`
  - Fixture: temp configLibrary with `_meta.json` + active `<id>.json`
  - Verifies `_meta.json` pointer resolution
  - Verifies macOS/Linux/Windows path branches via env override
  - Verifies Claude Code detection via mock `commandOnPath`
- `cli/install/desktop-config.test.mjs`
  - Verifies merge preserves `inferenceModels` verbatim (no `anthropicFamilyTier` injection)
  - Verifies merge preserves `coworkEgressAllowedHosts`, `toolSearchEnabled`, telemetry keys
  - Verifies managed-source detection refuses write unless `force: true`
  - Verifies backup is written before any modification
  - Verifies roll-back on write failure
  - Verifies roll-back on partial-write / truncated-buffer crash: simulate a write that returns success but produces invalid JSON; assert the helper restores from the `.bak-<unix-ms>` sibling [T5 resolution]

### Wizard tests (new)

- `cli/install/wizard.test.mjs`
  - Uses `@clack/prompts` custom `input`/`output` streams (`Readable.from([...answers])` + `Writable` that drops chunks)
  - Cases:
    - Detect-zero: zero agents detected → exit `failed`
    - Single-target (Claude Code only): selects → no Desktop prompts
    - Multi-target (Claude Code + Desktop): selects → sees both gateway prompts
    - Cancel mid-flow: cancel signal → exit `cancelled` with exit code 130
    - Managed-source refusal: managed-source detected → refuses Desktop write unless forced
    - No Claude Code CLI install default: Claude Code already installed → no `installClaudeCli()` invocation

### Existing tests

Must pass without modification OR with documented rationale for any update.

Per-test disposition for commit 3 (the merge-settings extraction):

| Test file | Disposition | Rationale |
|---|---|---|
| `cli/install/__tests__/merge-settings.test.mjs` | Unchanged (hard gate) | The test imports `mergeSettings` from `cli/provision.mjs`; commit 3 keeps that export as a thin re-export from `cli/install/merge-settings.mjs` so the import path resolves identically |
| `cli/install/interactive-setup.test.mjs` | Migrated | The readline-based prompt contract is replaced by the clack wizard; the test is rewritten to assert `interactive-setup.mjs` re-exports `runInteractiveSetup` from `wizard.mjs` for back-compat (T2 resolution) |
| `cli/install/index.test.mjs` | Unchanged at signature level; new cases added | Existing tests assert `runInstaller({ mode, dryRun, force, yes, ... })` routes; the new tests add wizard-mode coverage |
| `cli/install/force-clean.test.mjs` | Unchanged | `forceCleanInstall` is unchanged in behavior |
| `cli/install/paths.test.mjs` | Migrated (additive) | `PATHS` shape gains `desktopConfigLibrary`, `desktopActiveConfig`; existing assertions stay green |
| `cli/install/banner.test.mjs` | Unchanged | `showBanner`, `sectionHeading`, `palette` are unchanged |
| `cli/install/prune.test.mjs` | Unchanged | Prune logic is untouched |
| `cli/install/update-wrapper.test.mjs` | Unchanged | Update code path stays the same |
| `cli/commands/setup-provider.test.mjs` | Migrated | Becomes a thin wrapper that defers to the wizard's gateway page |
| `cli/commands/__tests__/update-help-contract.test.mjs` | Unchanged at message level; new flags added | The `--help` message gains `--targets`, `--install-claude-cli`, `--force-targets` |

Coverage: ≥90% lines/branches on `detect.mjs`, `desktop-config.mjs`, `wizard.mjs`, `merge-settings.mjs`.

Test commands:
- Targeted: `node scripts/run-node-tests.mjs --grep "cli/install/"`
- Full: `make check`
- E2E: `make e2e` via `@kevin` sandbox — verifies `bizar install` clean-install + idempotent re-install

## 8. OpenKan task structure

Propose tasks for `.ok/`:

- `task-installer-detect-module` — `cli/install/detect.mjs` + `detect.test.mjs` + `cli/config-paths.mjs` Desktop resolver. Verification: `node scripts/run-node-tests.mjs --grep detect`.
- `task-installer-provider-extract` — extract `provider.mjs` + `merge-settings.mjs` from `provision.mjs` and `interactive-setup.mjs`. Existing `merge-settings.test.mjs` keeps passing. Verification: `make check` + targeted merge-settings tests.
- `task-installer-desktop-merge` — `cli/install/desktop-config.mjs` + `desktop-config.test.mjs`. Verification: targeted desktop-config tests; backup-and-rollback path exercised.
- `task-installer-wizard` — `cli/install/wizard.mjs` using `@clack/prompts` + `wizard.test.mjs`. Verification: wizard tests cover all state transitions and cancel paths.
- `task-installer-orchestrator-update` — `cli/install/index.mjs` routing; `cli/provision.mjs` `installClaudeCli()` opt-in; `cli/commands/install.mjs` new flags. Verification: full test suite + manual `bizar install` in TTY and non-TTY.
- `task-installer-test-coverage-and-docs` — coverage report ≥90% on new modules; `install.sh` help text updated; `docs/architecture.md` updated; release notes.

Dependency graph (sequential): `detect` → `provider-extract` → `desktop-merge` → `wizard` → `orchestrator-update` → `test-coverage-and-docs`.

## 9. Migration / commit sequence

Atomic commits per AGENTS.md. Each commit runs `make check` + targeted tests before push.

1. `chore(deps): add @clack/prompts ^1.0` — `package.json` + lockfile
2. `feat(install): add desktop detection module (detect.mjs, config-paths resolver)` — new files + tests
3. `feat(install): extract merge-settings and provider modules from provision.mjs and interactive-setup.mjs` — refactor; `merge-settings.test.mjs` keeps passing; rewrite `cli/install/interactive-setup.test.mjs` against the new `provider.mjs` shim (the readline contract is replaced by clack streams; old tests would otherwise drift) [T2 resolution]
4. `feat(install): add desktop-config module (merge + backup + managed-source detection)` — new files + tests
5. `feat(install): add clack-based wizard (wizard.mjs) with state machine` — new files + tests
6. `feat(install): installClaudeCli opt-in default` [F7 resolution — split from commit 6b so the behavior flip is reversible without touching the wizard]: adds the `installClaudeCli` option to `runProvision`, gates line 1190, propagates `installClaudeCli: false` from `install.sh --non-interactive` and `bizar install --yes` paths.
7. `feat(install): orchestrator uses clack wizard; --targets and --install-claude-cli flags` [F7 resolution — commit 6b]: wires the wizard, adds CLI flags, threads `targets` through orchestrator.
8. `docs(install): update architecture.md, help text, and CHANGELOG`
9. `chore(release): bump version to v10.30.0`

Hard gate: if `merge-settings.test.mjs` fails on commit 3, roll back, re-plan, do not fix forward.

## 10. Risks and tensions

- **Risk**: `install.sh --non-interactive` doesn't have TTY; wizard must short-circuit.
  - **Mitigation**: detect `!process.stdin.isTTY` and run auto-detect mode (no prompts, install into all detected targets without Claude Code CLI install).
- **Risk**: User has managed-source overrides on Desktop config; install must not silently overwrite.
  - **Mitigation**: detect + warn + skip Desktop target if managed sources present, unless explicitly forced via `bizar install --force-targets desktop`.
- **Risk**: `_meta.json` could be missing or malformed.
  - **Mitigation**: validate pointer file; if invalid, surface error and exit (do not guess).
- **Risk**: `installClaudeCli()` removal breaks backward compat for users who relied on auto-install.
  - **Mitigation**: opt-in via `--install-claude-cli` flag and wizard selection; document in CHANGELOG; provide `bizar install --install-claude-cli` as the new path.
- **Risk**: Existing tests mock the old readline-based interactive setup; they need updates.
  - **Mitigation**: keep `interactive-setup.mjs` as a thin wrapper for backwards-compatible tests, route new wizard calls through it OR update tests with explicit rationale.
- **Tension**: Wizard UX vs automation. The non-interactive `--yes` path must remain deterministic.
  - **Resolution**: parallel code paths that converge on the same per-target install functions (`provision.mjs`).
- **Tension**: "Don't hardcode gateway" vs "make Desktop install work out of the box".
  - **Resolution**: detection reads existing config first; if not configured, prompt — never assume.
- **Tension**: One wizard vs per-target wizards.
  - **Resolution**: ONE wizard, multiple targets, branched pages. Per-target install functions stay separate so each target's installer is independently testable.
- **Tension**: Preserving `inferenceModels` verbatim vs harmonizing provider IDs across surfaces.
  - **Resolution**: never rewrite models; the user is the source of truth on which gateway models are available. If the gateway is OmniRoute and the user has MiniMax M3, that's their model picker, not ours.
- **Tension**: `__bizar_managed__: true` marker is a public contract.
  - **Resolution**: documented in `docs/architecture.md`; removal is opt-in via `bizar install --prune-managed`.

## 11. Acceptance criteria (DoD)

- User can run `bizar install` in a TTY and see a sectioned clack wizard with intro / outro / spinner / per-page prompts
- User can multi-select Claude Code + Claude Desktop from detected agents
- Installer reads user's existing Desktop configLibrary and reuses gateway URL/key
- Installer NEVER silently overwrites `inferenceModels` or injects `anthropicFamilyTier`
- Installer NEVER auto-installs Claude Code CLI by default
- `install.sh --non-interactive` continues to work without changes
- All existing tests pass; new tests cover detection, desktop-config merge, wizard state transitions
- `make check`, `make verify-repo-structure`, `make verify-removed-surfaces`, `make e2e` pass
- Coverage ≥90% on new modules
- One logical commit per concern (9 commits total per §9)
- OpenKan tasks track progress; tasks complete only with verification evidence

## 12. Stop condition

The plan is "done" when:

1. All nine commits in §9 land on `master` (or the worktree's branch) with green CI.
2. OpenKan tasks `task-installer-detect-module` through `task-installer-test-coverage-and-docs` are marked `complete` with verification evidence.
3. `bizar install` in a fresh TTY shell produces a visible clack wizard with sections / pages.
4. `bizar install --yes` (non-TTY) installs into all detected targets without prompting.
5. The user's Claude Desktop config (`configLibrary/<id>.json`) is unchanged after install IF the gateway was already configured (we only write when the user opts into gateway config in the wizard).
6. `@linda` (`RALPLAN-Critic`) emits `APPROVED` against this plan.

Beyond that, the run advances to `execute` (T1 → T6 dispatched in order) and then `qa`. The workflow stops here at the planning gate.
