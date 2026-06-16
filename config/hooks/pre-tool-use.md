# Pre-Tool-Use Hook

Enforced by: All implementation agents (Heimdall, Thor, Tyr, Vidarr)

## Checklist

Before every `write` or `edit` operation, check:

1. **Secrets**: Does the content contain API keys, tokens, or passwords? (`sk-...`, `AIza...`, etc.)
2. **Console.log**: Is debug logging being committed? Use proper logging instead.
3. **Permissions**: Are you writing to a file you should not modify? (e.g., `.env`, `node_modules/`, `*.lock`)
4. **Size**: Is the file too large? Consider splitting into smaller modules.

## Enforcement

Block the operation if any check fails. Fix the issue first, then proceed.
