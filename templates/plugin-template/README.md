# Echo Plugin Template

The smallest possible Bizar marketplace plugin. Use it as a starting
point for your own — copy this folder, rename the fields in
`plugin.json`, replace the body of `index.js`, and ship it as a
`.tar.gz`.

## What you get

```
plugin-template/
├── plugin.json     # manifest (id, name, version, main, exports, permissions)
├── index.js        # the plugin's main entry — exports { init, echo, shout }
├── README.md       # you are here
└── tests/
    └── plugin.test.js   # node:test smoke tests
```

## Trying it locally

You can sanity-check the template without publishing it: install it
from a local path (or just point the host at this folder directly):

```bash
# From inside your dashboard's project:
bizar plugin install <path-to-plugin-template>
bizar plugin info echo
bizar plugin invoke echo echo "hello world"
# → echo: hello world

bizar plugin config echo greeting "yo"
bizar plugin invoke echo shout "hello world"
# → SHOUT: HELLO WORLD

bizar plugin uninstall echo
```

## Publishing

1. **Pick an id.** It must match `/^[a-z0-9][a-z0-9-]*$/`. Lowercase
   kebab-case is the convention (`vercel-deploy`, `github-pr-watcher`).

2. **Edit `plugin.json`** — at minimum:
   - `id`, `name`, `version`, `description`
   - `main` (relative to the tarball root)
   - `exports` (array of method descriptors; drives the dashboard UI)
   - `permissions` (every `api.*` method you'll use, except `console`,
     `api.config.*`, and `api.log` which are always available)

3. **Write the plugin code** in `index.js`. Use `module.exports = { ... }`
   and export plain async functions. Every async method is awaited by
   the host; a thrown error becomes `{ ok: false, error, code }` on the
   wire.

4. **Package the tarball.** Standard convention:

   ```bash
   tar czf echo-0.1.0.tar.gz plugin.json index.js tests
   ```

   The tarball root must contain `plugin.json` (either at the very
   top of the archive or inside a single top-level directory — both
   work).

5. **Compute the SHA-256** of the tarball:

   ```bash
   sha256sum echo-0.1.0.tar.gz
   # → 8a3f... (64 hex chars)
   ```

6. **Submit to the registry** by opening a PR against
   [DrB0rk/bizar-plugins](https://github.com/DrB0rk/bizar-plugins).
   Add your entry under `plugins:` in `registry.json`:

   ```json
   {
     "id": "echo",
     "name": "Echo",
     "version": "0.1.0",
     "description": "Echo plugin",
     "author": "you",
     "category": "utility",
     "tags": ["example", "template"],
     "tarball": "https://github.com/.../echo-0.1.0.tar.gz",
     "checksum": "sha256:8a3f...",
     "permissions": [],
     "minBizarVersion": "4.9.0"
   }
   ```

   The host verifies the checksum before extracting — a tampered
   tarball is rejected outright.

7. **Install.** Once merged:

   ```bash
   bizar plugin install echo
   ```

## Sandbox permissions

| Permission   | What it unlocks                                      |
|--------------|------------------------------------------------------|
| `net`        | `api.http.get(url)`, `api.http.post(url, body)`      |
| `fs:read`    | `api.fs.read(path)` — sandboxed to the plugin root   |
| *(none)*     | `api.config.*`, `api.log`, `console.*` are free      |

Anything else (`process`, `child_process`, raw `fs`, `net`) is
stripped from the plugin's global scope by `node:vm`. A plugin that
tries `require('node:fs')` will throw `require is not defined`.

## Versioning

Bizar plugins use [semver](https://semver.org/). Bump the major
version for any breaking change to `plugin.json`'s `exports[]`; minor
for new methods; patch for bugfixes.

## License

MIT, same as the rest of BizarHarness.