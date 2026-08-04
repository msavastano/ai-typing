import { describe, it, expect } from 'vitest';
import {
  ANGLES,
  ANCHORS,
  REGISTERS,
  pickConstraints,
  varietyIndex,
  normalizeText,
  words,
  contentWords,
  jaccard,
  openingSimilarity,
  similarity,
  maxSimilarity,
  recentOpenings,
  pickFallback,
  SIMILARITY_THRESHOLD,
} from './lesson-variety';

describe('pickConstraints', () => {
  it('changes every axis on consecutive indices', () => {
    for (let n = 0; n < 20; n++) {
      const a = pickConstraints(n);
      const b = pickConstraints(n + 1);
      expect(a.angle).not.toBe(b.angle);
      expect(a.anchor).not.toBe(b.anchor);
      expect(a.register).not.toBe(b.register);
    }
  });

  it('does not repeat a full combination until the lists cycle', () => {
    const cycle = ANGLES.length * ANCHORS.length * REGISTERS.length; // 280
    const seen = new Set<string>();
    for (let n = 0; n < cycle; n++) {
      const { angle, anchor, register } = pickConstraints(n);
      seen.add(`${angle}|${anchor}|${register}`);
    }
    expect(seen.size).toBe(cycle);
    expect(pickConstraints(cycle)).toEqual(pickConstraints(0));
  });

  it('handles negative and non-integer indices', () => {
    expect(pickConstraints(-3)).toEqual(pickConstraints(3));
    expect(pickConstraints(2.9)).toEqual(pickConstraints(2));
  });
});

describe('varietyIndex', () => {
  it('advances between sessions even when nothing else changes', () => {
    expect(varietyIndex(4, 0, 0)).not.toBe(varietyIndex(5, 0, 0));
  });

  it('advances between blocks within a session', () => {
    expect(varietyIndex(4, 0, 0)).not.toBe(varietyIndex(4, 1, 0));
  });

  it('advances on regeneration when the session has not been saved yet', () => {
    expect(varietyIndex(0, 0, 0)).not.toBe(varietyIndex(0, 0, 1));
  });

  it('clamps junk input to a usable index', () => {
    expect(varietyIndex(-1, -1, -1)).toBe(0);
    expect(varietyIndex(NaN, NaN, NaN)).toBe(0);
  });
});

describe('normalizeText', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  The QUICK, brown -- fox!  ')).toBe('the quick brown fox');
  });

  it('keeps numerals', () => {
    expect(normalizeText('It cost 42 dollars.')).toBe('it cost 42 dollars');
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeText('!!! ...')).toBe('');
    expect(words('!!!')).toEqual([]);
  });
});

describe('contentWords', () => {
  it('drops stopwords and very short words', () => {
    expect(contentWords('The cat and the dog ran')).toEqual(new Set(['cat', 'dog', 'ran']));
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint ones', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('is 0 when either set is empty', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
  });

  it('computes intersection over union', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(0.5);
  });
});

describe('openingSimilarity', () => {
  it('is 1 when the first words match', () => {
    expect(openingSimilarity('one two three four five six seven', 'One two three four five six!')).toBe(1);
  });

  it('is 0 for different openings', () => {
    expect(openingSimilarity('alpha beta gamma', 'delta epsilon zeta')).toBe(0);
  });

  it('is 0 when either text is empty', () => {
    expect(openingSimilarity('', 'anything at all')).toBe(0);
  });
});

describe('similarity', () => {
  const a = 'Sunlight filtered through the tall oak trees and warmed the quiet meadow below the bridge.';

  it('is 1 against itself', () => {
    expect(similarity(a, a)).toBe(1);
  });

  it('scores unrelated prose below the rejection threshold', () => {
    const b = 'Quarterly revenue grew despite rising freight costs across every shipping lane.';
    expect(similarity(a, b)).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('catches a reworded near-duplicate', () => {
    const b = 'Sunlight filtered through the tall oak trees and warmed the still meadow beside the bridge.';
    expect(similarity(a, b)).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });

  it('catches a shared opening even when the rest diverges', () => {
    const b = 'Sunlight filtered through the tall oak canopy while commuters queued for the ferry terminal downtown.';
    expect(similarity(a, b)).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });
});

describe('maxSimilarity', () => {
  it('returns 0 when there is no history', () => {
    expect(maxSimilarity('anything', [])).toBe(0);
  });

  it('returns the worst match in the list', () => {
    const text = 'The harbour lights flickered across the black water.';
    const others = ['Completely unrelated content about spreadsheets.', text];
    expect(maxSimilarity(text, others)).toBe(1);
  });
});

describe('recentOpenings', () => {
  it('extracts and dedupes openings', () => {
    const openings = recentOpenings([
      'One two three four five six seven eight',
      'One two three four five six nine ten',
      'Alpha beta gamma delta epsilon zeta eta',
    ]);
    expect(openings).toEqual(['one two three four five six', 'alpha beta gamma delta epsilon zeta']);
  });

  it('caps the list', () => {
    const texts = Array.from({ length: 20 }, (_, i) => `opening number ${i} of the batch here`);
    expect(recentOpenings(texts, 3)).toHaveLength(3);
  });

  it('skips empty texts', () => {
    expect(recentOpenings(['', '   ', 'real words appear here now'])).toEqual(['real words appear here now']);
  });
});

describe('pickFallback', () => {
  it('avoids the text the user just typed', () => {
    const pool = [
      'The quick brown fox jumps over the lazy dog near the bridge.',
      'Quarterly revenue grew despite rising freight costs this year.',
    ];
    expect(pickFallback(pool, [pool[0]])).toBe(pool[1]);
  });

  it('returns the first entry when there is no history', () => {
    const pool = ['first option here', 'second option here'];
    expect(pickFallback(pool, [])).toBe(pool[0]);
  });

  it('returns an empty string for an empty pool', () => {
    expect(pickFallback([], ['anything'])).toBe('');
  });
});
