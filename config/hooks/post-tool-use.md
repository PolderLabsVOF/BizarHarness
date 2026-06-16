# Post-Tool-Use Hook

Enforced by: All implementation agents (Heimdall, Thor, Tyr, Vidarr)

## Checklist

After every `write` or `edit` operation:

1. **Format**: Run the project formatter (Prettier, Black, ruff, gofmt, rustfmt)
2. **Lint**: Run the linter on the modified file
3. **Typecheck**: Run the type checker (tsc, mypy, etc.) if applicable
4. **Quick test**: If modifying tests, run just the affected test file

## Enforcement

Run these automatically. Do not ask for permission — the hook enforces quality.
