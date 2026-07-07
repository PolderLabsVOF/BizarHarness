# Stop and Research Rule

## The Problem

LLM agents default to a "try again with a slight variation" loop when they are uncertain. They guess file paths, invent API names, mutate code they do not understand, and burn tokens retrying near-identical tool calls. The fix is always available: stop, use a research tool, learn something, then act.

## The Rule

**When uncertain or stuck, STOP. Research. Then act.**

### The Three Phases

Every stuck situation must move through these phases in order:

1. **Attempt (max 2 tries).** Try your best guess once or twice. If both fail or you are not confident in the result, stop. Do not attempt a third variation.
2. **Research (mandatory before retry #3).** Use the available tools to learn:
   - `semble search "<concept>"` for codebase patterns
   - `webfetch` for official documentation
   - `read` for related files in the repo
   - `obsidian_search` for prior project context
   - `skill <name>` for domain-specific guidance
   - Ask the user if you are still uncertain after research
3. **Act with confidence.** After research, make one decisive attempt. If it still fails, return to phase 2 with the new information. Never return to phase 1.

### Recognition Triggers

You are stuck if any of these are true:

- You are about to make the same tool call with slightly different arguments
- You do not know which file contains the relevant code
- The error message is unfamiliar
- The user gave a goal but no clear path
- You are guessing at API signatures, config keys, or command syntax
- Multiple valid approaches exist and you do not know which is correct
- Your previous two attempts produced the same outcome

### Hard Bans

Never do any of the following:

- Try the same approach 3 or more times. Research after the second failure.
- Guess at file paths without searching
- Invent API names, method signatures, or config keys
- Modify code you do not understand
- Continue a plan after the user has corrected you
- Pretend to be making progress when you are actually looping

### Examples

**BAD:** Agent needs to call the project's authentication helper.
> "Let me try `auth.login()`. Nope, not exported. Maybe `auth.signIn()`? No. Try `authenticate()`? Hmm. Let me look for `Login`... `User.auth()`? Actually let me try `userLogin()`..."

**GOOD:** Agent needs to call the project's authentication helper.
> Searched the codebase: `semble search "authentication helper"` returned `src/auth/session.ts` exporting `createSession()`. Calling `createSession({ userId })` next.

**BAD:** Agent is debugging a build failure.
> "Error: ENOENT: no such file. Let me try creating `./config.json`. Failed. Try `./src/config.json`. Failed. Try `./app/config.json`. Failed. Let me try `process.cwd()`..."

**GOOD:** Agent is debugging a build failure.
> `semble search "config path"` and `read package.json` both show configs live in `config/`. The build script runs from the repo root, so the path is `config/<name>.json`. Fixing the import next.

### Loop Guard Is The Last Resort

The runtime loop guard in `cline.json` (`loopThresholdWarn: 5`, `loopThresholdEscalate: 8`, `loopThresholdBlock: 12`) is a safety net for when this rule fails. It is not the primary defense.

If the loop guard fires, the rule failed first. Agents must self-correct before the guard kicks in. A trigger at 5 identical calls means the agent should have stopped at 2 and researched.

## Enforcement

Non-compliance looks like: 3+ similar tool calls in a row, repeated variations of the same failed command, "let me try X... nope... let me try Y..." narration, and increasing token spend with no progress. If you catch yourself doing this, stop, run a research tool, and act on the result.
