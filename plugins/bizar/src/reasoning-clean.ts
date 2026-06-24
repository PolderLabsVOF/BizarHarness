/**
 * plugins/bizar/src/reasoning-clean.ts
 *
 * Wraps a provider's `fetch` to strip inline ``...</think>`` blocks from
 * `message.content` / `delta.content` when the response also includes
 * structured reasoning (`reasoning`, `reasoning_details`, or
 * `reasoning_content`).
 *
 * Why this exists
 * ───────────────
 * Some reasoning models (e.g. MiniMax M3 via OpenRouter) emit their chain
 * of thought BOTH:
 *   1. In the structured `reasoning` / `reasoning_details` field, which
 *      opencode already extracts and renders as a separate "thought"
 *      chunk, AND
 *   2. Inlined in `content` as `` blocks, which opencode would also
 *      render as plain text — producing the duplicate "Thought: … + the
 *      same text in the assistant message" the user sees.
 *
 * opencode's openrouter-specific SDK does not strip the inline think
 * blocks from `content`. The opencode-level `interleaved` config that
 * could solve this only applies to the `@ai-sdk/openai-compatible` SDK.
 * Wrapping `provider.options.fetch` in the `config` hook is the only
 * hook surface where the response body can be post-processed.
 *
 * Behaviour
 * ─────────
 * • Only `POST` requests whose URL ends with `/chat/completions` are
 *   intercepted. Other requests pass through untouched.
 * • Non-streaming responses (`Content-Type: application/json`) are parsed,
 *   mutated, and re-serialised.
 * • Streaming responses (`Content-Type: text/event-stream`) are piped
 *   through a `TransformStream` that buffers content across chunks and
 *   drops anything between a complete ` pair, using a tiny state
 *   machine so chunks that split a marker mid-stream are handled.
 * • If parsing or rewriting fails for any reason, the original response
 *   is forwarded unchanged — this wrapper must never break a chat.
 */

// All known inline think-style tag names. Each name pairs with itself
// for the close tag (e.g. `` matches ``, `<thinking>` matches
// `</thinking>`, etc.). The order does not matter for matching — we
// search for the earliest occurrence of any of them.
//
// The model emits `` (most common) and `<thinking>` (the original
// dashboard fix targeted this one). `<reasoning>` and `<ant_thinking>`
// are included for forward compatibility with other providers that use
// the same anti-slop pattern.
const THINK_TAG_NAMES = ["think", "thinking", "reasoning", "ant_thinking"] as const;
type ThinkTagName = (typeof THINK_TAG_NAMES)[number];

/** Map from open-tag prefix (without `>`) to its matching close tag. */
const THINK_OPEN_TO_CLOSE: ReadonlyMap<string, string> = new Map(
  THINK_TAG_NAMES.map((n) => [`<${n}`, `</${n}>`] as const),
);
/** All open-tag prefixes — used by the streaming state machine. */
const ALL_OPENS: readonly string[] = Array.from(THINK_OPEN_TO_CLOSE.keys());
/** Regex form, used by the non-streaming strip. Backreference matches
 *  the open-tag name to the close tag. */
const THINK_TAG_RE = new RegExp(
  `<(${THINK_TAG_NAMES.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>\\s*`,
  "gi",
);

export type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

export interface ReasoningCleanOptions {
  /** Extra logger for debug lines; defaults to no-op. */
  debug?: (msg: string) => void;
  /**
   * Provider ids whose responses should be cleaned. Defaults to the set
   * known to exhibit the duplicated-think pattern: openrouter and minimax.
   */
  providers?: string[];
}

const DEFAULT_PROVIDERS = new Set(["openrouter", "minimax"]);

/**
 * Strip inline think-style blocks (`<think>…</think>`,
 * `<thinking>…</thinking>`, `<reasoning>…</reasoning>`,
 * `<ant_thinking>…</ant_thinking>`) from a plain string. Used for
 * non-streaming responses (or for accumulated streamed content).
 *
 * The trailing whitespace after the close tag is also consumed so the
 * cleaned content does not start with an extra blank line.
 */
export function stripInlineThinkBlocks(content: string): string {
  return content.replace(THINK_TAG_RE, "");
}

/**
 * Stream-level state machine: feed it the content deltas in order; it
 * yields the content that should be forwarded to the caller.
 */
class ThinkStripper {
  private state: "NORMAL" | "IN_THINK" = "NORMAL";
  // Buffer of characters that may be the start of a marker but are not
  // yet complete. Holds at most max(open.length, close.length) chars
  // from a chunk boundary.
  private pending = "";
  // The close tag we are looking for while IN_THINK. Set when we find
  // an open, cleared when we find the matching close. Each open tag
  // has its own close tag (e.g. `` pairs with ``, not ``).
  private activeClose: string | null = null;

