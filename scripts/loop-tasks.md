# Overnight Dashboard Loop — Task Queue

Each task is bounded, atomic, safe. Tasks execute in order. After each task:
1. Run `npm run typecheck` (must pass).
2. Run `npm run build:dash` (must pass).
3. Run `cd /home/drb0rk/projects/BizarHarness/bizar-dash && npx vitest --run` (new tests must pass; pre-existing failures are tolerable).
4. Run `node --test` on the new test file.
5. Commit atomically with conventional-commit message.
6. Loop to next task.

Stop conditions:
- 3 consecutive typecheck failures → halt.
- Build size grows >10% in any single commit → halt.
- 5 consecutive tasks with no new test passing → halt.

## Task Queue

### Priority 1 — ErrorState coverage (highest signal wins)

1. **BackgroundJobs error state** — `BackgroundJobs/BackgroundJobsView.tsx` lacks error/empty handling. Add `<ErrorState>` when fetch fails, `<EmptyState>` when 0 jobs. **Files:** 1 source + 1 test.
2. **Schedules error state** — `Schedules/SchedulesView.tsx` lacks error/empty. **Files:** 1 + 1.
3. **LightRAG error state** — `LightRAG/LightRAGView.tsx` lacks error/empty. **Files:** 1 + 1.
4. **ClaudeSessionDetail error state** — `ClaudeSessions/ClaudeSessionDetail.tsx` lacks error/empty. **Files:** 1 + 1.

### Priority 2 — Loading skeletons on first paint

5. **BackgroundJobs skeleton** — render `<Skeleton>` rows while `loading=true`. **Files:** 1 + 1.
6. **Schedules skeleton** — same. **Files:** 1 + 1.
7. **LightRAG skeleton** — same. **Files:** 1 + 1.

### Priority 3 — A11y label sweeps

8. **Auth inputs labels** — `Auth/AuthView.tsx` likely has unlabeled inputs. Wrap each in `<label>` or set aria-label. **Files:** 1 + 1.
9. **LightRAG inputs labels** — same sweep. **Files:** 1 + 1.
10. **BackgroundJobs action buttons** — sweep for unlabeled buttons. **Files:** 1 + 1.

### Priority 4 — Inline-style → primitive migrations

11. **Topbar Popover content** — replace inline styles in `Topbar.tsx:144-194` (PopoverContent) with design-system `Menu/MenuItem`. **Files:** 1 + 1.
12. **Sidebar section header styles** — `Sidebar.tsx:362-414` section toggle visual. **Files:** 1 + 1.

### Priority 5 — Keyboard / interaction polish

13. **Focus trap on Modals** — `NewSessionModal.tsx` + Sheet components. Verify ESC closes; ensure focus is trapped inside. **Files:** 1 + 1.
14. **Palette keyboard nav** — verify arrow keys cycle results in `AppCommandPalette.tsx`. **Files:** 1 + 1.

### Priority 6 — Token / color hygiene

15. **Inline hex colors** — search for `#[0-9a-f]{3,6}` in view files; replace with `var(--*)` tokens. **Files:** multi.
16. **Hardcoded px → space tokens** — search for inline `padding: 4` / `8` / `12` in views; map to `var(--space-*)`. **Files:** multi.

### Priority 7 — Test coverage for existing primitives

17. **Banner tone variants test** — covers all 4 tones. **Files:** 1 test only.
18. **StatTile loading test** — covers loading=true vs false. **Files:** 1 test only.
19. **ErrorState retry callback test** — Retry button calls onRetry. **Files:** 1 test only.
20. **Skeleton height test** — assert height prop passes through. **Files:** 1 test only.

### Priority 8 — Doc/diagnostic surfaces

21. **Doctor route data test** — fetch `/api/doctor`, assert shape. **Files:** 1 test only.
22. **Update route channels test** — `/api/update?channel=beta|stable` returns. **Files:** 1 test only.

### Priority 9 — Deletion candidates (small files, no consumers)

23. Audit `bizar-dash/src/web/v8/views/__tests__/` for orphan tests and delete any referencing deleted files. **Files:** test deletes.
24. Same for `bizar-dash/tests/*.test.{mjs,ts,tsx}` referencing deleted components. **Files:** test deletes.

### Priority 10 — Visual polish

25. **Theme tokens: add --color-success-bg / --color-warning-bg** for inline tonal backgrounds. **Files:** globals.css + 1 test.
26. **Density-aware spacing** — switch `var(--space-*)` to density-aware variants in compact mode. **Files:** 1 + 1.
27. **Sidebar collapse animation** — add 200ms ease transition to width. **Files:** 1 + 1.

## Notes

- All tasks touch only `bizar-dash/src/web/v8/` + `bizar-dash/tests/` + `bizar-dash/src/web/v8/ui/styles/`.
- No server-side changes. No API contract changes. No new deps.
- Pre-existing vitest failures (App, artifacts, changelog, Doctor, Diagnostics tests) — leave alone.
