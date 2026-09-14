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

interface NormalizedCandidate {
  normalized: string;
  tokens: string[];
  firstCanonical: string;
}

const normalizedCache = new WeakMap<MatchCandidate[], NormalizedCandidate[]>();

/** Computes (and caches, keyed by the candidates array's identity) per-candidate normalized name data. */
function getNormalizedCandidates(candidates: MatchCandidate[]): NormalizedCandidate[] {
  const cached = normalizedCache.get(candidates);
  if (cached && cached.length === candidates.length) return cached;

  const computed = candidates.map((c) => {
    const normalized = normalizeName(c.fullName);
    const tokens = normalized.split(' ').filter(Boolean);
    const firstCanonical = canonicalFirstName(tokens[0] ?? '');
    return { normalized, tokens, firstCanonical };
  });
  normalizedCache.set(candidates, computed);
  return computed;
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
  const normalizedCandidates = getNormalizedCandidates(candidates);

  const fullNormalized = normalizeName(`${preferredName} ${lastName}`);
  for (let i = 0; i < candidates.length; i++) {
    if (normalizedCandidates[i].normalized === fullNormalized) {
      return { index: candidates[i].index, confidence: 'exact' };
    }
  }

  const lastTokens = normalizeName(lastName).split(' ').filter(Boolean);
  const firstCanonical = canonicalFirstName(normalizeName(preferredName));
  if (lastTokens.length === 0) return null;

  for (let i = 0; i < candidates.length; i++) {
    const candTokens = normalizedCandidates[i].tokens;
    if (candTokens.length === 0) continue;
    const candFirstCanonical = normalizedCandidates[i].firstCanonical;
    const hasAllLastTokens = lastTokens.every((t) => candTokens.includes(t));
    if (hasAllLastTokens && candFirstCanonical === firstCanonical) {
      return { index: candidates[i].index, confidence: 'token' };
    }
  }

  return null;
}
