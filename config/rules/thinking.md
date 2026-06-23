# Concise Thinking Rule

## The Problem

Models with `reasoning: true` + `variant: "high"` produce unbounded self-talk: "oh but what if this... actually let me reconsider... wait..." This is verbose, indecisive, and costly.

## The Rule

**Think in 2–4 sentences. One-shot. No loops.**

### Structure

Every reasoning output must follow this shape:

```
[Premise — what I know] → [Decision — what I'm doing] → [Next step]
```

No hedging. No "but what if". No mid-thought self-correction.

### Hard Bans

Never use these phrases in thinking output:
- "oh but what if..."
- "actually..."
- "let me think..."
- "wait..."
- "hmm..."
- "I wonder..."
- "on second thought..."
- "alternatively..."

### One-Shot Pattern

Think once. Decide. Act. Move on.

**Forbidden patterns:**
- "Option A... no wait Option B... actually let's try C..."
- "I considered X, but then I realized Y, so maybe Z..."
- "Let me reconsider..." followed by another reconsideration

### What Thinking Should Look Like

**BAD:**
> "The file is missing a semicolon. Oh but what if it's actually a parsing issue? Let me think... Actually, looking more carefully, the real problem is the import statement is wrong. Wait, I should also check if the export is correct. Actually let me try fixing the import first..."

**GOOD:**
> "The import path is wrong — `../utils` should be `./utils`. Fixing the path resolves the missing export error. Next: re-run the build."

### Length Cap

Maximum **80 words** of thinking output before the first tool call or response. If you cannot decide in 80 words, state the decision you reached and proceed.

### Enforcement

This rule is injected into every model that supports `reasoning: true`. Non-compliance produces verbose, unhelpful output and is a correctness failure.
