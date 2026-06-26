/**
 * read-glyph-feedback.test.ts
 *
 * Tests for `readGlyphFeedback` — the pure read function extracted
 * from `read-glyph-feedback.ts`. Mirrors the style of
 * `bg-get-comments.test.ts` so future readers can compare them
 * side-by-side.
 *
 * Groups (8 tests):
 *   1. invalid slug              — returns ok:false
 *   2. missing feedback.md       — returns ok:true, found:false
 *   3. valid feedback file       — parses frontmatter + body
 *   4. commentCount / questionCount parsed as integers
 *   5. malformed frontmatter     — falls back to raw body
 *   6. multi-line body preserved verbatim
 *   7. empty file                — found:false-equivalent? Actually returns ok:true, found:true, empty meta
 *   8. feedback file with comments + Q&A sections round-trips correctly
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readGlyphFeedback } from "../../src/tools/read-glyph-feedback.js";

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

let worktree: string;

beforeAll(() => {
  worktree = mkdtempSync(join(tmpdir(), "bizar-feedback-test-"));
});

afterAll(() => {
  if (worktree) {
    rmSync(worktree, { recursive: true, force: true });
  }
});

function writeFeedback(slug: string, body: string): void {
  const dir = join(worktree, "artifacts", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "feedback.md"), body, "utf-8");
}

const SAMPLE_FEEDBACK = `---
glyph: sample-plan
submittedAt: 2026-06-26T18:00:00.000Z
submittedBy: drb0rk
commentCount: 2
questionCount: 1
---

# Feedback for Sample Plan

## Free-placed comments
- (240, 120) — drb0rk: Make this button say Send link instead of Continue
- (165, 2121) — drb0rk: test

## Open-question answers
### Q: Rate-limit per IP or per email?
A: Per email

(kind: choice)

## Full MDX source
\`\`\`mdx
---
title: "Sample Plan"
status: review
---

# Hello
\`\`\`
`;

// ---------------------------------------------------------------------------
// Group 1 — invalid slug
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — invalid slug", () => {
  it("rejects uppercase slugs", () => {
    const result = readGlyphFeedback(worktree, "INVALID");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid slug");
      expect(result.slug).toBe("INVALID");
    }
  });

  it("rejects path-traversal slugs", () => {
    const result = readGlyphFeedback(worktree, "../etc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid slug");
    }
  });

  it("rejects empty slugs", () => {
    const result = readGlyphFeedback(worktree, "");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — missing feedback.md
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — missing feedback.md", () => {
  it("returns ok:true, found:false when the file does not exist", () => {
    const result = readGlyphFeedback(worktree, "no-feedback-yet");
    expect(result.ok).toBe(true);
    if (result.ok && !result.found) {
      expect(result.found).toBe(false);
      expect(result.slug).toBe("no-feedback-yet");
      expect(result.message).toContain("No feedback.md");
    } else {
      throw new Error("expected found:false");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3 — valid feedback file
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — valid feedback file", () => {
  it("parses frontmatter and body", () => {
    const slug = "valid-feedback";
    writeFeedback(slug, SAMPLE_FEEDBACK);
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.meta.glyph).toBe("sample-plan");
      expect(result.meta.submittedBy).toBe("drb0rk");
      expect(result.body).toContain("# Feedback for Sample Plan");
      expect(result.body).toContain("(240, 120)");
      expect(result.body).toContain("A: Per email");
    } else {
      throw new Error("expected found:true");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4 — counts parsed
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — counts parsed as integers", () => {
  it("returns commentCount and questionCount as numbers", () => {
    const slug = "counts-feedback";
    writeFeedback(slug, SAMPLE_FEEDBACK);
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.commentCount).toBe(2);
      expect(result.questionCount).toBe(1);
      expect(typeof result.commentCount).toBe("number");
      expect(typeof result.questionCount).toBe("number");
    } else {
      throw new Error("expected found:true");
    }
  });

  it("treats missing counts as 0", () => {
    const slug = "no-counts-feedback";
    writeFeedback(slug, "---\nglyph: x\n---\n\nbody\n");
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.commentCount).toBe(0);
      expect(result.questionCount).toBe(0);
    } else {
      throw new Error("expected found:true");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5 — malformed frontmatter
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — malformed frontmatter", () => {
  it("returns the raw text as body when frontmatter delimiters are missing", () => {
    const slug = "no-frontmatter";
    writeFeedback(slug, "Just a plain markdown body\nwith two lines\n");
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.meta).toEqual({});
      expect(result.body).toContain("Just a plain markdown body");
      expect(result.commentCount).toBe(0);
      expect(result.questionCount).toBe(0);
    } else {
      throw new Error("expected found:true");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 6 — body preserved verbatim
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — body preserved verbatim", () => {
  it("preserves multi-line bodies including fenced code blocks", () => {
    const slug = "verbatim-feedback";
    const longBody = "Line 1\nLine 2\n```ts\nconst x = 1;\n```\nLine 4\n";
    writeFeedback(slug, `---\nglyph: x\ncommentCount: 0\nquestionCount: 0\n---\n\n${longBody}`);
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      expect(result.body).toContain("const x = 1;");
      expect(result.body).toContain("Line 4");
    } else {
      throw new Error("expected found:true");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 7 — round-trip
// ---------------------------------------------------------------------------

describe("readGlyphFeedback — round-trip", () => {
  it("a feedback.md containing comments + Q&A + MDX source round-trips", () => {
    const slug = "roundtrip";
    writeFeedback(slug, SAMPLE_FEEDBACK);
    const result = readGlyphFeedback(worktree, slug);
    expect(result.ok).toBe(true);
    if (result.ok && result.found) {
      // Free-placed comments section
      expect(result.body).toMatch(/## Free-placed comments/);
      expect(result.body).toContain("(240, 120)");
      expect(result.body).toContain("Send link");
      // Open-question answers section
      expect(result.body).toMatch(/## Open-question answers/);
      expect(result.body).toContain("A: Per email");
      // Full MDX source section
      expect(result.body).toMatch(/## Full MDX source/);
      expect(result.body).toContain("```mdx");
      // Counts
      expect(result.commentCount).toBe(2);
      expect(result.questionCount).toBe(1);
      // feedbackFile path is the worktree path
      expect(result.feedbackFile).toBe(join(worktree, "artifacts", slug, "feedback.md"));
    } else {
      throw new Error("expected found:true");
    }
  });
});