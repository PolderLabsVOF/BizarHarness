# Migration guide

Current Bizar installs are Claude Code-native. Run `node cli/bin.mjs install` or `node cli/provision.mjs` to sync agents, skills, commands, hooks, rules, MCP registration, and guarded permission settings.

Upgrading from an older application-style release removes its web service, browser integrations, deployment templates, and note-vault/search commands. Back up any user-owned data before uninstalling an old release; the current installer does not migrate or read those retired formats.
