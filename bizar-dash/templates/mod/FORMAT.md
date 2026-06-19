# Bizar Mods — Format Reference (v3.0.0)

A mod is a folder with a `mod.json` manifest that extends the Bizar
platform. Mods live at `~/.config/bizar/mods/<mod-id>/`.

## Folder layout

```
<mod-id>/
├── mod.json           # manifest (required)
├── README.md          # description (optional)
├── agents/            # custom agents (optional)
│   └── <agent>.md
├── commands/          # custom commands (optional)
│   └── <command>.md
├── routes/            # custom API routes (optional)
│   └── <route>.mjs
├── views/             # custom React views (optional)
│   └── <view>.tsx
├── web/               # custom web assets (optional)
│   └── index.html
├── tui/               # custom TUI components (optional)
│   └── <comp>.mjs
└── hooks/             # custom event hooks (optional)
    └── <hook>.mjs
```

## mod.json schema

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "author": "name",
  "description": "...",
  "bizar": ">=3.0.0",
  "type": "agent" | "command" | "view" | "route" | "tui" | "full",
  "enabled": true,
  "permissions": ["read:agents", "write:tasks"],
  "entry": {
    "agent": "agents/my-agent.md",
    "command": "commands/my-command.md",
    "route": "routes/my-route.mjs",
    "view": "views/my-view.tsx",
    "tui": "tui/my-comp.mjs"
  }
}
```

## Permissions (v3.0.0)

`permissions` is a hint to the user. v3 doesn't enforce it yet — the
runtime is permissive. Future versions will gate operations by
permission.

Common permission strings:
- `read:agents`
- `write:agents`
- `read:tasks`
- `write:tasks`
- `read:projects`
- `write:projects`
- `read:schedules`
- `write:schedules`
- `read:config`
- `write:config`

## Lifecycle

- The dashboard scans `~/.config/bizar/mods/` on startup.
- For each mod with `enabled: true`, the loader exposes its agents,
  commands, and views in the dashboard.
- v3 doesn't dynamically mount mod routes or render mod views — those
  are planned for v3.1+. Mods that ship today can still install custom
  agents and commands.
