# Hello Mod

A sample mod that ships with the Bizar platform. It demonstrates:

- A `mod.json` manifest with permissions and an `entry` block
- A sample agent (`agents/greeter.md`)
- A slash command (`commands/hello.md`)
- A route module (`routes/ping.mjs`) — the v3.1+ runtime will mount it
- A view metadata file (`views/HelloView.tsx`) — the v3.1+ dashboard
  will render it as a tab

## Install

```bash
# from the bizarre-dash package root
bizar mod install ./templates/mod/hello-mod
```

Or copy the folder into `~/.config/bizar/mods/hello-mod/` by hand.
