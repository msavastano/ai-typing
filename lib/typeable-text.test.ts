import { describe, it, expect } from 'vitest';
import { toTypeableText, isTypeable, untypeableCharacters } from './typeable-text';

describe('toTypeableText — reported failures', () => {
  it('fixes the em dash that made a lesson impossible to complete', () => {
    // Straight from a real lesson: "ventures—once" had no key that could match.
    const input = 'Industrial textile ventures—once driven by the sharp clatter of heavy looms; now echo with digital logs.';
    const output = toTypeableText(input);
    expect(output).toContain('ventures - once');
    expect(isTypeable(output)).toBe(true);
  });

  it('fixes the curly apostrophe', () => {
    expect(toTypeableText('the founder’s ledger')).toBe("the founder's ledger");
  });

  it('fixes curly double quotes', () => {
    expect(toTypeableText('“well then,” she said')).toBe('"well then," she said');
  });
});

describe('toTypeableText — dashes', () => {
  it('spaces an em dash, which normally joins words directly', () => {
    expect(toTypeableText('a—b')).toBe('a - b');
  });

  it('does not double-space an already spaced em dash', () => {
    expect(toTypeableText('a — b')).toBe('a - b');
  });

  it('keeps an en dash tight, since it usually marks a range', () => {
    expect(toTypeableText('10–20')).toBe('10-20');
  });

  it('converts the minus sign and non-breaking hyphens', () => {
    expect(toTypeableText('5−3')).toBe('5-3');
    expect(toTypeableText('co‑operate')).toBe('co-operate');
  });
});

describe('toTypeableText — other substitutions', () => {
  it('expands an ellipsis glyph', () => {
    expect(toTypeableText('wait… then go')).toBe('wait... then go');
  });

  it('converts non-breaking and typographic spaces', () => {
    expect(toTypeableText('a b c　d')).toBe('a b c d');
  });

  it('removes zero-width characters and soft hyphens', () => {
    expect(toTypeableText('ab​c­d﻿')).toBe('abcd');
  });

  it('converts guillemets and single angle quotes', () => {
    expect(toTypeableText('«bonjour»')).toBe('"bonjour"');
    expect(toTypeableText('‹x›')).toBe('<x>');
  });

  it('converts multiplication signs and fraction slashes', () => {
    expect(toTypeableText('3×4')).toBe('3x4');
    expect(toTypeableText('1⁄2')).toBe('1/2');
  });
});

describe('toTypeableText — accents', () => {
  it('strips diacritics rather than deleting the letter', () => {
    expect(toTypeableText('café naïve résumé')).toBe('cafe naive resume');
  });

  it('handles uppercase accents', () => {
    expect(toTypeableText('ÉCOLE')).toBe('ECOLE');
  });

  it('drops characters with no ASCII equivalent at all', () => {
    const output = toTypeableText('temperature 20℃ today');
    expect(isTypeable(output)).toBe(true);
    expect(output).toContain('20');
  });
});

describe('toTypeableText — whitespace', () => {
  it('collapses runs of whitespace', () => {
    expect(toTypeableText('a   b')).toBe('a b');
  });

  it('flattens line breaks and tabs into spaces', () => {
    expect(toTypeableText('a\nb\tc')).toBe('a b c');
  });

  it('leaves spacing around punctuation alone, so code snippets survive', () => {
    expect(toTypeableText('const a = [] ; b : c , d')).toBe('const a = [] ; b : c , d');
  });

  it('trims the ends', () => {
    expect(toTypeableText('  hello  ')).toBe('hello');
  });

  it('returns an empty string for empty input', () => {
    expect(toTypeableText('')).toBe('');
  });
});

describe('toTypeableText — safety net', () => {
  it('leaves already-clean ASCII untouched', () => {
    const clean = "The quick brown fox jumps over the lazy dog; it's 42% done (really).";
    expect(toTypeableText(clean)).toBe(clean);
  });

  it('preserves every ASCII symbol a programmer needs', () => {
    const symbols = '= {} () [] ; : . , < > / " \' ` _ - + && || # @ $ % ^ * ~ ! ?';
    expect(toTypeableText(symbols)).toBe(symbols);
  });

  it('guarantees typeable output for arbitrary junk', () => {
    const junk = 'emoji \u{1F600} arrows → math ∑ cjk 中文 done';
    const output = toTypeableText(junk);
    expect(isTypeable(output)).toBe(true);
    expect(output).toContain('done');
  });
});

describe('isTypeable / untypeableCharacters', () => {
  it('identifies clean and dirty text', () => {
    expect(isTypeable('plain ascii')).toBe(true);
    expect(isTypeable('curly ’ quote')).toBe(false);
  });

  it('lists the offending characters once each', () => {
    expect(untypeableCharacters('a—b—c’d')).toEqual(['—', '’']);
  });

  it('reports nothing for clean text', () => {
    expect(untypeableCharacters('all fine here')).toEqual([]);
  });
});