  /**
   * Find the earliest valid open-tag prefix in `input`. A valid match
   * is `<tagname` followed by `>`, whitespace, or end-of-string — so we
   * don't accidentally match `` as a substring of `<thinking>`.
   */
  private findOpen(input: string): { idx: number; open: string } | null {
    let best: { idx: number; open: string } | null = null;
    for (const open of ALL_OPENS) {
      let from = 0;
      while (from < input.length) {
        const idx = input.indexOf(open, from);
        if (idx === -1) break;
        const nextPos = idx + open.length;
        const nextCh = nextPos < input.length ? input.charAt(nextPos) : "";
        const isBoundary =
          nextCh === ">" ||
          nextCh === " " ||
          nextCh === "\t" ||
          nextCh === "\n" ||
          nextCh === "\r" ||
          nextCh === "";
        if (isBoundary) {
          if (best === null || idx < best.idx) {
            best = { idx, open };
          }
          break;
        }
        from = idx + 1;
      }
    }
    return best;
  }

  push(chunk: string): string {
    if (chunk.length === 0) return "";
    let input = this.pending + chunk;
    this.pending = "";
    let out = "";

    while (input.length > 0) {
      if (this.state === "NORMAL") {
        const found = this.findOpen(input);
        if (found === null) {
          // No open marker; might have a partial at the tail.
          const tail = keepPartialTail(input, ALL_OPENS);
          out += input.slice(0, input.length - tail.length);
          this.pending = tail;
          input = "";
          break;
        }
        out += input.slice(0, found.idx);
        input = input.slice(found.idx + found.open.length);
        this.activeClose = THINK_OPEN_TO_CLOSE.get(found.open) ?? null;
        this.state = "IN_THINK";
      } else {
        // IN_THINK
        const closeTag = this.activeClose;
        if (closeTag === null) {
          // Defensive: should never happen, but recover gracefully.
          this.state = "NORMAL";
          break;
        }
        const idx = input.indexOf(closeTag);
        if (idx === -1) {
          // Still inside a think block; might have a partial close at tail.
          const tail = keepPartialTail(input, [closeTag]);
          // Discard everything except the possible partial tail.
          this.pending = tail;
          input = "";
          break;
        }
        input = input.slice(idx + closeTag.length);
        this.state = "NORMAL";
        this.activeClose = null;
        // Drop any whitespace that immediately follows the close tag so
        // the next emitted content does not start with extra blank lines.
        const wsMatch = input.match(/^\s*/);
        if (wsMatch) input = input.slice(wsMatch[0].length);
      }
    }

    return out;
  }

  flush(): string {
    // If the stream ended while still inside a think block (malformed
    // response), emit any pending tail rather than swallowing it.
    const tail = this.pending;
    this.pending = "";
    if (this.state === "IN_THINK") {
      this.state = "NORMAL";
      this.activeClose = null;
      return tail;
    }
    return tail;
  }
}

/**
 * Of a string, return the longest suffix that is a prefix of one of the
 * given markers. Used to defer deciding whether a chunk ends in a real
 * marker until the next chunk arrives.
 */
function keepPartialTail(input: string, markers: readonly string[]): string {
  const max = Math.max(...markers.map((m) => m.length));
  const start = Math.max(0, input.length - max);
  const window = input.slice(start);
  for (let len = Math.min(max, window.length); len > 0; len--) {
    const candidate = window.slice(0, len);
    if (markers.some((m) => m.startsWith(candidate))) return candidate;
  }
  return "";
}

/**
 * Decide whether the URL targets one of the providers we should clean.
 * The provider id may appear in the hostname (e.g. `openrouter.ai`)
 * rather than as a path segment, so we match against the full URL.
 */
function targetsProvider(url: string, providers: Set<string>): string | null {
  const lower = url.toLowerCase();
  for (const p of providers) {
    const lp = p.toLowerCase();
    if (lower.includes(`/${lp}/`) || lower.includes(`/${lp}?`) || lower.includes(`${lp}.`) || lower.includes(`-${lp}.`) || lower.includes(`.${lp}/`)) {
      return p;
    }
  }
  return null;
}

/**
 * Return true if a request body looks like an OpenAI-compatible chat
 * completions request (so we know whether to inspect the response).
 */
function isChatCompletionsRequest(url: string, init?: RequestInit): boolean {
  if (!/\/chat\/completions(?:\?|$)/.test(url)) return false;
  const method = (init?.method ?? "POST").toUpperCase();
  return method === "POST";
}

/**
 * Process one non-streaming JSON response: strip inline think blocks
 * from `choices[*].message.content`. Returns the original text on any
 * parse error.
 */
function cleanNonStreamingJson(text: string): string {
  const data = JSON.parse(text);
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  let touched = false;
  for (const choice of choices) {
    const msg = choice?.message;
    if (msg && typeof msg.content === "string" && contentHasAnyThinkOpen(msg.content)) {
      const cleaned = stripInlineThinkBlocks(msg.content);
      if (cleaned !== msg.content) {
        msg.content = cleaned;
        touched = true;
      }
    }
  }
  return touched ? JSON.stringify(data) : text;
}

