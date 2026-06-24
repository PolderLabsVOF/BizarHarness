/**
 * reasoning-clean unit tests (v0.6.2).
 *
 * Covers the inline-think-block stripper used by the global fetch
 * wrapper. The wrapper exists to defeat the M3-via-OpenRouter pattern
 * where the model emits its chain-of-thought in BOTH the structured
 * `reasoning` field AND inline in `message.content`. opencode's
 * openrouter SDK renders the structured field as a separate "Thought"
 * panel, but it does NOT strip the inline blocks — so the user sees
 * the same thinking twice. The wrapper post-processes the response
 * stream to drop the inline blocks.
 *
 * Tests here cover the pure functions in isolation (no opencode, no
 * fetch, no networking):
 *   1. `stripInlineThinkBlocks` — regex strip on a full string.
 *   2. The streaming `ThinkStripper` state machine — verified via the
 *      `cleanSseLine` public path (since `ThinkStripper` itself is
 *      private). Cross-chunk boundaries are the interesting case.
 *   3. `wrapFetchForReasoningCleanup` — provider routing, pass-through
 *      for non-chat-completions, and the actual JSON / SSE rewriting
 *      via a fake `fetch`.
 *
 * If the file grows beyond ~300 lines, split into multiple files
 * (one per concern).
 */

import { describe, test, expect } from "bun:test";

import {
  stripInlineThinkBlocks,
  wrapFetchForReasoningCleanup,
  type FetchLike,
} from "../src/reasoning-clean.js";

// ---------------------------------------------------------------------------
// stripInlineThinkBlocks — regex strip
// ---------------------------------------------------------------------------

describe("stripInlineThinkBlocks", () => {
  test("strips <think>…</think>", () => {
    expect(stripInlineThinkBlocks("<think>secret</think>public")).toBe("public");
  });

  test("strips <thinking>…</thinking> (the original dashboard target)", () => {
    expect(stripInlineThinkBlocks("<thinking>secret</thinking>public")).toBe("public");
  });

  test("strips <reasoning>…</reasoning>", () => {
    expect(stripInlineThinkBlocks("<reasoning>secret</reasoning>public")).toBe("public");
  });

  test("strips <ant_thinking>…</ant_thinking>", () => {
    expect(stripInlineThinkBlocks("<ant_thinking>secret</ant_thinking>public")).toBe("public");
  });

  test("consumes trailing whitespace after the close tag", () => {
    expect(stripInlineThinkBlocks("<think>x</think>\n\n  public")).toBe("public");
  });

  test("does not treat <think> as a prefix of <thinking> when the next char is 'i'", () => {
    // Regression: a naive indexOf("<think") would match the `<think` inside
    // `<thinking>` and slice past 7 chars, leaving us mid-tag. The
    // boundary check in the streaming state machine (findOpen) prevents
    // this for the streaming case; the regex here uses `\b[^>]*>` to
    // require a proper tag boundary, so it should leave `<thinking>` alone
    // when the close tag is `</thinking>`.
    const input = "<thinking>NOT STRIPPED</thinking>after";
    expect(stripInlineThinkBlocks(input)).toBe("after");
  });

  test("handles attributes inside the open tag", () => {
    expect(stripInlineThinkBlocks('<think> foo="bar" >secret</think>ok')).toBe("ok");
  });

  test("handles multiple blocks in one string", () => {
    expect(
      stripInlineThinkBlocks(
        "a<think>x</think>b<thinking>y</thinking>c<reasoning>z</reasoning>d",
      ),
    ).toBe("abcd");
  });

  test("returns input unchanged when no think tags are present", () => {
    const input = "just a normal response with no inline thinking";
    expect(stripInlineThinkBlocks(input)).toBe(input);
  });

  test("preserves content that LOOKS like a think tag but is incomplete", () => {
    // No closing tag → regex should not match (lazy quantifier needs a close).
    expect(stripInlineThinkBlocks("<think>unfinished")).toBe("<think>unfinished");
  });
});

// ---------------------------------------------------------------------------
// wrapFetchForReasoningCleanup — provider routing
// ---------------------------------------------------------------------------

/** A minimal fake `fetch` that returns a canned `Response` and records
 *  every URL it was called with. */
function makeFakeFetch(responder: (url: string) => Response): FetchLike & {
  calls: string[];
} {
  const calls: string[] = [];
  const fn: FetchLike & { calls: string[] } = Object.assign(
    async (input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      calls.push(url);
      return responder(url);
    },
    { calls },
  );
  return fn;
}

describe("wrapFetchForReasoningCleanup — provider routing", () => {
  test("passes through non-chat-completions requests", async () => {
    const fake = makeFakeFetch(
      (url) =>
        new Response("not a chat completion", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake, {
      providers: ["openrouter"],
    });
    const res = await wrapped("https://example.com/some/other/endpoint");
    expect(await res.text()).toBe("not a chat completion");
  });

  test("passes through chat-completions to a non-targeted provider", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response('{"choices":[{"message":{"content":"<think>x</think>hi"}}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake, {
      providers: ["openrouter"],
    });
    // Anthropic endpoint — not in the providers list, so no cleaning.
    const res = await wrapped("https://api.anthropic.com/v1/chat/completions", { method: "POST" });
    const body = await res.text();
    expect(body).toContain("<think>x</think>"); // unchanged
  });

  test("intercepts chat-completions to the targeted provider (openrouter)", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response('{"choices":[{"message":{"content":"<think>x</think>hi"}}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake, {
      providers: ["openrouter"],
    });
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = await res.text();
    expect(body).not.toContain("<think>");
    expect(body).toContain('"content":"hi"');
  });

  test("intercepts chat-completions to the targeted provider (minimax)", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response('{"choices":[{"message":{"content":"<thinking>x</thinking>hi"}}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake, {
      providers: ["minimax"],
    });
    const res = await wrapped("https://minimax.io/v1/chat/completions", {
      method: "POST",
    });
    const body = await res.text();
    expect(body).not.toContain("<thinking>");
    expect(body).toContain('"content":"hi"');
  });
});

