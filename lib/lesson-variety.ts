/**
 * Pure helpers that keep generated lessons from repeating across sessions.
 *
 * Two mechanisms:
 *  1. A deterministic constraint rotation, so consecutive lessons are *guaranteed*
 *     to be prompted differently rather than randomly re-rolling the same hints.
 *  2. A text-similarity score used to reject a generation that looks like one the
 *     user has already typed.
 */

// ── Constraint rotation ──────────────────────────────────────────

export const ANGLES = [
  'Use a narrative or storytelling angle.',
  'Use a factual or informational angle.',
  'Use a descriptive or observational angle.',
  'Use a reflective or first-person angle.',
  'Use a dialogue-driven angle with quoted speech.',
  'Use a how-to or instructional angle.',
  'Use a comparative angle, contrasting two ideas.',
  'Use a historical or timeline angle.',
];

export const ANCHORS = [
  'Anchor the text in a specific season or time of day.',
  'Include at least one place name.',
  'Include at least one number written as a numeral.',
  'Centre it on a small, tangible object.',
  'Reference a sound or a smell.',
  'Open with a question or a surprising statement.',
  'Open with an unexpected concrete noun.',
];

export const REGISTERS = [
  'Keep the register plain and direct.',
  'Keep the register warm and conversational.',
  'Keep the register precise and technical.',
  'Keep the register wry and light.',
  'Keep the register vivid and sensory.',
];

export interface VarietyConstraints {
  angle: string;
  anchor: string;
  register: string;
}

/**
 * The three list lengths (8, 7, 5) are pairwise coprime, so stepping the index
 * by one changes every axis and the full combination cycle is 280 lessons long.
 */
export function pickConstraints(index: number): VarietyConstraints {
  const n = Math.abs(Math.trunc(index)) || 0;
  return {
    angle: ANGLES[n % ANGLES.length],
    anchor: ANCHORS[n % ANCHORS.length],
    register: REGISTERS[n % REGISTERS.length],
  };
}

/**
 * A monotonic index over (session, block, regeneration). `nonce` covers Skip and
 * Practice-again, which do not advance totalLessons but must still vary.
 */
export function varietyIndex(totalLessons: number, chunkIndex: number, nonce: number): number {
  const lessons = Math.max(0, Math.trunc(totalLessons) || 0);
  const chunk = Math.max(0, Math.trunc(chunkIndex) || 0);
  const salt = Math.max(0, Math.trunc(nonce) || 0);
  return lessons * 4 + chunk + salt;
}

// ── Similarity ───────────────────────────────────────────────────

/** Above this, a generated lesson is treated as a repeat and regenerated once. */
export const SIMILARITY_THRESHOLD = 0.35;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'was', 'were', 'are',
  'his', 'her', 'its', 'their', 'they', 'them', 'you', 'your', 'but', 'not',
  'has', 'had', 'have', 'been', 'into', 'onto', 'over', 'than', 'then', 'when',
  'what', 'which', 'who', 'will', 'would', 'can', 'could', 'all', 'any', 'each',
  'more', 'most', 'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just',
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

/** Distinct meaning-bearing words — the fingerprint of what a text is about. */
export function contentWords(text: string): Set<string> {
  return new Set(words(text).filter(w => w.length >= 3 && !STOPWORDS.has(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

const OPENING_WORDS = 6;

/** Fraction of the first few words that match position-for-position. */
export function openingSimilarity(a: string, b: string): number {
  const aw = words(a).slice(0, OPENING_WORDS);
  const bw = words(b).slice(0, OPENING_WORDS);
  const span = Math.min(aw.length, bw.length);
  if (span === 0) return 0;
  let matches = 0;
  for (let i = 0; i < span; i++) {
    if (aw[i] === bw[i]) matches++;
  }
  return matches / span;
}

/**
 * 0 = unrelated, 1 = identical. Takes the worse of subject overlap and a shared
 * opening, since a model that repeats itself usually does one or the other.
 */
export function similarity(a: string, b: string): number {
  return Math.max(jaccard(contentWords(a), contentWords(b)), openingSimilarity(a, b));
}

export function maxSimilarity(text: string, others: string[]): number {
  let worst = 0;
  for (const other of others) {
    const score = similarity(text, other);
    if (score > worst) worst = score;
  }
  return worst;
}

/** First few words of each recent lesson, for the prompt's do-not-reuse list. */
export function recentOpenings(texts: string[], max = 6): string[] {
  const seen = new Set<string>();
  const openings: string[] = [];
  for (const text of texts) {
    const opening = words(text).slice(0, OPENING_WORDS).join(' ');
    if (!opening || seen.has(opening)) continue;
    seen.add(opening);
    openings.push(opening);
    if (openings.length >= max) break;
  }
  return openings;
}

/** Pick the canned text least like anything the user has typed recently. */
export function pickFallback(pool: string[], recent: string[]): string {
  if (pool.length === 0) return '';
  let best = pool[0];
  let bestScore = Infinity;
  for (const candidate of pool) {
    const score = maxSimilarity(candidate, recent);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
