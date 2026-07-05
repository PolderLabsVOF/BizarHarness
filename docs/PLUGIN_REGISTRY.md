# Publishing to the BizarHarness Plugin Registry

The plugin registry is a JSON file listing every installable plugin for BizarHarness.

## Registry URLs

The registry is served at the following URLs in priority order:

1. **`BIZAR_REGISTRY_URL` env var** — explicit override (highest priority)
2. **`https://raw.githubusercontent.com/DrB0rk/bizar-plugins/main/registry.json`** — primary (GitHub raw)
3. **`https://bizar-plugins.bork.deno.net/registry.json`** — Cloudflare Deno Deploy mirror (fallback)

When all remote sources fail, the dashboard falls back to a local cache at `~/.cache/bizar/registry.json`.

## How to add your plugin

### 1. Fork the plugin repository

Fork [DrB0rk/bizar-plugins](https://github.com/DrB0rk/bizar-plugins).

### 2. Add your plugin directory

Create a directory at `plugins/<your-plugin-id>/` with your plugin source files.

### 3. Create a release tarball

Create a GitHub Release and upload a `.tar.gz` tarball named `<your-plugin-id>-<version>.tar.gz`.

The tarball should contain a plugin manifest (`manifest.json`) at its root:

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "version": "1.0.0",
  "description": "What it does",
  "entry": "index.mjs"
}
```

### 4. Update the registry

Add an entry to `registry.json` in your fork:

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "version": "1.0.0",
  "description": "What it does",
  "author": "your-github-handle",
  "category": "deploy",
  "tags": ["vercel", "deploy"],
  "homepage": "https://github.com/DrB0rk/bizar-plugins/blob/main/plugins/your-plugin-id",
  "tarball": "https://github.com/DrB0rk/bizar-plugins/releases/download/your-plugin-id-1.0.0/your-plugin-id-1.0.0.tar.gz",
  "checksum": "sha256:<64-hex-checksum-of-tarball>",
  "permissions": ["net"],
  "minBizarVersion": "5.0.0"
}
```

### 5. Open a pull request

Open a PR against `DrB0rk/bizar-plugins:main`. Once merged, the plugin becomes available in the marketplace.

## Plugin entry schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique kebab-case identifier (e.g. `vercel-deploy`) |
| `name` | `string` | Yes | Human-readable plugin name |
| `version` | `string` | Yes | Semver version string (e.g. `1.0.0`) |
| `description` | `string` | No | Short description shown in the marketplace |
| `author` | `string` | No | Author name or GitHub handle |
| `category` | `string` | No | Category for filtering: `deploy`, `ci`, `notification`, `analytics`, etc. |
| `tags` | `string[]` | No | Searchable tags |
| `homepage` | `string` | No | Link to plugin source or documentation |
| `tarball` | `string` | Yes | HTTPS URL to the `.tar.gz` release artifact |
| `checksum` | `string` | Yes | SHA-256 checksum in format `sha256:<64-hex>` |
| `permissions` | `string[]` | Yes | List of permissions: `net`, `fs:read`, `fs:write`, etc. |
| `minBizarVersion` | `string` | No | Minimum BizarHarness version required |

## Checksum computation

To compute the SHA-256 checksum of your tarball:

```bash
shasum -a 256 your-plugin-1.0.0.tar.gz
```

The output is `abc123...` (64 hex chars). Prepend `sha256:` to get the checksum value.

## Setting up a private registry mirror

For air-gapped or private deployments, set `BIZAR_REGISTRY_URL` to point at your internal CDN:

```bash
BIZAR_REGISTRY_URL=https://my-internal-cdn.com/registry.json bizarre start
```

## Cache behavior

The dashboard caches the registry for 1 hour per URL. To force a cache refresh:

```bash
bizar plugins update
```
