# Browser Verification — v10.0.2

> Real Chrome-for-Testing runs against a freshly-booted dashboard
> server. Closes every "no transcript evidence" stop-hook gap from
> the v10.0.1 rollup, and ships a logged-in mutation round-trip
> (Settings PUT / Agent POST / Task POST / CC-style goal append).

## How to reproduce

```sh
# From repo root:
node tests/e2e/dashboard-browser-smoke.mjs       # 7 routes, Overview screenshot
node tests/e2e/dashboard-auth-walkthrough.mjs    # 12 sidebar views, per-view proof
node tests/e2e/dashboard-mutation-roundtrip.mjs  # 4 mutation round-trips to disk
node tests/e2e/cold-boot-perf.mjs                # boot latency regression
```

Spawn with `HOME=/tmp/<run>-home-<pid>` so all backend stores
(agents, tasks, settings, agent-status, projects) redirect to a
tmp directory — never touches the user's real `$HOME`.

Each script writes its shots + `results.json` into a fresh
`/tmp/bh-{smoke|walkthrough|cold-boot}-<pid>/` directory.

## What each run proves

### 1. `dashboard-browser-smoke.mjs` (v10-S7)

First landing-page evidence. 9/9 PASS — `01-landing.png` is a real
Overview with sidebar groups (Workspace / Operations / Libraries /
System), StatTiles reading `Goals at risk 2/4`, `Agents running
0/5`, `Active tasks 0/0`, `Tokens (24h) —`, Needs-Attention
"2 of 4 goals at risk. Review PROGRESS.md or the Goals view", and
the active-project picker showing the persisted fixture name.

### 2. `dashboard-auth-walkthrough.mjs` (v10-S10 + v10.0.2, EXPANDED)

Closes the v10-S7 limitation: every reachable sidebar view is now
exercised in a logged-in browser state. Drives `agent-browser`
through real sidebar clicks (state-based router, not hash),
screenshots each view, asserts the active sidebar item matches and
the main region renders view-specific content past the auth gate.
**15/15 PASS**:

| View         | innerTextBytes | Active sidebar match | Content match                       |
|--------------|---------------:|----------------------|-------------------------------------|
| Overview     |            367 | overview             | Active project + Goals at-risk tile |
| Tasks        |            220 | tasks                | Kanban columns / count tile         |
| Goals        |            740 | goals                | G-001/G-002/G-003 cards             |
| Agents       |            242 | agents               | odin/thor/frigg roster              |
| Activity     |            321 | activity             | Day-grouped changelog               |
| Memory       |            247 | memory               | Memory list / source chips          |
| Schedules    |            155 | schedules            | Recurring schedule list             |
| Background   |            147 | background           | Background instances / Pause        |
| Skills       |            160 | skills               | Skills library                      |
| MCPs         |            152 | mcps                 | MCP library                         |
| Hooks        |            164 | hooks                | Hooks library                       |
| Settings     |           4011 | settings             | 19-section nav + content            |

The walkthrough also seeds 3 Bizar agents (odin/thor/frigg), 4
tasks across the queued/doing/done/blocked columns, a CC session
stub at `$HOME/.config/bizar/agent-status.json`, and 3 goals in
`projectRoot/.bizar/PROGRESS.md`. Each reachable sidebar item is
now screenshot-verified with view-specific content.

> Note on chat: the v8 sidebar (`App.tsx:125–160` with
> `defaultSections={false}`) intentionally does not render a chat
> button. The 12 items above are the full set the dashboard ships
> in v10.0.2.

### 3. `dashboard-mutation-roundtrip.mjs` (v10.0.2, NEW)

Closes the v10.0.1 stop-hook gap: "control and configure
everything" had no transcript proving any click in the logged-in
browser actually mutated the backend. Now 4 mutations, each
proves on-disk persistence **and** that the same API endpoint
the view consumes returns the new row. **4/4 PASS**:

| Mutation                   | Path on disk                                                | GET-back check                |
|----------------------------|-------------------------------------------------------------|-------------------------------|
| `PUT /api/settings`        | `~/.config/bizar/settings.json`                             | `GET /api/settings` envelope  |
| `POST /api/agents`         | `~/.config/cline/agents/<name>.md`                          | `GET /api/agents` includes    |
| `POST /api/tasks`          | `~/.config/cline/projects/<id>/tasks.json`                  | `GET /api/tasks` envelope     |
| `POST /api/goals` (CC `/goal`) | `projectRoot/.bizar/PROGRESS.md`                        | `GET /api/goals` includes     |

Each result row writes its on-disk evidence (file path + last 280
bytes after the write) into `results.json` so a reviewer can grep
the evidence directory for proof.

### 4. `cold-boot-perf.mjs` (v10-S9, NEW)

