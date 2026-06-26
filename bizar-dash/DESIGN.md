# Chat UI — Design Spec

> Implementation reference for the chat UI overhaul. The detailed audit is at `/tmp/opencode/chat-ui-deep-audit.md`. This file is the brief — read the audit for line-level detail.

## Vision

A focused, dark, modern chat surface — Gemini-Advanced-inspired. Sessions and info panels slide out of the way when the conversation matters; the thread dominates with a floating pill composer and a personal greeting on first run. The aesthetic is calm and minimal: pure dark surfaces, gradient text accents on the greeting, suggestion cards as the entry point.

Reference: the Gemini Advanced "Hello, [name]. How can I help you today?" screen.

## Aesthetic direction

**Gemini-inspired dark minimalism** — Pure dark surfaces (#0e0e10 baseline), thin hairlines, large display typography for the greeting with gradient color accents (blue→purple for "Hello,", pink→red for the name), suggestion cards as the entry point, pill-shaped floating composer anchored at the bottom. No gradients on surfaces. No glassmorphism. No decorative motion — only functional state changes.

## Tokens (extended from existing main.css:101-188)

```
--surface-0: #0e0e10     (page bg — pure dark, NOT pure black)
--surface-1: #18181b     (cards, raised surfaces)
--surface-2: #27272a     (hover, active)
--border:    rgba(255, 255, 255, 0.08)
--border-strong: rgba(255, 255, 255, 0.16)
--text:      #ececf1
--text-muted: #8e8ea0
--accent:    #8b5cf6     (existing purple)
--gradient-hello: linear-gradient(90deg, #4285f4 0%, #8b5cf6 100%)  /* blue → purple */
--gradient-name:  linear-gradient(90deg, #c084fc 0%, #ec4899 50%, #ef4444 100%)  /* purple → pink → red */
--success | --warning | --error | --info  (semantic, oklch)
--radius-sm 6px | --radius-md 10px | --radius-lg 14px | --radius-pill 999px
--motion-fast 120ms | --motion-base 200ms | --motion-slow 320ms
--motion-ease cubic-bezier(0.2, 0, 0, 1)
--space-1..12 (8pt grid)
```

## Layout (responsive grid)

| Width        | Sessions | Thread | Info |
|--------------|----------|--------|------|
| ≥1200px      | 240px col| 1fr    | 280px col |
| 768–1199px   | 240px col| 1fr    | drawer overlay |
| <768px       | sheet overlay | full | sheet overlay |

Panels collapse via **transform: translateX + opacity** (NOT `display: none`) for smooth motion.

## Composer — distinctive feature

**Floating pill composer**, anchored at the bottom of the thread column, max-width 720px centered horizontally. Pill shape (`border-radius: 999px`). Surfaces up over content on scroll. Internal layout: agent select chip + model badge on the left, textarea (auto-grow, max 240px), image-attach + mic + send on the right.

When session panel is open, composer offsets to the right by `240px`. When info panel is open, composer offsets to the left by `280px`. When both closed, composer is centered.

## First-run greeting (when no messages)

A large welcome state in the center of the thread:
- **Greeting**: "Hello, [user.name]." — first word in `--gradient-hello`, bracketed name in `--gradient-name`. Display size (clamp(2.5rem, 5vw, 4rem)). Inline serif or Inter ExtraBold.
- **Subtitle**: "How can I help you today?" — large but muted (`--text-muted`), clamp(1.5rem, 3vw, 2.25rem).

## Suggestion cards (first-run only)

A horizontal row of 4 cards below the greeting. Each card:
- Dark surface (`--surface-1`) with `--border` hairline
- Title (semibold, 14px) — example: "Help me debug a TypeScript error"
- Sample response preview (smaller, `--text-muted`, max 3 lines truncated)
- Click → fills the composer with that prompt
- Hover: lift (`transform: translateY(-2px)`) + border-strong

If no active project, replace with "Pick a project to scope chat sessions" CTA.

## Components (TSX — all already exist from initial refactor)

- **ChatBubble** — existing; no change
- **Composer** — REFACTOR: pill shape, floating at bottom, internal layout updated
- **SessionList** — existing; no change
- **InfoPanel** — existing; reduce 4-card repetition
- **EmptyState** — REPLACE for first-run with new `<FirstRunGreeting>` + `<SuggestionCards>` components
- **LoadingSkeleton** — existing; no change
- **StreamingIndicator** — existing; no change
- **ConfirmModal** — existing; no change

## New components to add

- **FirstRunGreeting** — shows when sessionId is empty AND messages.length === 0 AND activeProject exists. Renders the gradient greeting + subtitle.
- **SuggestionCards** — 4 hardcoded prompts. Reads activeProject to customize if applicable. Click → fills composer text via callback.
- **FloatingComposer** — wrapper around Composer that handles the pill positioning and panel-offset behavior.

## Critical bugs (carry-over from initial overhaul)

1. Sessions panel toggle uses `display: none` — fix to transform/opacity
2. `chat-info-hidden` class has no CSS — add proper hide rules
3. Mobile responsive at <768px should use overlay sheets (still TODO from E2E)
4. `prefers-reduced-motion` should apply to chat panel transitions

## Anti-pattern bans (impeccable enforcement)

- NO gradient on surfaces (gradients are text-only)
- NO glassmorphism / blur on chat panels
- NO drop shadows on cards (use border + surface elevation)
- NO generic card grids (InfoPanel reduced to 3 cards, suggestion cards are not "generic grid")
- NO gratuitous motion (only functional state transitions)
- NO emoji in UI text

## Implementation split

### Tyr (CSS — disjoint from Thor)

Modify:
- `bizar-dash/src/web/styles/chat.css` — apply surface tokens, pill composer, suggestion cards CSS, first-run greeting CSS, panel-toggle fix, mobile overlays
- `bizar-dash/src/web/styles/main.css` lines 100-220 — extend surface tokens with Gemini-inspired values
- `bizar-dash/src/web/styles/main.css` ~220 — verify `@import` ordering (currently warning)
- `bizar-dash/src/web/styles/mobile-chat.css` — overlay sheet transitions

### Thor (TSX — disjoint from Tyr)

- `bizar-dash/src/web/views/Chat.tsx` — orchestrate new components, panel-offset state
- NEW: `bizar-dash/src/web/components/chat/FirstRunGreeting.tsx`
- NEW: `bizar-dash/src/web/components/chat/SuggestionCards.tsx`
- NEW: `bizar-dash/src/web/components/chat/FloatingComposer.tsx`
- Update: `bizar-dash/src/web/components/chat/index.ts` (export new components)
- Update: `bizar-dash/src/web/components/chat/Composer.tsx` (refactor for pill layout)

## Acceptance criteria

1. Composer is a pill shape (`border-radius: 999px`), anchored at bottom, max-width 720px
2. First-run greeting has gradient text on "Hello," (blue→purple) and "[name]." (purple→pink→red)
3. 4 suggestion cards appear below the greeting, clickable
4. Sessions/info panel toggles animate via transform/opacity (NOT display: none)
5. `chat-info-hidden` has actual CSS rules
6. Mobile <768px uses overlay sheets (transform-based), not vertical stack
7. `prefers-reduced-motion` applies to chat panel transitions
8. `vite build` succeeds, `tsc --noEmit` clean, `bizar test-gate` green

## Reference

- Deep audit: `/tmp/opencode/chat-ui-deep-audit.md`
- Research notes: `/tmp/opencode/chat-ui-research.md`
- Inspiration: Gemini Advanced "Hello, [name]" screen (dark minimal, gradient greeting, suggestion cards, pill composer)
- E2E screenshots: `/tmp/opencode/chat-ui-e2e/`