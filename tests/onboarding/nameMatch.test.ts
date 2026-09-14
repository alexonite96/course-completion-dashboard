import { describe, expect, it } from 'vitest';
import { matchPerson, normalizeName } from '../../worker/onboarding/nameMatch';

describe('normalizeName', () => {
  it('lowercases, strips accents and punctuation, collapses whitespace', () => {
    expect(normalizeName('Brayan Hernández Escobar')).toBe('brayan hernandez escobar');
    expect(normalizeName('  Jorge   Martin  ')).toBe('jorge martin');
  });
});

describe('matchPerson', () => {
  const candidates = [
    { index: 0, fullName: 'Abbey Litschke' },
    { index: 1, fullName: 'David Peralta Santoyo' },
    { index: 2, fullName: 'Divya Gupta' },
    { index: 3, fullName: 'Christian Luna Rodríguez' },
  ];

  it('matches an exact normalized full name', () => {
    expect(matchPerson('Abbey', 'Litschke', candidates)).toEqual({ index: 0, confidence: 'exact' });
  });

  it('matches via a known nickname when last-name tokens all appear', () => {
    expect(matchPerson('Divs', 'Gupta', candidates)).toEqual({ index: 2, confidence: 'token' });
  });

  it('matches a compound surname where the report drops a middle surname', () => {
    expect(matchPerson('Christian', 'Rodriguez', candidates)).toEqual({ index: 3, confidence: 'token' });
  });

  it('does not match a different person who happens to share a surname', () => {
    expect(matchPerson('Carmela', 'Peralta', candidates)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(matchPerson('Nobody', 'Unknown', candidates)).toBeNull();
  });
});
