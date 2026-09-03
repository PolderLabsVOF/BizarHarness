/**
 * ambiguity/index.ts — Barrel re-exports for the ambiguity module.
 *
 * Mirrors the pattern used by `packages/sdk/src/autonomy/index.ts`:
 * consumers can `import { ... } from "@polderlabs/bizar-sdk/ambiguity"`
 * without caring about internal file layout.
 */

export {
  AMBIGUITY_SCHEMA_VERSION,
  AMBIGUITY_WEIGHTS,
  AMBIGUITY_DIMENSIONS,
  computeAmbiguity,
  type AmbiguityDimension,
  type AmbiguityInput,
  type AmbiguityKind,
  type AmbiguityScore,
} from "./score.js";
