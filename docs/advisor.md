# Bizar Advisor Configuration

The advisor tool lets Claude Code consult a second, typically stronger model at key moments during a task. See [Claude Code Advisor](https://code.claude.com/docs/en/advisor) for the official documentation.

## Usage

```bash
# Interactive picker (default)
bizar advisor

# Show current configuration
bizar advisor show

# Validate current pairing
bizar advisor validate

# Disable advisor tool
bizar advisor disable

# Clear all advisor settings
bizar advisor clear

# List eligible models without picker
bizar advisor --list

# Machine-readable output
bizar advisor --json
```

## Pairing Rules

The advisor model must be at least as capable as your main model. The following pairings are valid:

| Main Model | Allowed Advisors |
|------------|-----------------|
| haiku-4-5 | fable, opus-4-5, sonnet-4-5 |
| sonnet-4-6 | fable, opus-4-5, sonnet-4-5 |
| sonnet-5 | fable, opus-4-5, sonnet-5 |
| opus-4-6 | fable, opus-4-5, sonnet-5 |
| opus-4-7+ | fable, opus-4-7+ |
| fable-5 | fable-5 |
| fable-5-1 | fable-5-1 |

The picker filters models based on your configured main model (from `ANTHROPIC_MODEL` in settings.json).

## Fable Consent

Fable advisors require one-time consent to bill usage credits. After configuring a Fable advisor, run Claude Code and type `/advisor off` then `/advisor <fable>` to consent once.

## Provider Restrictions

The advisor tool is **experimental** and requires the Anthropic API. It does not work with AWS Bedrock, GCP Vertex, or Microsoft Foundry. The `bizar advisor` command refuses to run when a non-Anthropic provider is configured.

## Disable vs Clear

- `bizar advisor disable` sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` in your settings. This refuses the advisor even if a model is configured.
- `bizar advisor clear` removes both the `advisorModel` setting and the disable flag, returning to the default state.

## Subagent Inheritance

Per the Claude Code docs, advisor configuration is inherited by subagents. When you configure an advisor, all subagents spawned by that session will also use it unless they override it locally.

## Troubleshooting

**Advisor not appearing in Claude Code?**
- Ensure `advisorModel` is set in `~/.claude/settings.json`
- Verify `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` is not set

**Pairing validation fails?**
- Check that your main model (from `ANTHROPIC_MODEL`) supports the advisor you've selected
- Run `bizar advisor validate` to see the current pairing status

**Non-Anthropic provider error?**
- The advisor tool only works with the official Anthropic API
- Use `bizar setup-provider` to switch to the Anthropic API
