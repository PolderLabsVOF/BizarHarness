# Eval Framework Skill

v5.0.0 — Evaluate AI agent outputs against golden fixtures for regression testing, agent comparison, and quality assurance.

## Overview

The eval framework runs fixtures — JSON files that define a prompt, expected outputs, and validation rules — against a live agent and reports pass/fail results.

## Fixture Schema

```json
{
  "id": "unique-fixture-id",
  "name": "Human Readable Name",
  "description": "What this fixture verifies",
  "agent": "thor",
  "prompt": "The prompt to send to the agent",
  "expected": {
    "contains": ["substring 1", "substring 2"],
    "notContains": ["forbidden substring"],
    "regex": ["expected regex pattern"],
    "jsonSchema": null,
    "maxTokens": 2000,
    "maxLatencyMs": 30000
  },
  "tags": ["smoke", "regression"]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier across all fixtures |
| `name` | string | Yes | Human-readable name |
| `description` | string | Yes | What the fixture verifies |
| `agent` | string | Yes | Agent to use: `thor`, `tyr`, `heimdall`, etc. |
| `prompt` | string | Yes | The prompt sent to the agent |
| `expected` | object | Yes | Validation rules |
| `tags` | string[] | No | Tags for filtering |

### Expected Validation Rules

| Field | Type | Description |
|-------|------|-------------|
| `contains` | string[] | All substrings must appear in the response |
| `notContains` | string[] | No substring may appear in the response |
| `regex` | string[] | All regex patterns must match the response |
| `jsonSchema` | object\|null | If set, response must be valid JSON matching the schema |
| `maxTokens` | number | Maximum total tokens in the response |
| `maxLatencyMs` | number | Maximum response time in milliseconds |

## Running Evals

### CLI

```bash
# Run a fixture suite
bizar eval run ./templates/eval-fixtures

# Run with custom concurrency
bizar eval run ./path/to/fixtures --concurrency=5 --agent=thor

# List recent runs
bizar eval list --limit=20

# Show run details
bizar eval show run_2026-07-05-120000

# Diff two runs
bizar eval diff run_2026-07-05 run_2026-07-04

# Scaffold a new fixture
bizar eval init ./my-fixtures

# Validate a fixture without running
bizar eval validate ./my-fixtures/my-fixture.json
```

### REST API

```bash
# Run a suite (POST)
curl -X POST http://127.0.0.1:4321/api/eval/run \
  -H "Content-Type: application/json" \
  -d '{"suitePath": "./templates/eval-fixtures", "concurrency": 5}'

# List runs (GET)
curl http://127.0.0.1:4321/api/eval/runs?limit=20

# Get run details (GET)
curl http://127.0.0.1:4321/api/eval/runs/run_2026-07-05-120000

# Diff runs (GET)
curl http://127.0.0.1:4321/api/eval/runs/run_2026-07-05/compare/run_2026-07-04

# List fixtures in a path (GET)
curl "http://127.0.0.1:4321/api/eval/fixtures?path=./templates/eval-fixtures"
```

## Writing Good Fixtures

### Start with `contains`

The simplest check — verify a substring appears in the response:

```json
{
  "id": "my-fixture",
  "prompt": "What is 2+2?",
  "expected": {
    "contains": ["4", "four"]
  }
}
```

### Use `notContains` for Anti-Patterns

Catch common mistakes the agent should NOT make:

```json
{
  "id": "no-apologies",
  "prompt": "Tell me about Python",
  "expected": {
    "notContains": ["I'm sorry", "I apologize", "as an AI"]
  }
}
```

### Regex for Structured Patterns

Match structured output without strict JSON validation:

```json
{
  "id": "function-signature",
  "prompt": "Write a function that adds two numbers",
  "expected": {
    "regex": ["function\\s+add\\s*\\(", "def\\s+add\\s*\\("]
  }
}
```

### JSON Schema for Structured Responses

Validate the exact shape of JSON responses:

```json
{
  "id": "json-response",
  "prompt": "Return your version as JSON",
  "expected": {
    "jsonSchema": {
      "type": "object",
      "required": ["version"],
      "properties": {
        "version": { "type": "string" }
      }
    }
  }
}
```

### Latency Budgets

Catch performance regressions:

```json
{
  "id": "fast-response",
  "prompt": "Say 'hi'",
  "expected": {
    "contains": ["hi"],
    "maxLatencyMs": 5000
  }
}
```

## Regression Tracking

Run evals regularly and compare results:

```bash
# Run today
bizar eval run ./fixtures --agent=thor

# Compare with yesterday's run
bizar eval diff run_2026-07-05 run_2026-07-04
```

The diff categorizes fixtures as:
- **Improved** — was failing, now passing
- **Regressed** — was passing, now failing
- **Unchanged** — same result in both runs

## Test Isolation

Fixtures should be:
- **Idempotent** — running twice gives the same result
- **Independent** — no fixture depends on another
- **Deterministic** — same prompt → same result (modulo non-determinism in the model)

## Debugging Failures

When a fixture fails:

1. **Check the check details** — each check has a `message` explaining why it failed
2. **Increase token budget** — the model may be truncating output
3. **Relax latency** — the model may be slow due to load
4. **Check the prompt** — the model may be misunderstanding the task

## CI Integration

Add to your CI pipeline:

```yaml
# .github/workflows/eval.yml
- name: Run eval suite
  run: |
    bizar eval run ./fixtures --concurrency=3

- name: Check for regressions
  run: |
    RESULT=$(bizar eval list --limit=1)
    # Fail if any fixtures failed
```

## Files

| File | Purpose |
|------|---------|
| `bizar-dash/src/server/eval.mjs` | Core runner — loads fixtures, calls LLM, validates |
| `bizar-dash/src/server/eval-store.mjs` | Persistence — saves runs to `~/.local/share/bizar/eval/` |
| `bizar-dash/src/server/routes/eval.mjs` | REST API surface |
| `cli/commands/eval.mjs` | CLI subcommands |
| `templates/eval-fixtures/` | Example fixtures |
