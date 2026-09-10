# `bizar orchestrator`

`bizar orchestrator` manages Claude Code's multi-entry `modelPicker` setting. It
helps operators discover model metadata, select several models, and append them
to `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Claude
Code's setting reference is documented at
[modelPicker](https://code.claude.com/docs/en/settings-reference#modelpicker).

## Usage

```text
bizar orchestrator [pick|show|clear|validate] [options]
```

`pick` is the default. It opens a multi-select picker. Use `↑`/`↓` or `j`/`k`
to move, `space` to toggle a row, `a` to toggle all visible rows, type to
filter, `Enter` to apply, and `Esc` or `Ctrl-C` to cancel. Selected rows show a
check mark. The command asks for confirmation before writing settings; pass
`--yes` to skip it.

In a non-TTY, the command prints numbered rows and accepts space-separated
numbers such as `1 3 5`.

## Settings schema

The command appends entries, preserving existing order and entries:

```json
{
  "modelPicker": [
    {
      "id": "provider/model-id",
      "label": "Readable model name",
      "description": "Short description",
      "capabilities": ["reasoning", "tool_call"]
    }
  ]
}
```

`clear` deletes the entire `modelPicker` array. It does not modify other
settings, including `env`, hooks, permissions, or MCP servers.

## Metadata sources

By default (`--source both`), the command merges:

- **models.dev** (`https://models.dev/api.json`): provider model records and
  capability flags for reasoning, tool calls, structured output, and
  attachments. Results are cached for five minutes in
  `~/.cache/bizar/models-dev-cache.json`.
- **Gateway** (`$ANTHROPIC_BASE_URL/v1/models?limit=1000`): model IDs,
  display names, and descriptions. The optional
  `$ANTHROPIC_AUTH_TOKEN` is sent as a Bearer token.

Use `--source models.dev` or `--source gateway` to restrict discovery. Use
`--provider <name>` to filter models.dev records to one provider. When both
sources contain an ID, gateway label/description wins and models.dev
capabilities win. Gateway-only rows are tagged `[gateway]`.

If discovery fails and no cache is available, the static fallback model list is
used and the command prints a warning.

## Subcommands

- `pick`: select and append models to `modelPicker`.
- `show`: print the current array, resolved metadata sources, provider filter,
  and fallback state. `--json` emits machine-readable output.
- `clear`: remove `modelPicker` entirely. Use `--yes` for unattended use.
- `validate`: verify every configured ID exists in the selected metadata source
  and report unknown and duplicate IDs. It exits unsuccessfully when either is
  found.
- `--list`: dump the discovered model list without opening the picker.

All subcommands support `--json` where output is intended for automation.
Commands refuse to run in a Bizar/Claude Code agent context; this command is
operator-only because it changes global Claude Code settings.

## Single-entry compatibility hint

`ANTHROPIC_CUSTOM_MODEL_OPTION` is a separate Claude Code mechanism. If it is
already set, `bizar orchestrator show` reports it with a hint: that variable
adds **one** entry at the top of `/model`. It is not used or modified by this
command; multiple entries belong in the `modelPicker` array.
