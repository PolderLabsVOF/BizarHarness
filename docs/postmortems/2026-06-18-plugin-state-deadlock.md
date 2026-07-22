# Postmortem: BizarHarness Startup Hang + Send-Message Deadlock

**Date:** 2026-06-18
**Severity:** Critical (total loss of functionality)
**Status:** Resolved
**Duration:** Multiple layered fixes required to fully recover

---

## Summary

Cline failed to render on startup, then became unable to commit any user message to the conversation database — prompts appeared in the prompt history log but no rows were written to the SQLite store. Six distinct layers of misconfiguration and a re-entrant mutex combined to produce a fully broken state.

---

## Impact

- **Blank startup screen.** Cline initialized the Bizar plugin but the plugin never resolved its `init()` promise, blocking the UI render pipeline entirely.
- **Zero message persistence.** After startup was manually progressed, every `chat.message` submission deadlocked on a per-session mutex inside `state.ts`. Prompts were appended to `~/.local/state/cline/prompt-history.jsonl` but never committed to `~/.local/share/cline/cline.db`.
- **No model execution reached.** The deadlock occurred before the message could be stored, so no agent was ever invoked.
- **Hindsight MCP key not persisted.** The Hindsight API key was absent from all shell startup paths, causing Hindsight MCP tools to fail silently on every new shell session.

---

## Timeline

| Time | Event |
|------|-------|
| Day N | `~/.config/cline/plugins/bizar/index.ts` added `client.session.list()` during stale-session cleanup — no timeout wrapper. |
| Day N | `~/.config/cline/cline.json` and `~/.cline/cline.json` updated to model `minimax/MiniMax-M3`, small_model `minimax/MiniMax-M2.7`, default_agent `pam`, with `supabase.enabled = false`, `hindsight.enabled = false`, MCP permissions switched from `ask` to `deny`. |
| Day N | `~/.config/environment.d/90-hindsight.conf` created for environment-variable persistence. Loaders added to `~/.bashrc`, `~/.profile`, and `~/.config/fish/conf.d/90-hindsight.fish`. `cline.json` updated with a direct bearer token fallback. |
| Day N | `~/Projects/BizarHarness/config/cline.json` (project-local override) was still forcing `default_agent: mike`, `model: cline/deepseek-v4-flash-free`, and re-enabling the broken MCPs. |
| Day N | Agent definition files for `pam`, `susan`, `janet`, `greg`, `brenda` still had `model: cline/deepseek-v4-flash-free` pinned inside each YAML frontmatter. |
| Day N | `plugins/bizar/src/state.ts` introduced a re-entrant per-session mutex. `chat.message` hook calls `stateStore.withLock(sessionID, ...)` → inside that closure, `load()` and `save()` each independently call `withLock(sessionID, ...)` again → **self-deadlock on first message submit**. |
| 2026-06-18 | User observes blank screen on Cline launch. |
| 2026-06-18 | User bypasses startup block manually, submits a message — UI freezes, no response. |
| 2026-06-18 | User inspects `prompt-history.jsonl` (prompts present) vs `cline.db` (no rows) — concludes message storage is failing. |
| 2026-06-18 | Six-layer fix applied (see Resolution). Cline recovers. |

---

## Detection

**Startup hang:** The blank screen was reported directly by the user. The blocking call was `client.session.list()` inside `index.ts` during plugin initialization with no timeout guard — if the session list call blocked or took longer than the plugin init timeout budget, `init()` never resolved and the UI pipeline stalled.

**Send-message deadlock:** The key evidence was in two files:
- **`~/.local/state/cline/prompt-history.jsonl`** — contained entries for submitted prompts, confirming the hook fired and the LLM was invoked.
- **`~/.local/share/cline/cline.db`** — zero rows in any message table, confirming `stateStore.save()` was never reached.

The deadlock was identified by tracing the `chat.message` hook through `stateStore.withLock()` into `load()` and `save()`, both of which independently re-acquired the same per-session mutex.

---

## Root Cause Analysis

### Layer 1 — Startup Hang (index.ts)

```
init()
└── staleSessionCleanup()
    └── client.session.list()         ← no timeout, no fallback
```

`client.session.list()` is an RPC call that can block indefinitely if the session store is unresponsive. Without a timeout or fallback, the `init()` promise never resolves. The UI stalls on a blank screen.

**Fix:** Wrapped in `Promise.race(...)` with a 1-second fallback that returns an empty list.

