const COMBINING_MARK_START = 0x0300;
const COMBINING_MARK_END = 0x036f;

/** Strips combining diacritical marks left behind by NFD normalization (e.g. accents). */
export function stripDiacritics(s: string): string {
  return [...s.normalize('NFD')]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < COMBINING_MARK_START || code > COMBINING_MARK_END;
    })
    .join('');
}

export function normalizeName(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Preferred-name → legal-first-name aliases seen in real data. Extend as new cases appear. */
const NICKNAMES: Record<string, string> = {
  divs: 'divya',
};

function canonicalFirstName(name: string): string {
  return NICKNAMES[name] ?? name;
}

export interface MatchCandidate {
  index: number;
  fullName: string;
}

export type MatchConfidence = 'exact' | 'token';

export interface MatchOutcome {
  index: number;
  confidence: MatchConfidence;
}

/**
 * Matches a (preferredName, lastName) pair from the completion report against
 * master-file hire candidates. Tier 1: exact normalized full-name match.
 * Tier 2: all normalized last-name tokens appear in the candidate's name, and
 * the first-name tokens match exactly or via the nickname table. First match
 * wins in each tier — good enough for this proof-of-concept phase.
 */
export function matchPerson(
  preferredName: string,
  lastName: string,
  candidates: MatchCandidate[],
): MatchOutcome | null {
  const fullNormalized = normalizeName(`${preferredName} ${lastName}`);
  for (const c of candidates) {
    if (normalizeName(c.fullName) === fullNormalized) {
      return { index: c.index, confidence: 'exact' };
    }
  }

  const lastTokens = normalizeName(lastName).split(' ').filter(Boolean);
  const firstCanonical = canonicalFirstName(normalizeName(preferredName));
  if (lastTokens.length === 0) return null;

  for (const c of candidates) {
    const candTokens = normalizeName(c.fullName).split(' ').filter(Boolean);
    if (candTokens.length === 0) continue;
    const candFirstCanonical = canonicalFirstName(candTokens[0]);
    const hasAllLastTokens = lastTokens.every((t) => candTokens.includes(t));
    if (hasAllLastTokens && candFirstCanonical === firstCanonical) {
      return { index: c.index, confidence: 'token' };
    }
  }

  return null;
}
