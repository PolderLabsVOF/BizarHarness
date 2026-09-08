# Bizar Status Line

Customized status bar for Claude Code that displays session information in a terminal-friendly format.

## Overview

The status line runs as a shell script that receives JSON session data from Claude Code and prints formatted text. See [Claude Code Status Line Docs](https://code.claude.com/docs/en/statusline) for the official documentation.

## Quick Start

```bash
# Install the statusline
bizar statusline install

# Preview what it looks like
bizar statusline preview

# Remove it
bizar statusline remove
```

## Templates

Three templates are available:

### default (3 lines)

```
🤖 Sonnet 4.5  ⚡ custom-mini (custom)  🧠 Opus 4.5 (advisor)
📁 ~/projects/myapp  ⎇ main*2+1  🔗 #142
[████████░░░░░░░░░░] 35% (17.5k/50k)  💵 $0.42  ⏱ 4m12s
```

Line 1: Model name, custom model (if ANTHROPIC_CUSTOM_MODEL_OPTION is set), advisor model (if advisorModel is configured)

Line 2: Current working directory, git branch with dirty status, PR number (if in a PR)

Line 3: Context usage progress bar, percentage, tokens used/total, accumulated cost, session duration

### compact (1 line)

```
🤖 Sonnet 4.5 · 35% ctx · $0.42 · main · ~/projects/myapp
```

### git-only (1 line, no model/cost)

```
⎇ main*2+1 · 🔗 #142 · ~/projects/myapp
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--template` | Template: `default`, `compact`, `git-only` | `default` |
| `--padding` | Horizontal padding characters | `1` |
| `--refresh` | Refresh interval in seconds (min 1) | `5` |
| `--hide-vim` | Hide the Vim mode indicator | `false` |

## Bizar-Specific Notes

The renderer automatically reads from your `~/.claude/settings.json`:

- **Custom model**: If `env.ANTHROPIC_CUSTOM_MODEL_OPTION` is set, the `⚡ <model> (custom)` segment appears
- **Advisor**: If `advisorModel` is configured, the `🧠 <model> (advisor)` segment appears

These segments appear automatically based on your settings — no extra flags needed.

## Git Integration

- Branch name is fetched via `git rev-parse --abbrev-ref HEAD`
- Dirty status shows `*<modified>+<staged>` (only when both are non-zero)
- Git commands timeout after 2 seconds
- Results are cached for 5 seconds to avoid repeated git spawns

## Progress Bar Colors

- Green (0-50%): Normal usage
- Yellow (50-80%): Getting close to limit
- Red (80-100%): Near context limit

## Troubleshooting

```bash
# See current configuration
bizar statusline show

# Test with sample data
bizar statusline preview --template compact

# Check what Claude Code sends
bizar statusline render < /path/to/session.json
```

## Uninstall

```bash
bizar statusline remove
```

This removes the `statusLine` field from your `settings.json`. The rest of your configuration is preserved.
