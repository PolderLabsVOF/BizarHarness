/**
 * src/server/memory-schema.mjs
 *
 * Validates frontmatter against the Bizar Memory Schema. The schema requires
 * a set of standard fields (memory_id, type, project_id, status, confidence,
 * created, updated, tags) with enumerated values for type, status, and
 * confidence.
 */

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

/**
 * Validate a note's frontmatter and body against the schema.
 *
 * @param {Record<string, unknown>} frontmatter
 * @param {string} body
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateNote(frontmatter, body) {
  const errors = [];
  const warnings = [];

  if (!frontmatter || typeof frontmatter !== 'object') {
    errors.push('frontmatter must be a plain object');
    return { valid: false, errors, warnings };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in frontmatter) || frontmatter[field] === undefined || frontmatter[field] === null || frontmatter[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }

  // Type enum
  if (frontmatter.type && !VALID_TYPES.includes(frontmatter.type)) {
    errors.push(`invalid type: '${frontmatter.type}'. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // Status enum
  if (frontmatter.status && !VALID_STATUSES.includes(frontmatter.status)) {
    errors.push(`invalid status: '${frontmatter.status}'. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Confidence enum
  if (frontmatter.confidence && !VALID_CONFIDENCES.includes(frontmatter.confidence)) {
    errors.push(`invalid confidence: '${frontmatter.confidence}'. Must be one of: ${VALID_CONFIDENCES.join(', ')}`);
  }

  // Tags must be an array
  if (frontmatter.tags !== undefined && !Array.isArray(frontmatter.tags)) {
    errors.push('tags must be an array');
  }

  // memory_id format check: should be non-empty string
  if (frontmatter.memory_id && typeof frontmatter.memory_id !== 'string') {
    errors.push('memory_id must be a string');
  }

  // project_id format check
  if (frontmatter.project_id && typeof frontmatter.project_id !== 'string') {
    errors.push('project_id must be a string');
  }

  // ISO-8601 date fields
  for (const dateField of ['created', 'updated']) {
    if (frontmatter[dateField]) {
      const val = String(frontmatter[dateField]);
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(val)) {
        warnings.push(`${dateField} is not a valid ISO-8601 date: '${val}'`);
      }
    }
  }

  // Body presence check
  if (!body || !body.trim()) {
    warnings.push('body is empty — notes should have substantive content');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Build a default frontmatter object from a partial override.
 * Fills in all missing required fields with sensible defaults.
 *
 * @param {Partial<Record<string, unknown>>} partial
 * @returns {Record<string, unknown>}
 */
export function defaultFrontmatter(partial = {}) {
  const now = new Date().toISOString();
  const timestamp = Date.now();
  const type = partial.type || 'session_summary';
  const memoryId = partial.memory_id || `${type}_${timestamp}`;

  return {
    memory_id: memoryId,
    type: type,
    project_id: partial.project_id || '',
    status: partial.status || 'draft',
    confidence: partial.confidence || 'inferred',
    created: partial.created || now,
    updated: partial.updated || now,
    tags: Array.isArray(partial.tags) ? partial.tags : [],
    ...partial,
  };
}
