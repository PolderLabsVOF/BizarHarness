---
description: Bizar Plugin Menu — route to the right Bizar action based on the user's request.
---

# Bizar Dashboard

The `/bizar` command launches the Bizar dashboard in your browser — a fully integrated workspace with Overview, Chat, Agents, Plans, Projects, Config, and Settings panels. The dashboard binds to `127.0.0.1` only and runs as a local Express + WebSocket server on a free port (preferred: 4321).

If the user invoked `/bizar` with arguments, treat them as a request and route appropriately:

- "explain X" → invoke `/explain X`
- "plan Y" → invoke `/visual-plan on` and then `/plan new <slug>` with the user's intent as the slug
- "review PR" → invoke `/pr-review`
- "audit" → invoke `/audit`
- "learn" → invoke `/learn`
- "init" → invoke `/init`
- "dashboard" or "open dashboard" → `/bizar` (no args, will launch the dashboard)
- Otherwise: ask one clarifying question

If the user invoked `/bizar` with no arguments, the dashboard is launching in the background. Visit `http://localhost:<port>/` to access it. The plugin's `chat.message` hook spawns `bizar dash start` as a detached child process and surfaces the live URL in its response.

Common ports: 4321 is preferred; if it's taken, the launcher walks upward and picks the next free port. The PID and port are recorded under `~/.config/bizar/dashboard.{pid,port}` so `bizar dash stop` and `bizar dash status` can find the running instance.