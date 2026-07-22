---
name: cubesandbox
description: Use TencentCloud CubeSandbox — an E2B-compatible KVM microVM sandbox service for running untrusted AI-generated code with hardware-level isolation. Sub-60ms boot, <5MB overhead. Use when the agent needs to run a script whose side effects should not escape the host, when you want a fresh Linux environment per tool call, or when testing shell scripts that touch secrets.
---

# CubeSandbox — sandboxed command execution

TencentCloud's [CubeSandbox](https://github.com/TencentCloud/CubeSandbox)
is an E2B-compatible KVM microVM service for AI agents. Each sandbox:

- boots in <60 ms,
- uses <5 MB overhead,
- has its own guest OS kernel (no shared-kernel escape),
- is reachable via the E2B SDK (`pypi install cubesandbox`).

It is the right host for any `bash` call whose side effects should not
escape the sandbox: file writes, package installs, network probes, etc.

## When to route through CubeSandbox

- Any `bash` call that writes to disk — especially under `~/.config/`,
  `/tmp/`, or `node_modules/`.
- Running untrusted user code (third-party repos, eval scripts).
- Test isolation: each session gets a fresh `/home/agent` filesystem.
- Reproducible environments — the same template boots identically.

## When NOT to route through CubeSandbox

- Pure read-only inspection (use `read_file` directly).
- Single-keystroke git plumbing (`git status`, `git diff`, `git log`).
- Heavy commands that boot a new instance — reuse an open one.

## Installation

```bash
pip install cubesandbox
```

Verify:

```bash
python -c "import cubesandbox; print(cubesandbox.__version__)"
```

Expected: `0.3.x` or `0.4.x`. Older versions lack AutoPause / Credential
Vault support (v0.5+).

## Server URL

CubeSandbox ships the same protocol as E2B. Point the SDK at the
control-node:

```bash
export CUBESANDBOX_API_KEY="<from cubesandbox web console>"
export CUBESANDBOX_URL="http://<control-node>:12088"   # default
```

For Bizar-managed local sandboxes, the Bizar CLI wraps the SDK and
injects both env vars from `~/.config/bizar/cubesandbox.env`.

## Quick start (raw SDK)

```python
from cubesandbox import Sandbox

with Sandbox(template="base", timeout=300) as box:
    r = box.run("echo hello && date")
    print(r.stdout)
```

Equivalent via the Bizar CLI:

```bash
bizar sandbox run bash 'echo hello && date'
```

## Templates

CubeSandbox boots from OCI templates. The "base" template is preinstalled
on every control node; install others from the Template Store UI.

For Bizar harness testing, use the `bizar-base` template which pins:

- bun 1.3.x
- node 20.x
- python 3.12
- `git`, `gh`, `ripgrep`

## Snapshot / Clone / Rollback

CubeSandbox 0.3+ supports `snapshot()`, `clone()`, and `rollback()`:

```python
snap = box.snapshot()         # CoW checkpoint, ~ms
box2 = snap.clone()          # independent twin
box.rollback(snap)           # return to earlier state
```

Bizar uses this for the `bizar_test-gate` runner: each test runs in a
clone of the base template; failures roll back so the next test starts
clean.

## Security proxy (Credential Vault)

Since v0.4, CubeSandbox can inject credentials at the egress proxy so
they never enter the sandbox:

```python
with Sandbox(template="base", proxy_credentials={
    "OPENAI_API_KEY": "<user-key>",
}) as box:
    box.run("python -c 'import openai; print(openai.api_key)'")
    # prints OPENAI_API_KEY injected by CubeEgress; never logged
```

Bizar's `bizar_sandbox_run` tool uses this when `BIZAR_PROXY_CREDS=1`.

## Bizar integration map

| Layer | Component | Behavior |
|-------|-----------|----------|
| CLI | `bizar sandbox run` | Wraps SDK, persists last sandbox across calls |
| Plugin | `bizar_sandbox_run` | In-session tool — runs a `bash` command in a fresh sandbox |
| Skill | `cubesandbox` (this) | Discovery + best practices |
| Agent | `@sandbox-runner` (optional) | Routes risky ops automatically |
| Hook | `PreToolUse` (v6.3+) | Detects dangerous patterns and forces sandbox routing |

See `cli/commands/sandbox.mjs` and `plugins/bizar/src/tools/sandbox.ts`.

## Benchmarks (from upstream README)

| Metric | Docker | Traditional VM | CubeSandbox |
|--------|--------|----------------|-------------|
| Isolation | shared-kernel | dedicated kernel | dedicated kernel + eBPF |
| Cold start | 200ms | seconds | **<60ms** |
| Memory overhead | low | high | **<5MB** |
| Deploy density | high | low | extreme (thousands/node) |

P95: 90 ms. P99: 137 ms. Full agent workload benchmarked against SWE-Bench.

## Troubleshooting

- **`SandboxError: no template`** — install a template from the WebUI
  Template Store or run `bizar sandbox template install base`.
- **API key rejected** — check the URL doesn't end with a trailing slash
  and the key is the long one shown in the WebUI.
- **Boot takes >5s** — usually means KVM is disabled. Run
  `kvm-ok` (Debian) or `ls /dev/kvm`.
