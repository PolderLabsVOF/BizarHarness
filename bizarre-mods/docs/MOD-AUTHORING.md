# Creating a Bizar Mod

This guide covers authoring mods for [BizarHarness](https://github.com/DrB0rk/BizarHarness). Mods extend the dashboard with extra routes, views, commands, or agents.

## What a mod looks like

```
my-mod/
├── mod.json          # required — manifest
├── README.md         # docs (rendered in dashboard)
├── route.mjs         # optional — Express router
├── agents/           # optional — agent .md files
├── commands/         # optional — slash command .md files
├── hooks/            # optional — opencode plugin hooks
├── views/            # optional — declarative tab registrations
│   └── registry.json
└── assets/           # optional — static files
```

## `mod.json` manifest

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "One-line description shown in the dashboard.",
  "kind": "view",
  "entry": {
    "route": "route.mjs",
    "view": {
      "id": "my-mod-tab",
      "label": "My Mod",
      "icon": "Star",
      "description": "Tab description for the dashboard UI.",
      "tabId": "mymod",
      "mountPath": "/api/mods/my-mod"
    }
  },
  "permissions": [
    "fs:read:.bizar",
    "process:spawn:opencode"
  ],
  "configSchema": {
    "enabled": {
      "type": "boolean",
      "default": true,
      "description": "Toggle this mod on/off without uninstalling."
    }
  },
  "bizar": ">=3.15.0"
}
```

### Required fields

- **`id`** — unique slug; lowercase, hyphenated. Becomes the install folder name (`~/.config/bizar/mods/<id>/`).
- **`name`** — display name shown in the dashboard.
- **`version`** — semver (`x.y.z`).
- **`kind`** — `view` | `agent` | `command` | `integration` | `full`.
- **`entry`** — entry points (see below).

### Optional fields

- **`author`**, **`description`**, **`homepage`**
- **`permissions`** — array of strings the mod requests. The loader prints a warning if unknown permissions are requested; v1 is permissive (no enforcement), but v2 will gate.
- **`configSchema`** — JSON schema for user-configurable values. Stored at `~/.config/bizar/mods/<id>/config.json` (overrides defaults).
- **`bizar`** — semver range of BizarHarness versions the mod supports.

## `entry.route` — Express router

Mod route files live outside the BizarHarness package tree, so they can't `import { Router } from 'express'` directly (no `node_modules`). The loader works around this by injecting an `express` import before evaluating your code.

Export a default function that takes `({ router, broadcast, state, projectRoot })`:

```js
// route.mjs
export default function register({ router, broadcast }) {
  router.get('/hello', (req, res) => {
    res.json({ msg: 'Hello from my mod!' });
  });

  router.post('/action', (req, res) => {
    broadcast({ type: 'mymod:did-something' });
    res.json({ ok: true });
  });
}
```

The loader mounts your router at `/api/mods/<id>/` automatically.

## `entry.view` — declarative tab registration

Add a `views/registry.json` for static tab metadata, or specify a `view` block in `entry`:

```json
{
  "id": "my-mod-tab",
  "label": "My Mod",
  "icon": "Star",
  "tabId": "mymod"
}
```

The dashboard will render a top-bar entry using the `icon` (any
[lucide-react](https://lucide.dev) name). The view content itself
needs to be implemented in the dashboard — see "Frontend views"
below.

## Frontend views (optional)

For a fully integrated UI (not just a route), add a frontend component
under `views/<ViewName>.tsx` and reference it from `entry.view.viewComponent`.
The dashboard loads the component via dynamic import.

Because mods live outside the dashboard package tree, you can't
`import` them directly. Use this pattern:

```ts
// in the dashboard's view loader
const modView = await import(`/api/mods/${modId}/views/${viewComponent}`)
  .then(m => m.default)
  .catch(() => null);
```

> **Workaround:** in v1, the mod's frontend component must be
> co-located with the dashboard bundle. The recommended path is to
> contribute the view to BizarHarness upstream and have the mod
> only contribute the backend route.

## Permissions

The mod declares what it needs:

| Permission | Grants |
|---|---|
| `fs:read:<path>` | Read files under `<path>` (relative to project root or `~/.config/bizar`) |
| `fs:write:<path>` | Write files under `<path>` |
| `process:spawn:<bin>` | Spawn `<bin>` subprocesses |
| `network:<host>` | Make outbound network requests to `<host>` |
| `api:read` | Read dashboard's REST API (loopback only) |
| `api:write` | Modify dashboard state via REST API |

In v1 the loader prints warnings but doesn't enforce. v2 will gate.

## Submission checklist

Before opening a PR to `DrB0rk/bizarre-mods`:

- [ ] `mod.json` validates against the schema
- [ ] `route.mjs` exports a default function (no top-level side effects)
- [ ] README.md with install/usage/troubleshooting sections
- [ ] Test on a fresh checkout: `bizar mod install /path/to/your/mod`
- [ ] No bundled `node_modules/` — the loader injects dependencies
- [ ] Total size < 5 MB

## Local development

Test a mod without publishing:

```bash
# From the mod directory
bizar mod install ./path/to/mod

# Or in development:
bizar mod install ./mods/my-mod
bizar dash start --bg
```

The loader copies the mod into `~/.config/bizar/mods/my-mod/`. Edit
files there and reload the dashboard (`bizar dash restart`).

For hot-reload during development, symlink:

```bash
ln -s /path/to/my-mod ~/.config/bizar/mods/my-mod
bizar dash restart
```