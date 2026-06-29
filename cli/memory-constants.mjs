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
