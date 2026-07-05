/**
 * Type declarations for `./compaction.mjs`.
 *
 * The runtime module is shipped as plain ESM JavaScript (`.mjs`) per the
 * brief, but its consumers in `index.ts` and `tests/compaction.test.ts`
 * are TypeScript. Without this companion declaration file, TypeScript
 * would type the exports as `any`, which causes cascading `implicitly
 * has 'any' type` errors at call sites (e.g. the `texts` parameter in
 * the test's `summarizer` stubs).
 *
 * The declarations here mirror the contract documented in
 * `./compaction.mjs`. They are NOT loaded at runtime — they exist only
 * for the type-checker.
 */

export interface CompactionResult {
    compacted: boolean;
    reason?: "below_threshold";
    sessionId?: string;
    threshold?: number;
    preservedRecent?: number;
    atMessages?: number;
    ratio?: number | null;
}

export interface MaybeCompactSessionOpts {
    sessionId: string;
    messageCount: number;
    currentUsage: { total?: number } | null | undefined;
    maxContext: number | null | undefined;
    summarizer: (texts: string[]) => Promise<string>;
    preserveRecent?: number;
}

export function shouldCompact(
    usage: { total?: number } | null | undefined,
    maxContext: number | null | undefined,
): boolean;

export function maybeCompactSession(opts: MaybeCompactSessionOpts): Promise<CompactionResult>;

export function getCompactionThreshold(): number;

export function setCompactionThreshold(value: number): void;

export function resetCompactionDefaults(): void;

export function getDefaultPreserveRecent(): number;