/**
 * Case-insensitive keyword matching for group message auto-cleanup.
 * Normalizes whitespace and common punctuation so "Happy Birthday!!!" matches "happy birthday".
 */

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    // strip diacritics
    .replace(/\p{M}/gu, '')
    // collapse punctuation to spaces
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a comma-separated keyword list into unique normalized phrases.
 * Empty / blank entries are dropped.
 */
export function parseKeywordList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const n = normalizeForMatch(part);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * True when `body` contains any of the normalized keywords as a whole phrase (substring match
 * on the normalized body). Single-token keywords also match when they appear as whole words.
 */
export function bodyMatchesKeywords(body: string, keywords: string[]): string | null {
  if (!body || !keywords.length) return null;
  const hay = normalizeForMatch(body);
  if (!hay) return null;
  for (const kw of keywords) {
    if (!kw) continue;
    // Phrase match (covers multi-word "happy birthday")
    if (hay.includes(kw)) return kw;
  }
  return null;
}
