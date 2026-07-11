/**
 * router/memory-distillation-shim.mjs — runtime-only ESM re-export of
 * `memory-distillation.ts` so the `memory_distill` MCP tool can
 * dynamically `import()` the pipeline without taking a static
 * dependency on the heavier consolidation logic.
 *
 * v6.4.0 — F-033 (Self-Learning, ADR-174). Lives next to its sibling
 * `memory-distillation.ts`; the parent keeps the strict TS surface,
 * this shim keeps the runtime import ESM-clean for the MCP tool.
 */

export {
  runDistillation,
  retrieve,
  judge,
  distill,
  PROVENANCE_TIERS,
} from "./memory-distillation.js";