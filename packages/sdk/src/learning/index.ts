/**
 * learning/index.ts — Public re-exports for the self-learning module.
 *
 * v10.1.1 — Pillar D.
 */

export {
  recordInstinct,
  listInstincts,
  promoteInstinct,
  dropInstinct,
} from "./instincts.js";

export {
  recordDecision,
  listDecisions,
  verifyChain,
  datamark,
} from "./decisions.js";

// F-194 Phase B.3 — User-input behavior capture (structural fingerprint only).
export {
  type BehaviorRecord,
  type BehaviorCapture,
  type FileBehaviorCapture,
  type WorkerBehaviorSummary,
  BEHAVIOR_DIR_MODE,
  FORBIDDEN_BEHAVIOR_KEYS,
  fingerprint64,
  validateBehaviorRecord,
  createBehaviorRecord,
  createInMemoryBehaviorCapture,
  createFileBehaviorCapture,
  summarizeBehavior,
} from "./behavior-capture.js";
