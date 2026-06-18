# Quick Start

A five-minute tour of BizarHarness. This page assumes you've already run the installer — see [Getting Started](Getting-Started) if you haven't.

## Open opencode in a project

Start opencode from the root of any project that has a `.bizar/` folder (run `bizar init` first if you don't have one):

```bash
cd ~/my-project
opencode
```

The opencode TUI loads. You'll see the agent list — Odin is the default, and the others (Frigg, Vör, Quick, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti) are available for direct selection.

## See the router

Type `@odin help` to ask the router agent what it can do. Odin will respond with a description of its decomposition strategy, the cost-tier routing table, and the principle that it never executes work itself — it always dispatches.

This is a useful first invocation because it confirms the agent definitions loaded and the Hindsight MCP server (if configured) is reachable.

## Try a read-only Q&A

For a quick, free, no-side-effects question, ask Frigg:

```
@frigg what does this project do
```

Frigg uses Semble to search the codebase, reads `package.json` and any top-level docs, and returns a 1-2 paragraph summary with file references. It will never edit anything. This is the cheapest agent in the system (DeepSeek V4 Flash, free tier), so it's safe to use liberally for orientation.

Other things to try with Frigg:

- `@frigg where is the database connection configured`
- `@frigg show me the public API surface of the auth module`
- `@frigg what test framework is used and how do I run a single test`

## Try a research request

For deeper codebase exploration, route to Mimir:

```
@mimir research how authentication flows through the request lifecycle
```

Mimir uses Semble as its primary search tool, falls back to grep only when Semble is not available, and produces a structured findings document with file:line references. It's also free (DeepSeek Flash), so this is the right agent for "go learn about X" tasks before you commit to a change.

## Try a moderate implementation task

For work that touches code, route to Thor:

```
@thor add a /healthz endpoint that returns 200 OK
```

Odin will see this request, decompose it, and dispatch:

- `@thor` (M2.7) to implement the endpoint and add a test.
- (Possibly) `@tyr` (M3) in parallel to review the design and write integration coverage.

Both agents run in the same message, so they happen in parallel. Odin synthesizes the result and shows you the diff. Because implementation is always split across Thor and Tyr, you get a fast implementation and a high-quality review without paying the flagship-model cost for the whole job.

For very small, mechanical tasks, use Heimdall instead:

```
@heimdall rename `getUserById` to `findUserById` across the repo
@heimdall add a CHANGELOG entry for the v1.2 release
```

Heimdall is free (DeepSeek Flash) and is the right agent for file operations, renames, and boilerplate.

## How Odin decomposes a request

When you give Odin a request, it goes through five stages:

1. **Classify** — is this read-only (Frigg), research (Mimir), simple (Heimdall), moderate (Thor), complex (Tyr), or ambiguous (Vör)?
2. **Decompose** — break the request into independent work streams. A "build a login page" request might split into: backend route, frontend form, validation logic, tests.
3. **Dispatch** — fire 2+ subagent `task` calls in a single message. The calls run in parallel; you don't pay wall-clock time for the slowest one twice.
4. **Audit (sometimes)** — for Tier 4 or Tier 5 work (Tyr or Vidarr), Odin dispatches the plan to Forseti first. Forseti reviews the plan and either approves, requests changes, or rejects. The plan only executes after Forseti signs off.
5. **Synthesize** — collect the parallel results, resolve conflicts, and respond to you as a single coherent answer.

A `task` invocation looks roughly like this inside Odin's context:

```
→ task(subagent_type="thor", prompt="Implement /healthz endpoint. Use Hono. Return JSON {status:'ok'}. Add a vitest test.")
→ task(subagent_type="tyr", prompt="Review the /healthz design. Add an integration test that boots the server and curls /healthz.")
```

Odin fires both in one message. The results come back in the order they finish. You see a single synthesized answer.

## A worked example

Say you ask: **"Add rate limiting to the /api/posts endpoint."**

Odin classifies the request as **moderate implementation with a security angle**. It decomposes:

- **Stream A** (Thor, M2.7): Implement a sliding-window rate limiter middleware. Wire it into `/api/posts`. Add a unit test.
- **Stream B** (Tyr, M3): Review the rate limit math, suggest a token-bucket alternative, write a load test that exercises the limiter.

Odin dispatches both, then synthesizes:

> Thor added a sliding-window limiter (100 req / min per IP) at `src/middleware/rateLimit.ts:14`, wired into `/api/posts` at `src/routes/posts.ts:42`, with a vitest unit test at `tests/rateLimit.test.ts:9`. Tyr's review recommends a token-bucket alternative for bursty traffic; a load test at `tests/load/rateLimit.load.ts` confirms 100 req/min holds under 200 concurrent clients. Both implementations pass `npm test`.

The actual work was done in parallel. You didn't pick a model. You didn't pick an agent. You described the outcome and Odin handled the rest.

## When to invoke agents directly

The agents listed above (`@frigg`, `@mimir`, `@thor`, etc.) are *also* first-class agents you can invoke by name. You don't have to go through Odin. Use direct invocation when:

- You know exactly which agent you want and the routing is obvious.
- You're chaining calls and don't want Odin re-classifying each step.
- You're debugging a routing decision and want to see what a specific agent does.

Going through Odin (the default) is the right call for any non-trivial request because Odin will decompose it, run the streams in parallel, and synthesize the result.

## Slash commands

BizarHarness also exposes a large set of slash commands. Try `/help` to see them all, or jump to [Commands Reference](Commands-Reference) for the full list. A few to know:

- `/plan new <slug>` — open the visual plan canvas for a new feature or change.
- `/visual-plan on` — toggle the agent to auto-create plans on complex tasks.
- `/init` — detect the project stack and create `.bizar/PROJECT.md`.
- `/explain` — route the current question to Frigg for a read-only answer.
- `/tdd` — enforce TDD with 80%+ coverage.
- `/verify` — run the full verification loop (build, typecheck, lint, test, security).
- `/tailscale-serve` — expose a local port on your tailnet via Tailscale MagicDNS.

## MagicDNS hosting (optional)

If you want to expose a local service on your tailnet (e.g. a dev dashboard, a test API, a local preview server), use `/tailscale-serve`:

```
# 1. Start your local service on a port (e.g. 8765)
npm run dev  # or any server

# 2. In opencode, type:
/tailscale-serve 8765
```

If Tailscale Serve is already enabled on your tailnet, the command prints the `https://<magicdns>/` URL. If not, it prints the admin-enable URL — visit it once from any tailnet device, then re-run `/tailscale-serve`.

For the HTTP fallback (no admin enable), bind your service to `0.0.0.0:<port>` and reach it at `http://<magicdns>:<port>/` (safe inside the tailnet because all traffic is WireGuard-encrypted).

## Next steps

Next: [Architecture](Architecture) — the Norse-pantheon metaphor, the 5-tier model architecture, and the Odin router in detail.
