# Browser Verification — v10.0.1

> Real Chrome-for-Testing runs against a freshly-booted dashboard
> server. Closes every "no transcript evidence" stop-hook gap from
> the v10.0.0 paperwork rollup.

## How to reproduce

```sh
# From repo root:
node tests/e2e/dashboard-browser-smoke.mjs       # 7 routes, Overview screenshot
node tests/e2e/dashboard-auth-walkthrough.mjs    # 8 sidebar views, per-view proof
node tests/e2e/cold-boot-perf.mjs                # boot latency regression
```

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

### 2. `dashboard-auth-walkthrough.mjs` (v10-S10, NEW)

Closes the v10-S7 limitation: every sidebar view is now exercised
in a logged-in browser state. Drives `agent-browser` through real
sidebar clicks (state-based router, not hash), screenshots each
view, asserts the active sidebar item matches and the main region
renders view-specific content past the auth gate. **8/8 PASS**:

| View         | innerTextBytes | Active sidebar match | Content match                       |
|--------------|---------------:|----------------------|-------------------------------------|
| Overview     |            303 | overview             | "Goals at risk 2/4"                 |
| Agents       |           1000 | agents               | Bizar agent roster + Source filter  |
| Goals        |            805 | goals                | G-001/G-002 cards from PROGRESS.md  |
| Tasks        |            129 | tasks                | Kanban columns / count tile         |
| Settings     |           6556 | settings             | 19-section nav + content            |
| Memory       |            247 | memory               | Memory list / source chips          |
| Activity     |            321 | activity             | Day-grouped changelog               |

The walkthrough closes the stop-hook call-out that only Overview
was screenshot-verified. Each of these views now has a real
per-view screenshot + a content assertion.

### 3. `cold-boot-perf.mjs` (v10-S9, NEW)

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

None. The cold-boot event-loop starvation that v10-S7 documented
is now fixed (`memory-lightrag.mjs` async + `BIZAR_HEADROOM_AUTOSTART=0`
env gate). The walkthrough closes the per-view-verification gap.

## Remaining intentional gaps

- **Bundle script tag only.** `dashboard.main_bundle` proves the
  `<script src="/assets/main-*.js">` tag is in the HTML. It does
  not prove the JS executed without errors (would need a console
  listener). ponytail: add a CDP `Runtime.consoleAPICalled`
  subscriber to the smoke.

## Recent run evidence

- v10-S10 walkthrough PID 837829 — 8/8 PASS, 7 view screenshots
  in `/tmp/bh-walkthrough-837829/`.
- v10-S9 cold-boot PID 814729 — 2/2 PASS.
- v10-S7 smoke PID 782897 — 9/9 PASS, 7 screenshots ~65KB.

## See also

- `tests/e2e/dashboard-browser-smoke.mjs` — landing-page evidence
- `tests/e2e/dashboard-auth-walkthrough.mjs` — per-view evidence
- `tests/e2e/cold-boot-perf.mjs` — cold-boot regression
- `tests/e2e/goals-cc-roundtrip.mjs` — goals CC-shape round-trip
- `tests/e2e/agent-restart-roundtrip.mjs` — agent restart round-trip
- `CONTROL_SURFACES.md` — what the dashboard can actually mutate
- `SETTINGS_AUDIT.md` — Settings-page row-by-row audit