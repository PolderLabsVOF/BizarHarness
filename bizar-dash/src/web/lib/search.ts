// src/web/lib/search.ts — fuzzy search with typo tolerance (Levenshtein distance).
// Provides SearchableItem/SearchResult types and a fuzzySearch function for
// settings, commands, and any structured UI search.

export interface SearchableItem {
  key: string;
  label: string;
  section: string;
  value?: string | number | boolean;
  description?: string;
}

export interface SearchResult extends SearchableItem {
  score: number;
  matchedField: 'label' | 'value' | 'description';
  matchedTerm: string;
}

/**
 * Levenshtein distance for typo tolerance.
 */
export function levenshtein(a: string, b: string): number {
  const alen = a.length;
  const blen = b.length;
  const matrix: number[][] = Array.from({ length: blen + 1 }, () => Array(alen + 1).fill(0));
  for (let i = 0; i <= alen; i++) matrix[0][i] = i;
  for (let j = 0; j <= blen; j++) matrix[j][0] = j;
  for (let j = 1; j <= blen; j++) {
    for (let i = 1; i <= alen; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator,
      );
    }
  }
  return matrix[blen][alen];
}

/**
 * Score a single field against the query.
 * Returns a numeric score (higher = better match) or 0 if no match.
 *
 * Scoring tiers (mutually exclusive — first match wins):
 *   100 — exact field match (query === field)
 *    90 — field starts with query (prefix match)
 *    80 — a word in the field starts with query (word boundary)
 *    40 — typo-tolerant match (Levenshtein ≤ 2 against the first query.length chars)
 *    30 — substring match anywhere in field (fallback)
 */
export function scoreField(query: string, field: string): number {
  // Exact match
  if (field === query) return 100;

  // Field prefix match (field starts with query)
  if (field.startsWith(query)) return 90;

  // Word boundary match (any word starts with query)
  const words = field.split(/\s+/);
  for (const word of words) {
    if (word.startsWith(query)) return 80;
  }

  // Typo tolerance: compare query against first query.length chars of field
  const compareLen = Math.min(query.length, field.length);
  const dist = levenshtein(query, field.substring(0, compareLen));
  if (dist <= 2) return 40;

  // Substring match (anywhere)
  if (field.includes(query)) return 30;

  return 0;
}

/**
 * Fuzzy search over an array of SearchableItem.
 * Returns results sorted by descending score. Empty query returns [].
 */
export function fuzzySearch(query: string, items: SearchableItem[]): SearchResult[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  return items
    .map((item) => {
      const labelScore = scoreField(q, item.label.toLowerCase());
      const valueScore = item.value ? scoreField(q, String(item.value).toLowerCase()) : 0;
      const descScore = item.description ? scoreField(q, item.description.toLowerCase()) : 0;

      const max = Math.max(labelScore, valueScore, descScore);
      if (max === 0) return null;

      const matchedField: SearchResult['matchedField'] =
        labelScore >= valueScore && labelScore >= descScore
          ? 'label'
          : valueScore >= labelScore && valueScore >= descScore
            ? 'value'
            : 'description';
      const matchedTerm =
        matchedField === 'label'
          ? item.label
          : matchedField === 'value'
            ? String(item.value)
            : item.description!;

      return {
        ...item,
        score: max,
        matchedField,
        matchedTerm,
      };
    })
    .filter((r): r is SearchResult => r !== null)
    .sort((a, b) => b.score - a.score);
}
