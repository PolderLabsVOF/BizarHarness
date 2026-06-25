# bizarre-mods

> Official mod registry for [BizarHarness](https://github.com/DrB0rk/BizarHarness).

A **mod** is a folder with a `mod.json` manifest that extends the
BizarHarness dashboard with extra routes, views, commands, or agents.
Mods are installed into `~/.config/bizar/mods/<id>/` and live outside the
BizarHarness package — they can be installed, uninstalled, enabled,
and disabled independently of the core.

## How mods are discovered

`bizar mod update-registry` fetches `registry.json` from this repo's
`main` branch (raw URL). The dashboard's Mods tab then lists
"Available" mods from the registry and offers one-click install.

Default registry URL:
```
https://raw.githubusercontent.com/DrB0rk/bizarre-mods/main/registry.json
```

Override with:
```bash
bizar mod registry set <url>
```

## How mods are installed

```bash
bizar mod search <query>          # fuzzy search the registry
bizar mod install <id>           # install latest version
bizar mod install <id>@<version> # pin a specific version
bizar mod uninstall <id>
bizar mod list                   # list installed
bizar mod enable <id>
bizar mod disable <id>
bizar mod info <id>               # show details
```

The CLI downloads the mod tarball from this repo's
`mods/<id>/<version>/` directory, unpacks into
`~/.config/bizar/mods/<id>/`, and reloads the mod loader.

## How to author a mod

See [`templates/mod-template/`](./templates/mod-template/) for a starter
project, or read [`docs/MOD-AUTHORING.md`](./docs/MOD-AUTHORING.md) for
the full spec.

Quick anatomy:

```
my-mod/
├── mod.json          # required: id, name, version, entry, permissions
├── README.md         # docs (rendered in the dashboard)
├── route.mjs         # optional: Express router; exports register({router, ctx})
├── views/            # optional: declarative tab registrations
│   └── registry.json
└── assets/           # optional: static files
```

Submit a mod by opening a PR to this repo that:
1. Adds your mod under `mods/<your-mod-id>/<version>/`
2. Updates `registry.json` to list the new version
3. Includes a README.md

We accept mods that:
- Have a working `mod.json`
- Have a smoke-tested `route.mjs` (or are agents/commands only)
- Don't bundle the BizarHarness dependencies (the loader injects them)
- Are under 5 MB

## Available mods

| Mod | Description |
|---|---|
| [graphify](./mods/graphify/) | Interactive knowledge-graph view of your project. Code-only build works offline. |

## License

MIT — same as BizarHarness.