---
name: read-the-damn-docs
description: When using a library, tool, or API you don't fully understand, READ THE DOCS before guessing. Don't infer behavior from function names. The source of truth is the official documentation and source code, not your prior assumptions.
version: 1
---

# Read the Damn Docs

When you reach for a library, tool, or API you haven't used recently (or ever), **read the actual documentation** before writing code. Don't guess. Don't infer from function names. Don't assume "it probably works like X". The source of truth is the docs, then the source code, then examples. Everything else is noise.

## Why this skill exists

LLMs are confidently wrong. They have a strong prior for "this is what libraries usually look like" — and that prior is sometimes right but often subtly wrong. Common failure modes:

- "The function is called `parseFoo` so it probably takes a string and returns an object" — wrong, it takes `{format, version}` and returns a promise
- "I'll just try it and see what error comes back" — wastes a turn, often hallucinates the fix
- "The README has an example, that's enough" — examples are cherry-picked; edge cases will bite you

The fix: spend 30-90 seconds reading the docs first. The cost is a single tool call. The benefit is a correct first attempt.

## Hierarchy of truth

When resolving how a library/tool/API works, use this priority order:

1. **Official documentation** (the canonical reference) — most authoritative
2. **Source code** (the actual implementation) — definitive when docs are vague
3. **Examples** (in the docs or repo) — show typical use, but don't trust edge cases
4. **StackOverflow / GitHub issues** — useful for known footguns
5. **Your prior model** — last resort, often wrong

**Stop at step 1 unless the docs are unclear.** If they are, drop to step 2.

## Practical workflow

```
1. IDENTIFY: "I'm about to use library X for the first time (or first time in months)"
2. READ: webfetch the official docs for the specific function/method I'll call
   - Don't read the entire docs — read the specific section
3. VERIFY: cross-check against source if anything is ambiguous
4. NOTE: write down durable gotchas in the relevant project documentation
5. USE: now write the code, knowing the actual API
```

## When to invoke this skill

Use it whenever:

- You're using a library you haven't touched in this session
- You're using a function/method whose exact signature you don't remember
- The function name is misleading or you have low confidence
- You're upgrading to a new major version of a library
- You're switching between similar libraries (axios vs fetch, etc.)
- You're using a CLI tool you don't have muscle memory for
- You're hitting an error you don't recognize and "guessing" the fix

## Anti-patterns

### "I'll just try it"

Don't write code, run it, see the error, and fix from there. That works for trivial cases but burns turns on anything non-trivial. Read the docs first.

### "The function name tells me what it does"

`Array.prototype.flatMap`, `Promise.allSettled`, `fs.opendirSync` — names are hints, not specs. The actual behavior (sync vs async, return shape, error cases) is in the docs.

### "I used this library before, I know it"

Libraries change. APIs deprecate. Defaults shift. Even if you used something 6 months ago, a quick doc check (30 seconds) saves 10 minutes of debugging when your prior knowledge is stale.

### "The README example is enough"

README examples are demos, not documentation. They show one happy path. The real API has edge cases, error modes, and options that aren't in the example.

### "The error message is enough to fix it"

Sometimes. But error messages are often misleading or incomplete. Reading the docs for the function that errored often reveals the actual constraint.

## Examples

### Good: Read first

```
[Agent wants to use the Vite `defineConfig` API for the first time]
Agent: "Let me check the Vite docs for the exact shape of `defineConfig`."
[webfetch https://vitejs.dev/config/]
Agent: "OK, `defineConfig` accepts a UserConfig object with `plugins`, `build`, etc.
       I need a `define` key for compile-time constants."
[Writes correct config]
```

### Bad: Guess

```
[Agent wants to use the Vite `defineConfig` API for the first time]
Agent: "defineConfig is probably a function that takes a config object with
       common options like plugins and build. Let me just write it."
[Writes config with `define: { __VERSION__: '1.0' }`]
[Runs vite build, gets a warning about an unexpected option]
Agent: "Hmm, the docs must have changed. Let me guess it's a different syntax."
[Wastes 2-3 turns guessing before reading the docs]
```

## Where to read

- **Webfetch** the official docs URL: `webfetch <url>` — fast, gives you the actual current docs
- **Source code** via Semble search: `semble search "functionName" <repo>` — useful when docs are vague
- **Local docs** if available: `semble search "<query>" --content docs` for the project's own docs

## See also

- repository docs — write postmortems and durable patterns under version control
- [[glyph]] — create a glyph when the design decision is non-trivial
- The agent baseline — `simplest thing that works` rule