### Layer 6 (Critical) — Re-entrant Send-Message Deadlock (state.ts)

The `StateStore` class in `plugins/bizar/src/state.ts` implements a per-session mutex using a `Map<string, Promise<void>>`:

```typescript
async withLock<T>(sessionID: string, fn: () => Promise<T>): Promise<T> {
  while (this.locks.has(sessionID)) {
    await this.locks.get(sessionID);
  }
  const release = (async () => {
    try {
      return await fn();
    } finally {
      this.locks.delete(sessionID);
    }
  })();
  this.locks.set(sessionID, release);
  return release;
}
```

**The bug:** `withLock` waits for the previous lock to clear, then stores the *entire wrapped promise* as the lock value. `load()`, `save()`, and `delete()` are themselves public async methods that independently call `withLock`:

```
chat.message (hook)
└── stateStore.withLock(sessionID, async () => {
      const state = await stateStore.load(sessionID);   ← re-entrant call
      // ...
      await stateStore.save(sessionID, newState);       ← re-entrant call
    })
```

**Call chain showing the self-deadlock:**

```
chat.message hook
└── stateStore.withLock("session-abc", async () => {
      // Lock acquired: locks.get("session-abc") = promise-P

      const state = await stateStore.load("session-abc");
      // load() calls withLock("session-abc", ...)
      // → while (locks.has("session-abc"))  ← TRUE (promise-P still stored)
      // → await promise-P                  ← DEADLOCK: waits for itself
    })
```

`save()` has the identical problem. The mutex is **re-entrant by design at the wrong granularity** — the outer `withLock` stores the wrapped promise itself as the lock holder, and inner calls see that same promise as a held lock.

**Why it wasn't caught earlier:** The deadlock only fires on the *first* message submit per session, when `load()` is called on a session that has never been persisted. Unit tests with synthetic session IDs in isolated calls would not exercise the re-entrant path.

**Fix:** Removed nested locking from `load()`, `save()`, and `delete()`. These methods perform direct file I/O with no shared mutable state beyond the file system — file-level locking or atomic rename (write-to-temp, then rename) is the correct isolation boundary. The outer `withLock` in the hook remains to serialize concurrent accesses to the same session state.

---

## Resolution

All files changed to recover the system, grouped by layer.

### Layer 1 — Startup Timeout Guard

| File | Change |
|------|--------|
| `~/.config/cline/plugins/bizar/index.ts` | Wrapped `client.session.list()` in `Promise.race(..., 1000)` with a 1s fallback returning `[]` |

### Layer 2 — Hindsight MCP Key Persistence

| File | Change |
|------|--------|
| `~/.config/environment.d/90-hindsight.conf` | Created; exports `HINDSIGHT_API_KEY` and `HINDSIGHT_BANK_ID` |
| `~/.bashrc` | Added Hindsight loader sourcing |
| `~/.profile` | Added Hindsight loader sourcing |
| `~/.config/fish/conf.d/90-hindsight.fish` | Created; fish-compatible Hindsight loader |
| `~/.config/cline/cline.json` | Added `hindsight.bearerToken` fallback field |

### Layer 3 — Cline Global Config Normalization

| File | Change |
|------|--------|
| `~/.cline/cline.json` | Reset to model `minimax/MiniMax-M3`, small_model `minimax/MiniMax-M2.7`, default_agent `pam`, `supabase.enabled: false`, `hindsight.enabled: false`, MCP permissions `deny` |
| `~/.config/cline/cline.json` | Same reset as above |

### Layer 4 — Project-Local Config Override

| File | Change |
|------|--------|
| `~/Projects/BizarHarness/config/cline.json` | Removed `default_agent: mike`, removed `model: cline/deepseek-v4-flash-free`, re-aligned MCP enable flags to match global baseline |

### Layer 5 — Interactive Agent Model Rerouting

| File | Change |
|------|--------|
| `config/agents/pam.md` | Changed YAML `model` from `cline/deepseek-v4-flash-free` to `minimax/MiniMax-M2.7` |
| `config/agents/susan.md` | Same change |
| `config/agents/janet.md` | Same change |
| `config/agents/greg.md` | Same change |
| `config/agents/brenda.md` | Same change |

### Layer 6 — Re-entrant Mutex Removal (Core Fix)

