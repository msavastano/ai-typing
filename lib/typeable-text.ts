/**
 * Force generated text down to characters a user can actually type.
 *
 * Language models reach for typographic punctuation — em dashes, curly quotes,
 * ellipsis glyphs — none of which exist on a standard keyboard. In a typing test
 * that is not a cosmetic problem: the character can never be matched, so the
 * lesson cannot be completed correctly and the error is unavoidable.
 *
 * The prompt asks for plain ASCII, but asking is not a guarantee, so everything
 * is normalised here before it reaches the user.
 */

/** Printable ASCII, i.e. everything reachable on a US keyboard. */
const TYPEABLE = /^[\x20-\x7E]$/;

// Escapes rather than literals throughout: several of these characters are
// invisible or easily mistaken for their ASCII lookalikes, and a stray literal
// inside a character class is impossible to review.
const REPLACEMENTS: [RegExp, string][] = [
  // Curly single quotes, primes, and accents pressed into service as apostrophes.
  [/[‘’‚‛′´]/g, "'"],
  // Curly double quotes and guillemets.
  [/[“”„‟″«»]/g, '"'],
  // Em dash and horizontal bar usually join words with no spaces, so they need
  // spacing added to stay readable once they become a plain hyphen.
  [/[—―]/g, ' - '],
  // En dash, minus sign and the non-breaking hyphens map straight across: these
  // tend to appear in ranges like "10-20", where added spacing would be wrong.
  [/[–−‐‑]/g, '-'],
  [/…/g, '...'],
  [/[•·⁃]/g, '-'],
  [/[⁄∕]/g, '/'],
  [/×/g, 'x'],
  [/‹/g, '<'],
  [/›/g, '>'],
  // Non-breaking and typographic spaces become ordinary ones.
  [/[  -   　]/g, ' '],
  // Zero-width characters and soft hyphens carry no keystroke at all.
  [/[​-‍﻿­]/g, ''],
];

/**
 * Convert text to something typeable on a standard keyboard.
 *
 * Accented letters are stripped of their diacritics rather than deleted, so
 * "café" becomes "cafe" rather than "caf".
 */
export function toTypeableText(input: string): string {
  if (!input) return '';

  let text = input;
  for (const [pattern, replacement] of REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  // Decompose accented characters, then drop the combining marks.
  text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Anything still outside printable ASCII has no key to press. Line breaks and
  // tabs become spaces; everything else is dropped.
  text = Array.from(text)
    .map(char => {
      if (TYPEABLE.test(char)) return char;
      if (char === '\n' || char === '\r' || char === '\t') return ' ';
      return '';
    })
    .join('');

  // Collapse the whitespace the replacements may have introduced. Deliberately
  // no "tidy space before punctuation" step: code snippets are a lesson mode and
  // legitimately contain "[] ; : . ," with spacing that must survive.
  return text.replace(/\s+/g, ' ').trim();
}

/** True when every character in the text can be typed on a standard keyboard. */
export function isTypeable(text: string): boolean {
  return Array.from(text).every(char => TYPEABLE.test(char));
}

/** The distinct untypeable characters in a string, for diagnostics. */
export function untypeableCharacters(text: string): string[] {
  return [...new Set(Array.from(text).filter(char => !TYPEABLE.test(char)))];
}
