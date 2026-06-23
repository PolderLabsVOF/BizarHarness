# opencode Plugins (opencode.ai/docs/plugins/)

## Source: https://opencode.ai/docs/plugins/

### Loading plugins
- Local: `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global)
- npm: `"plugin": ["package-name"]` in opencode.json
- npm plugins auto-installed via Bun, cached in `~/.cache/opencode/node_modules/`
- Load order: global config → project config → global plugins dir → project plugins dir

### Plugin structure
```ts
// Plugin is a function returning hooks
export const MyPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Hook implementations
  }
}
```

### Plugin context received
- `project` — current project info
- `directory` — current working directory
- `worktree` — git worktree path
- `client` — opencode SDK client for interacting with the AI
- `$` — Bun's shell API

### TypeScript support
```ts
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
```

### Events (hooks)
Discriminated by dotted event name string. All follow pattern:
- `event: async (input, output) => {}` — generic event handler
- Or named hooks: `"event.name": async (input, output) => {}`

**Event list** (27 event types):
- Command: `command.executed`
- File: `file.edited`, `file.watcher.updated`
- Installation: `installation.updated`
- LSP: `lsp.client.diagnostics`, `lsp.updated`
- Message: `message.part.removed`, `message.part.updated`, `message.removed`, `message.updated`
- Permission: `permission.asked`, `permission.replied`
- Server: `server.connected`
- Session: `session.created`, `session.compacted`, `session.deleted`, `session.diff`, `session.error`, `session.idle`, `session.status`, `session.updated`
- Todo: `todo.updated`
- Shell: `shell.env`
- Tool: `tool.execute.after`, `tool.execute.before`
- TUI: `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`

### Custom tools in plugins
```ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "Custom tool",
        args: { foo: tool.schema.string() },
        async execute(args, context) {
          return `Hello ${args.foo}`
        },
      }),
    },
  }
}
```
- Uses Zod schemas for args
- Plugin tool with same name as built-in takes precedence

### Config hook
```ts
async config(config) {
  config.command = config.command ?? {}
  config.command['mycmd'] = { template, description, agent, model, subtask }
}
```

### Logging
```ts
await client.app.log({
  body: { service: "my-plugin", level: "info", message: "Plugin initialized", extra: { foo: "bar" } }
})
```

### Dependencies for local plugins
- Add `package.json` to config directory with needed deps
- OpenCode runs `bun install` at startup

### Plugin template project structure
```
my-plugin/
├── src/
│   ├── index.ts          # Plugin entry point (exports Plugin function)
│   ├── version.ts        # Version info
│   └── commands/         # .md files as slash commands
├── .github/workflows/
├── package.json
├── tsconfig.json
└── README.md
```