| File | Change |
|------|--------|
| `plugins/bizar/src/state.ts` | Removed `withLock()` calls from inside `load()`, `save()`, and `delete()`. These methods now perform direct file I/O without holding a session lock. The outer `withLock()` in the hook caller provides serialization for the session. |

---

## Action Items / Lessons Learned

### 1. Per-session mutexes must be strictly non-reentrant by default

A mutex that stores the wrapped promise as its own held-lock value will self-deadlock on any public method that:
(a) is called while the outer lock is held, AND
(b) independently calls `withLock()` for the same session ID.

**Rule:** A session-scoped lock must only be held by one outer call site (the hook handler). All I/O methods inside `state.ts` should be *lock-free internally* — file system operations are atomic at the rename level, and concurrent writes to different session files are already isolated by file path.

### 2. Project-local config overrides must be kept in sync with global config

`~/Projects/BizarHarness/config/cline.json` was overriding `default_agent`, `model`, and MCP flags in ways that conflicted with the global config. Project-level overrides are powerful but become a second source of truth that can silently re-enable broken features after a global cleanup.

**Rule:** After any global config normalization, immediately audit all project-level overrides. Consider making project config strictly additive (only fields the project actually needs to override) rather than a full copy that can drift.

### 3. Agent definitions must not pin a specific provider/model when the system relies on tier-routed defaults

The five agent files had `model: cline/deepseek-v4-flash-free` hard-coded in YAML frontmatter. This bypasses Odin's tier-routing entirely and forces a free-tier model regardless of the task complexity the routing table was designed to dispatch.

**Rule:** Agent definitions in `config/agents/` should omit `model` entirely, or set it to a tier placeholder (`$DEFAULT_MODEL`) that the routing layer resolves at runtime. Explicit model overrides at the agent level are only appropriate when the agent's task is provably confined to a specific model's capability window.

### 4. Async cleanup paths need explicit timeouts to avoid blocking init

`client.session.list()` in the plugin `init()` path had no timeout. If the session store is slow, busy, or in a broken state, the init promise hangs forever and the entire UI is blocked.

**Rule:** All async calls during plugin initialization, hook registration, and lifecycle cleanup must be wrapped in `Promise.race(..., timeoutMs)` with a defined fallback. The fallback should always resolve — return `[]`, `null`, or the last known good state — so the system can boot in a degraded but functional mode.

---

## File Reference Table

### Cline Runtime / User Config

| Path | Purpose |
|------|---------|
| `~/.cline/cline.json` | User-level Cline config (global baseline) |
| `~/.config/cline/cline.json` | XDG-compliant Cline config (global baseline) |
| `~/.config/cline/plugins/bizar/index.ts` | Bizar plugin entry point; had blocking `client.session.list()` call |
| `~/.config/environment.d/90-hindsight.conf` | Environment variable persistence for Hindsight credentials |

### Environment / Shell Startup

| Path | Purpose |
|------|---------|
| `~/.bashrc` | Bash interactive shell init; added Hindsight loader |
| `~/.profile` | XDG-compatible login shell init; added Hindsight loader |
| `~/.config/fish/conf.d/90-hindsight.fish` | Fish shell init; added Hindsight loader |

### BizarHarness Project Config

| Path | Purpose |
|------|---------|
| `~/Projects/BizarHarness/config/cline.json` | Project-local Cline override; was re-enabling broken models and MCPs |
| `config/agents/pam.md` | Quick agent definition; had hard-coded free-tier model |
| `config/agents/susan.md` | Frigg agent definition; same |
| `config/agents/janet.md` | Vör agent definition; same |
| `config/agents/greg.md` | Mimir agent definition; same |
| `config/agents/brenda.md` | Heimdall agent definition; same |

### BizarHarness Plugin Source

| Path | Purpose |
|------|---------|
| `plugins/bizar/src/state.ts` | Session state store; contained re-entrant per-session mutex |

### Evidence Locations

| Path | Purpose |
|------|---------|
| `~/.local/state/cline/prompt-history.jsonl` | Prompt history log; confirmed prompts were submitted |
| `~/.local/share/cline/cline.db` | Cline SQLite store; confirmed zero message rows committed |

---

## Convention Note

This is the first postmortem in the project. No `docs/postmortems/` directory existed. The file has been created at `docs/postmortems/2026-06-18-plugin-state-deadlock.md`. Future incidents should follow this structure. The `docs/` directory was chosen over `wiki/` to distinguish formal incident reports (which may contain sensitive system details) from the user-facing operational documentation in `wiki/`.