// ---------------------------------------------------------------------------
// wrapFetchForReasoningCleanup — non-streaming JSON rewriting
// ---------------------------------------------------------------------------

describe("wrapFetchForReasoningCleanup — non-streaming JSON", () => {
  test("strips think blocks from a single choice", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "<think>step 1\nstep 2</think>The answer is 42.",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = JSON.parse(await res.text());
    expect(body.choices[0].message.content).toBe("The answer is 42.");
  });

  test("preserves structured reasoning field while stripping inline blocks", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  reasoning: "the structured chain of thought",
                  reasoning_details: [{ type: "reasoning.text", text: "the structured chain of thought" }],
                  content: "<think>the same text inline</think>final answer",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = JSON.parse(await res.text());
    expect(body.choices[0].message.reasoning).toBe("the structured chain of thought");
    expect(body.choices[0].message.reasoning_details).toEqual([
      { type: "reasoning.text", text: "the structured chain of thought" },
    ]);
    expect(body.choices[0].message.content).toBe("final answer");
  });

  test("returns the original response untouched when no think blocks are present", async () => {
    const original = JSON.stringify({
      choices: [{ message: { role: "assistant", content: "clean response" } }],
    });
    const fake = makeFakeFetch(
      () =>
        new Response(original, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    expect(await res.text()).toBe(original);
  });

  test("forwards the response unchanged on JSON parse error (safety net)", async () => {
    const fake = makeFakeFetch(
      () =>
        new Response("not json {{{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    expect(await res.text()).toBe("not json {{{");
  });
});

// ---------------------------------------------------------------------------
// wrapFetchForReasoningCleanup — SSE streaming
// ---------------------------------------------------------------------------

/** Build an SSE Response body from a list of event payloads (without
 *  the `data: ` prefix — the prefix is added here for convenience). */
function sseResponse(events: string[], finalChoiceIndex = 0): Response {
  const lines: string[] = [];
  for (const payload of events) {
    lines.push(`data: ${payload}`);
  }
  // Add a finish_reason on the last event so the stripper flushes.
  lines.push(
    `data: ${JSON.stringify({
      choices: [{ index: finalChoiceIndex, delta: {}, finish_reason: "stop" }],
    })}`,
  );
  lines.push("data: [DONE]");
  const body = lines.join("\n\n") + "\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Read the full text of a (possibly transformed) response body. */
async function readBodyText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("wrapFetchForReasoningCleanup — SSE streaming", () => {
  test("strips a complete think block split across multiple deltas", async () => {
    // The model emits a `<think>...</think>` block across many deltas,
    // then a clean final answer. After cleaning, only the final answer
    // should remain in the SSE stream.
    const fake = makeFakeFetch(() =>
      sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: "<think>" } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { content: "step 1. " } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { content: "step 2. " } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { content: "</think>" } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { content: "final answer" } }] }),
      ]),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = await readBodyText(res);
    expect(body).not.toContain("<think>");
    expect(body).not.toContain("</think>");
    expect(body).not.toContain("step 1.");
    expect(body).not.toContain("step 2.");
    expect(body).toContain("final answer");
  });

  test("strips a think block split ACROSS byte-level chunk boundaries", async () => {
    // Simulate a real network: the SSE body is delivered as a stream
    // of arbitrary byte chunks. The `<think>` open tag itself straddles
    // two chunks, so the `streamTransformer` must buffer the partial
    // first event until the `\n\n` boundary arrives in the second
    // chunk, then run the full event through `cleanSseLine` and
    // strip the think block.
    const sseBody =
      `data: {"choices":[{"index":0,"delta":{"content":"<th` +
      `ink>step A. step B.</think>The answer is 7."}}]}\n\n` +
      `data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}\n\n` +
      `data: [DONE]\n\n`;

    // Split the body at byte offset 80 (which lands inside the `<th`
    // open tag). The first chunk ends with the open tag half-written;
    // the second chunk starts with the rest of the open tag and
    // includes the `\n\n` boundary.
    const splitAt = 80;
    const chunk1 = sseBody.slice(0, splitAt);
    const chunk2 = sseBody.slice(splitAt);

    const fake = makeFakeFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(chunk1));
              controller.enqueue(new TextEncoder().encode(chunk2));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = await readBodyText(res);
    expect(body).not.toContain("<think>");
    expect(body).not.toContain("step A.");
    expect(body).not.toContain("step B.");
    expect(body).toContain("The answer is 7.");
  });

  test("strips <thinking> (not just <think>) in streaming mode", async () => {
    const fake = makeFakeFetch(() =>
      sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: "<thinking>step</thinking>" } }] }),
        JSON.stringify({ choices: [{ index: 0, delta: { content: "after" } }] }),
      ]),
    );
    const wrapped = wrapFetchForReasoningCleanup(fake);
    const res = await wrapped(
      "https://openrouter.ai/api/v1/chat/completions",
      { method: "POST" },
    );
    const body = await readBodyText(res);
    expect(body).not.toContain("<thinking>");
    expect(body).not.toContain("</thinking>");
    expect(body).toContain("after");
  });
});
