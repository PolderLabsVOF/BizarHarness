---
description: Configure a provider in settings.json (apiKey, baseUrl, model catalog). The installer no longer touches provider config — use this command to set one up.
allowed-tools: Read, Write, Bash, WebFetch
---

# /setup-provider — Configure a provider in settings.json

The Bizar installer no longer configures a provider for you (since
v6.2.2 — the user owns provider config). Use this command to add
or update a provider in `~/.claude/settings.json`.

## What It Does

Interactively (or non-interactively with flags), the setup-provider
command writes a `provider` block to `~/.claude/settings.json` with:

- `baseUrl` — the API endpoint (e.g. `http://localhost:20128/v1` for
  the local 9Router gateway)
- `apiKey` — the provider's API key (read from `env:` reference or
  direct value)
- `models` — the model catalog (the IDs returned by
  `GET /v1/models`)

## Default: 9Router Gateway

If the user invokes `/setup-provider` with no arguments, default to
the local 9Router gateway at `http://localhost:20128/v1`. The
catalog comes from `GET http://localhost:20128/v1/models`. As of
v6.2.2, that catalog includes:

- `minimax/MiniMax-M3` (reasoning)
- `minimax/MiniMax-M2.7` (reasoning)
- `nvidia/minimaxai/minimax-m3` (reasoning)
- `nvidia/minimaxai/minimax-m2.7` (reasoning)
- `nvidia/z-ai/glm-5.2`
- `nvidia/deepseek-ai/deepseek-v4-pro`
- `nvidia/deepseek-ai/deepseek-v4-flash`
- `nvidia/moonshotai/kimi-k2.6`
- `nvidia/nemotron-3-ultra-550b-a55b`
- `openrouter/cohere/north-mini-code:free`
- `openrouter/poolside/laguna-m.1:free`
- `openrouter/nvidia/nemotron-3-super-120b-a12b:free`
- (and several more `minimax/MiniMax-M2.x` variants)

## Flags

- `--gateway <url>` — override the 9Router URL (default
  `http://localhost:20128/v1`)
- `--key <key>` — provider API key (writes `${env:KEY_NAME}` if it
  looks like an env var name, otherwise writes the literal)
- `--provider <name>` — provider name in settings.json (default `9router`)
- `--model <id>` — add a single model instead of fetching the catalog
- `--list` — print the model catalog from `/v1/models` and exit
- `--remove <name>` — remove a provider by name

## Examples

```
# Use the default 9Router gateway with the live model catalog
/setup-provider

# Custom provider
/setup-provider --provider my-anthropic --gateway https://api.anthropic.com/v1 --key sk-ant-...

# Just list the available models
/setup-provider --list
```

## Implementation

1. If `--list`, GET `${gateway}/v1/models` and pretty-print the IDs.
2. If `--remove`, edit `~/.claude/settings.json` and remove the
   `provider.<name>` block.
3. Otherwise, read `~/.claude/settings.json`. If the file doesn't
   exist, error — the user should run `bizar install` first.
4. Build the new `provider.<name>` block from the flags + fetched
   catalog.
5. Write the file back atomically (write to `settings.json.tmp`,
   then `rename`).
6. Run `bizar validate` to confirm everything is wired up.

## Security

Never echo or log the full API key. If the user supplies a key on
the command line, write it as a literal value (or `${env:KEY}`
reference if it matches a `KEY_NAME` pattern). Never commit
`~/.claude/settings.json` to source control — it may contain real
secrets.

## Related

- `bizar connect` — interactive TUI for provider setup (alternative)
- `bizar install` — installs the Bizar scaffolding (NOT provider config
  since v6.2.2)
- `bizar validate` — confirms provider config is wired correctly
- Claude Code provider config: see https://docs.claude.com/en/docs/claude-code/settings