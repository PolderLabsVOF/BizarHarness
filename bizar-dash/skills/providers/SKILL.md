---
name: providers
description: How the provider subsystem works in BizarHarness - catalog management, backup keys, auto-add wizard, and provider store.
---

# Provider Subsystem

The provider subsystem manages LLM API credentials and model routing. It is composed of the providers store, the config router, and the providers UI.

## Core Concepts

- **Provider:** A named API source (e.g., `minimax`, `openai`, `anthropic`).
- **Catalog:** The list of all known/available providers.
- **Active provider:** The currently selected provider for a given model tier.
- **Backup keys:** Additional API keys for a provider, used in rotation on 429/402/5xx.

## Provider Store

`bizar-dash/src/server/providers-store.mjs` manages:
- Provider credentials (API keys stored encrypted at rest)
- Active/inactive state per provider
- Priority ordering
- Backup key configuration

## Provider Config File

Providers are configured via `~/.config/cline/providers.json` or via the dashboard UI:

```json
{
  "providers": [
    {
      "id": "minimax",
      "name": "MiniMax",
      "apiKeys": ["sk-..."],
      "active": true,
      "priority": 1
    }
  ]
}
```

## Backup Keys (Multi-Key Rotation)

Configure additional keys for a provider:

```bash
# Via env var (comma-separated)
export MINIMAX_API_KEYS="key1,key2,key3"

# Via providers.json
{
  "providers": [{
    "id": "minimax",
    "apiKeys": ["key1", "key2", "key3"]
  }]
}
```

## Auto-Add Wizard

When the active provider fails with 401/403, the system can prompt the user to add a new key. The wizard:
1. Detects auth failure
2. Opens a modal prompting for a new key
3. Validates the key by making a test request
4. Adds to backup keys or replaces the failed key

## Provider API Endpoints

- `GET /api/providers` - list all providers with status
- `POST /api/providers` - add a new provider
- `PUT /api/providers/:id` - update provider config
- `DELETE /api/providers/:id` - remove a provider
- `POST /api/providers/:id/keys` - add a backup key
- `POST /api/providers/rotate` - force rotation to next key