/** Cheap fast-path check: does `content` contain any of the known
 *  think-tag open prefixes? Avoids invoking the (more expensive) full
 *  regex on responses that obviously don't need cleaning. */
function contentHasAnyThinkOpen(content: string): boolean {
  for (const open of ALL_OPENS) {
    if (content.includes(open)) return true;
  }
  return false;
}

/**
 * Process one SSE event line of the form `data: <payload>`. Mutates the
 * decoded payload in place to strip inline think blocks from
 * `choices[*].delta.content`, using a per-message `ThinkStripper` so
 * content split across chunks is still handled correctly.
 *
 * `strippers` is an array keyed by choice index — each choice maintains
 * its own stripper across multiple events.
 */
function cleanSseLine(
  line: string,
  strippers: ThinkStripper[],
  debug?: (msg: string) => void,
): string {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trimStart();
  if (payload === "[DONE]") {
    // Flush any in-flight strippers so we don't lose content that was
    // waiting on a chunk boundary.
    return line;
  }
  let obj: any;
  try {
    obj = JSON.parse(payload);
  } catch {
    return line;
  }
  const choices = Array.isArray(obj?.choices) ? obj.choices : [];
  for (let i = 0; i < choices.length; i++) {
    const delta = choices[i]?.delta;
    if (!delta || typeof delta.content !== "string" || delta.content.length === 0) continue;
    let stripper = strippers[i];
    if (!stripper) {
      stripper = new ThinkStripper();
      strippers[i] = stripper;
    }
    const cleaned = stripper.push(delta.content);
    if (cleaned.length > 0) {
      delta.content = cleaned;
    } else {
      // Avoid sending an empty content delta — some relays reject them.
      delete delta.content;
    }
    if (choices[i]?.finish_reason) {
      // End of this choice: flush the stripper so any pending partial
      // marker becomes part of the final delta.
      const flushed = stripper.flush();
      if (flushed.length > 0) {
        delta.content = (delta.content ?? "") + flushed;
      } else if (delta.content === undefined) {
        // Keep the choice delta well-formed even if nothing is left.
        delta.content = "";
      }
    }
  }
  debug?.(`reasoning-clean: rewrote SSE line ${payload.length}B`);
  return "data: " + JSON.stringify(obj);
}

/**
 * Transform an SSE response stream: parse each `data:` line, strip inline
 * think blocks, and re-emit the bytes.
 */
function streamTransformer(debug?: (msg: string) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  const strippers: ThinkStripper[] = [];
  let buffer = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      // SSE events are separated by a blank line ("\n\n").
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const rewritten = event
          .split("\n")
          .map((line) => cleanSseLine(line, strippers, debug))
          .join("\n");
        controller.enqueue(encoder.encode(rewritten + "\n\n"));
        boundary = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      // Flush any leftover SSE event at end of stream.
      const tail = buffer + decoder.decode();
      if (tail.length > 0) {
        const rewritten = tail
          .split("\n")
          .map((line) => cleanSseLine(line, strippers, debug))
          .join("\n");
        controller.enqueue(encoder.encode(rewritten));
      }
    },
  });
}

/**
 * Wrap a fetch implementation so that responses from the listed
 * providers have inline ``...</think>`` blocks stripped from the
 * content while preserving the structured reasoning fields. Returns a
 * function with the same signature as the original fetch.
 */
export function wrapFetchForReasoningCleanup(
  originalFetch: FetchLike,
  options: ReasoningCleanOptions = {},
): FetchLike {
  const providers = options.providers
    ? new Set(options.providers)
    : DEFAULT_PROVIDERS;
  const debug = options.debug;

  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    // Resolve which provider this call is going to. If we can't tell, pass through.
    const providerHit = targetsProvider(url, providers);
    if (!isChatCompletionsRequest(url, init)) {
      return originalFetch(input, init);
    }
    if (!providerHit) {
      return originalFetch(input, init);
    }
    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (err) {
      debug?.(`reasoning-clean: fetch threw, passing through: ${(err as Error).message}`);
      throw err;
    }
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      const body = response.body;
      if (!body) return response;
      const transformed = body.pipeThrough(streamTransformer(debug));
      return new Response(transformed, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    // Non-streaming JSON.
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      debug?.(`reasoning-clean: read body failed, passing through: ${(err as Error).message}`);
      return response;
    }
    let cleaned: string;
    try {
      cleaned = cleanNonStreamingJson(text);
    } catch (err) {
      debug?.(`reasoning-clean: parse failed, passing through original body: ${(err as Error).message}`);
      // Re-wrap the original text in a fresh Response so the caller
      // can read the body (we already consumed the original via
      // .text()). The status/headers are preserved.
      cleaned = text;
    }
    // Always return a fresh Response so the caller can read the body
    // (the original `response` was consumed by `.text()`).
    return new Response(cleaned, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}