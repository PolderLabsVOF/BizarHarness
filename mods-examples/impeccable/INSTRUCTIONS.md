---
name: impeccable-instructions
description: Always-on rules installed by the Impeccable mod. Impeccable detects and bans UI anti-patterns: gratuitous gradients, generic card grids, glassmorphism, the "tailwind default" look, fake-AI stock imagery.
---

# Impeccable — Installed Instructions

These rules apply whenever the **impeccable** mod is enabled. The current report (last scan) lives at `.obsidian/impeccable/last-report.json` in the project vault.

## How to Read the Last Report

At session start, check `.obsidian/impeccable/last-report.json`:

```bash
cat .obsidian/impeccable/last-report.json
```

The report lists anti-patterns detected, each with a file:line reference and a severity. You must fix every `high` severity issue before considering UI work done.

## Banned Anti-Patterns

### 1. No gratuitous gradients
- A gradient must do work (it draws the eye to a specific element, it implies depth at one specific spot). If a gradient is decoration over a flat surface, remove it.
- Hero backgrounds, modal overlays, and CTA buttons may use gradients IF the gradient is essential to the design. Anywhere else, no.

### 2. No glassmorphism by default
- `backdrop-filter: blur(...)` and `rgba(255, 255, 255, 0.1)` overlays are not "modern UI" — they are a 2020 trend that ages badly.
- Use only when explicitly needed (e.g. a layered overlay above a busy background where legibility would suffer otherwise).
- If you reach for it without an explanation, that's a bug.

### 3. No generic card grids
- A grid of identical cards with a title + image + paragraph is the AI-default. Avoid it.
- If you need cards, vary the grid: asymmetric, mixed widths, editorial layouts, bento with breathing room.
- If the content is genuinely card-shaped (a product catalog, a settings list), the grid is fine — but make it tight, not airy.

### 4. No "tailwind default" typography
- `text-base font-sans` everywhere is not a design. It's the absence of one.
- Pick a font. Pair it. Set a type scale. Use hierarchy.
- If you find yourself using `text-sm text-gray-600` for every caption, you have not designed the page.

### 5. No fake-AI stock imagery
- No abstract gradient blobs. No purple-pink mesh gradients. No AI-generated "diverse people shaking hands" photos.
- Use real photography, real illustrations, or genuine custom artwork. If you have none, use typography and whitespace.

### 6. No emoji as UI icons
- Emoji are for chat, not for navigation. Use a real icon set (lucide, heroicons, tabler, phosphor).
- If you need a custom mark, design one. Do not paste a 🏠 for "Home".

### 7. No carousel heroes
- Carousel heroes are an admission that you don't know what to put first. Pick one thing. Show it.

## Rules by Agent

### @baldr (design system / DESIGN.md)
- Every DESIGN.md you ship must include an "Anti-patterns banned" section that lists each of the 7 above and explains the project's specific stance.
- If you find yourself describing a "subtle gradient overlay" or "clean card grid", stop. That's not a design direction. Commit to one aesthetic.

### @thor (medium-complexity implementation)
- Before merging any UI change, run a self-audit: search the diff for the banned patterns. If any are present, justify them in your summary or remove them.
- Read `.obsidian/impeccable/last-report.json` before starting UI work. If there are `high` severity items, fix them as part of the same change.

### @tyr (complex implementation)
- Treat the 7 banned patterns as hard rules. If the user explicitly asks for one, do it — but surface the cost ("you've asked for glassmorphism on the modal; this dates the UI to 2020 unless we re-evaluate in 6 months").

### @heimdall (mechanical work)
- Skip the audit if the change is purely functional (no UI surface). If you touch any CSS or component, run the audit.

### @odin (router)
- When dispatching UI work, mention in the prompt: "Impeccable is enabled — see `.obsidian/impeccable/last-report.json` and the 7 banned anti-patterns."

## Severity Tiers

| Severity | Action |
|----------|--------|
| `critical` | Do not ship. Block the PR. |
| `high` | Fix in the same change that introduced it. |
| `medium` | Fix in the next change that touches the area. |
| `low` | Note in the report, address opportunistically. |

## Conflict Resolution

If Impeccable bans gradient overlays and the user explicitly says "add a gradient to the hero", do it — but call it out in your summary: "Added the gradient per your request; Impeccable flagged this as a `medium` anti-pattern. If you want it removed later, say so."
