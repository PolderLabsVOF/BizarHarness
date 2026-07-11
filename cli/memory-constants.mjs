/**
 * cli/memory-constants.mjs
 *
 * Re-exports schema enums from the memory service for use by CLI commands.
 * The CLI cannot easily import from the dashboard ESM files at runtime
 * (different package boundaries), so this module redeclares the constants
 * locally.
 */

export const VALID_TYPES = [
  'project_overview',
  'architecture_decision',
  'coding_convention',
  'bug_pattern',
  'command',
  'api_contract',
  'dependency_note',
  'environment_fact',
  'task_summary',
  'session_summary',
  'user_preference',
  // v6.4.0 — F-033 ReasoningBank distillation pipeline (ADR-174).
  // `pattern` is emitted by `bizar-dash/src/server/memory-consolidator.mjs`
  // when a distillation run produces a promoted pattern (oracle:test-exec
  // or judge:fable tier, ≥1 contributing entry). Patterns are searchable
  // and re-feed into subsequent distillation runs as plain inputs.
  'pattern',
];

export const VALID_PROVENANCE_TIERS = [
  // Tier-1 (oracle) — observed via test execution. Eligible for promotion.
  'oracle:test-exec',
  // Tier-2 (proxy) — structural inference only. NOT eligible for
  // promotion; written to the vault but `promoted: false`.
  'proxy:structural',
  // Tier-3 (judge:fable) — cost-bounded LLM-judge path; requires
  // `BIZAR_DISTILL_BUDGET_USD > 0`. Out of scope in the $0 default.
  'judge:fable',
];

export const VALID_STATUSES = [
  'active',
  'superseded',
  'stale',
  'conflict',
  'draft',
  'archived',
];

export const VALID_CONFIDENCES = ['verified', 'inferred', 'speculative'];

export const REQUIRED_FIELDS = [
  'memory_id',
  'type',
  'project_id',
  'status',
  'confidence',
  'created',
  'updated',
  'tags',
];

export const SECRET_PATTERN_IDS = [
  'private_key_pem',
  'aws_access_key',
  'aws_secret_key',
  'github_pat_classic',
  'github_pat_fine',
  'slack_token',
  'stripe_live',
  'stripe_test',
  'bearer_token',
  'api_key_assignment',
  'absolute_path',
  'private_ipv4',
];
