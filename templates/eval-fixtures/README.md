# Eval Fixtures

Example fixture suite for the BizarHarness eval framework.

## Fixtures

| File | Description | Tags |
|------|-------------|------|
| `code-search-basic.json` | Verifies agent can find a function definition | smoke, code-search |
| `tool-call-correctness.json` | Verifies correct tool usage | smoke, tools |
| `response-format.json` | Verifies response is valid JSON with expected shape | smoke, format |
| `latency-bounds.json` | Verifies response arrives within latency budget | smoke, latency |
| `regression-suite.json` | Suite that runs all of the above | regression |

## Running

```bash
# Run all fixtures
bizar eval run ./templates/eval-fixtures

# Run with custom concurrency
bizar eval run ./templates/eval-fixtures --concurrency=3

# List recent runs
bizar eval list

# Compare two runs
bizar eval diff run_2026-07-05 run_2026-07-04
```

## Fixture Schema

```json
{
  "id": "unique-fixture-id",
  "name": "Human Readable Name",
  "description": "What this fixture verifies",
  "agent": "thor",
  "prompt": "The prompt to send to the agent",
  "expected": {
    "contains": ["expected substring 1", "expected substring 2"],
    "notContains": ["forbidden substring"],
    "regex": ["expected regex pattern"],
    "jsonSchema": null,
    "maxTokens": 2000,
    "maxLatencyMs": 30000
  },
  "tags": ["smoke", "my-tag"]
}
```

## Writing Fixtures

1. **Start simple** — begin with a `contains` check
2. **Be specific** — match exact strings, not approximate ones
3. **Use `notContains`** for things the agent should NOT do (e.g., TODO, FIXME, apologetic phrases)
4. **Latency budgets** — set `maxLatencyMs` to catch regressions
5. **Tag wisely** — use tags to filter fixtures: `bizar eval run --tag smoke`
