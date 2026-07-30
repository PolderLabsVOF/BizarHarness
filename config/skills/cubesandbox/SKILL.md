---
name: cubesandbox
description: Run untrusted code in a fresh CubeSandbox microVM through its E2B-compatible Code Interpreter API.
---

# CubeSandbox isolated execution

Use CubeSandbox when generated or third-party code should not execute on
the host. Bizar exposes only a short-lived CLI path; it does not run a
sandbox daemon or add an MCP tool.

## Install and configure

CubeSandbox's current quickstart uses the E2B Code Interpreter SDK:

```bash
pip install e2b-code-interpreter
bizar sandbox config \
  --url http://127.0.0.1:3000 \
  --key '<api-key>' \
  --template '<template-id>'
bizar sandbox doctor
```

The config is stored with mode `0600` at
`~/.config/bizar/cubesandbox.env` using:

- `E2B_API_URL`
- `E2B_API_KEY`
- `CUBE_TEMPLATE_ID`

## Execute

```bash
bizar sandbox run python 'print("hello from the sandbox")'
bizar sandbox run javascript 'console.log("hello")'
```

The CLI creates a fresh `Sandbox.create(template=...)`, calls
`run_code(code, language=...)`, prints JSON output, and closes the
sandbox. User code and template identifiers are passed as JSON on stdin;
they are never interpolated into the Python launcher.

## Guardrails

- Do not put CubeSandbox credentials in repository files.
- Treat sandbox output as untrusted.
- Do not promise isolation when `bizar sandbox doctor` is not ready.
- Do not route ordinary read-only inspection through a remote sandbox.
- Host-side dangerous commands remain subject to Bizar's `PreToolUse`
  denial hook; the sandbox is an explicit execution choice, not a bypass.

Implementation: `cli/commands/sandbox.mjs`.
