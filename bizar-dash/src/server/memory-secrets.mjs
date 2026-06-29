/**
 * src/server/memory-secrets.mjs
 *
 * Regex-based secret scanner for structured long-term memory notes.
 * Detects HIGH and MEDIUM severity patterns (API keys, tokens, private keys,
 * absolute paths, private IPv4 addresses). Designed to run before every
 * commit to prevent accidental secret leakage.
 */

/**
 * All secret patterns. severity is 'HIGH' or 'MEDIUM'.
 *
 * @type {Array<{ id: string, severity: 'HIGH' | 'MEDIUM', pattern: RegExp }>}
 */
export const SECRET_PATTERNS = [
  // HIGH severity
  { id: 'private_key_pem',    severity: 'HIGH', pattern: /-----BEGIN (RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/ },
  { id: 'aws_access_key',    severity: 'HIGH', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'aws_secret_key',    severity: 'HIGH', pattern: /\baws_secret_access_key\s*[:=]\s*[A-Za-z0-9\/+=]{40}\b/ },
  { id: 'github_pat_classic', severity: 'HIGH', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'github_pat_fine',   severity: 'HIGH', pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { id: 'slack_token',       severity: 'HIGH', pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: 'stripe_live',       severity: 'HIGH', pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { id: 'stripe_test',       severity: 'HIGH', pattern: /\bsk_test_[0-9a-zA-Z]{24,}\b/ },
  // Bearer token: refined to require base64-like chars after "Bearer "
  // and terminate on whitespace, punctuation, or end-of-string
  {
    id: 'bearer_token',
    severity: 'HIGH',
    pattern: /\bBearer\s+[A-Za-z0-9+\/=_\-]{20,}(?:\s|$|[,;.])/,
  },
  // MEDIUM severity
  {
    id: 'api_key_assignment',
    severity: 'MEDIUM',
    // Non-greedy {16,}? so the end-of-line assertion has something to match
    pattern: /\b(api[_-]?key|apikey|secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}?['"]?(?:\s*$|[,;.\n])/im,
  },
  { id: 'absolute_path',     severity: 'MEDIUM', pattern: /\/(Users|home)\/[A-Za-z0-9._-]+/ },
  { id: 'private_ipv4',      severity: 'MEDIUM', pattern: /\b(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)\b/ },
];

/**
 * Scan text for secret patterns. Returns a structured scan result.
 *
 * @param {string} text — raw text to scan (usually the full body of a note)
 * @returns {{ safe: boolean, findings: Array<{ id: string, severity: 'HIGH' | 'MEDIUM', line: number, snippet: string }> }}
 */
export function scan(text) {
  if (typeof text !== 'string') return { safe: true, findings: [] };

  const findings = [];
  const lines = text.split('\n');

  for (const { id, severity, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex each iteration for global patterns
    pattern.lastIndex = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        const snippet = line.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20);
        findings.push({ id, severity, line: lineNum + 1, snippet });
        // Only report first match per pattern per line
      }
    }
  }

  return {
    safe: findings.filter((f) => f.severity === 'HIGH').length === 0,
    findings,
  };
}

/**
 * Returns true if the scan result contains any HIGH-severity findings.
 *
 * @param {{ safe: boolean, findings: Array<{ severity: string }> }} result
 * @returns {boolean}
 */
export function hasHighFindings(result) {
  return result.findings.some((f) => f.severity === 'HIGH');
}