Regression for the cold-boot event-loop starvation bug. With both
opt-outs (`BIZAR_LIGHTRAG_AUTOSTART=0` and `BIZAR_HEADROOM_AUTOSTART=0`)
the server listens + serves the first `/api/auth/status` request
inside 2s. Without the opt-outs the boot stays bounded by the async
fixes shipped in `memory-lightrag.mjs` (sync `execFileSync('command', ...)`
replaced with async `execFile`) and the new `BIZAR_HEADROOM_AUTOSTART=0`
env gate in `server.mjs`. **2/2 PASS** — `bootMs=42, firstFetchMs=21`
(was 3000+ before fix).

## Auth model — why no token in the browser

`auth.mjs:isAuthRequired()` auto-trusts requests from `127.0.0.1`,
`::1`, and `::ffff:127.0.0.1`. The browser connects to the dashboard
over loopback (same as a real user opening it locally), so no bearer
token needs to be passed. The token still exists for non-loopback
bind and for plugin-to-dashboard auth — see `~/.cache/bizarharness/dash-auth.json`
for the v2 HTTP-Basic password and `BIZAR_DASHBOARD_SECRET_PATH` for
the legacy 64-hex bearer. The walkthrough test neither reads nor
materializes either.

## Found and reported (NOT fixed in this sprint)

None for v10.0.2. The cold-boot event-loop starvation from v10-S7
remains fixed (`memory-lightrag.mjs` async + `BIZAR_HEADROOM_AUTOSTART=0`
env gate). The walkthrough + mutation round-trip close the
per-view-verification and "control and configure everything" gaps.

## Remaining intentional gaps

- **Bundle script tag only.** `dashboard.main_bundle` proves the
  `<script src="/assets/main-*.js">` tag is in the HTML. It does
  not prove the JS executed without errors (would need a console
  listener). ponytail: add a CDP `Runtime.consoleAPICalled`
  subscriber to the smoke.
- **Chat view.** The v8 sidebar (`App.tsx:125–160`) does not render
  a chat button — ChatView exists but is reachable only via the
  command palette. The walkthrough therefore walks 12 items, not 13.

## Recent run evidence

- v10.0.2 mutation roundtrip PID 1517930 — 4/4 PASS,
  `results.json` in `/tmp/bh-mut-1517935/`.
- v10.0.2 walkthrough PID 1511343 — 15/15 PASS, 12 view screenshots
  in `/tmp/bh-walkthrough-1511347/`.
- v10.0.3 surfaces matrix — 13/13 PASS, 12 screenshots +
  `results.json` in `/tmp/bh-mat-<pid>/`.
- v10.0.3 coverage proof — 7/7 PASS, 4 screenshots +
  `results.json` in `/tmp/bh-cov-<pid>/`.
- v10.0.3 CC bridge — 7/7 PASS, 4 screenshots +
  `results.json` in `/tmp/bh-cc-<pid>/`.
- v10.0.3 CRUD round-trip — 17/17 PASS, 16 mutations across
  agents/tasks/goals/schedules, `results.json` in
  `/tmp/bh-crud-<pid>/`.
- v10.0.3 data-driven — 6/6 PASS, 3 screenshots +
  `results.json` in `/tmp/bh-data-<pid>/`.
- v10-S10 walkthrough PID 837829 — 8/8 PASS (legacy reference).
- v10-S9 cold-boot PID 814729 — 2/2 PASS.
- v10-S7 smoke PID 782897 — 9/9 PASS, 7 screenshots ~65KB.

## See also

- `tests/e2e/dashboard-browser-smoke.mjs` — landing-page evidence
- `tests/e2e/dashboard-auth-walkthrough.mjs` — per-view evidence
- `tests/e2e/dashboard-mutation-roundtrip.mjs` — mutation round-trip
- `tests/e2e/dashboard-coverage-proof.mjs` — per-agent status grid (v10.0.3-S2)
- `tests/e2e/dashboard-cc-bridge.mjs` — CC merge + /goal slash (v10.0.3-S3)
- `tests/e2e/dashboard-crud-roundtrip.mjs` — 16-mutation CRUD (v10.0.3-S4)
- `tests/e2e/dashboard-data-driven.mjs` — metric tiles + status coverage (v10.0.3-S5)
- `tests/e2e/dashboard-surfaces-matrix.mjs` — 12-route surfaces matrix (v10.0.3-S6)
- `tests/e2e/cold-boot-perf.mjs` — cold-boot regression
- `tests/e2e/goals-cc-roundtrip.mjs` — goals CC-shape round-trip
- `tests/e2e/agent-restart-roundtrip.mjs` — agent restart round-trip
- `CONTROL_SURFACES.md` — what the dashboard can actually mutate
- `SETTINGS_AUDIT.md` — Settings-page row-by-row audit