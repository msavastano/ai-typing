/**
 * The skill model: turns raw keystroke observations into a ranked view of what
 * the user should actually practise.
 *
 * Two ideas drive it:
 *
 *  1. Weakness is a *rate*, not a count. Counting errors per key ranks by how
 *     often a letter appears in English, so e/t/a/o/n top every user's list.
 *     Ranking by a Wilson lower bound on the error rate ranks by evidence, so a
 *     key needs both a bad rate and enough attempts to be called weak.
 *  2. Errors miss the keys you reach for slowly but eventually get right. Those
 *     are the ones capping your speed, so per-key latency counts too.
 *
 * Evidence ages on a time half-life rather than a per-lesson multiplier. Decaying
 * attempts and errors together holds the rate steady while lowering confidence,
 * which is what "this measurement is old" should mean.
 */

// ── Types ────────────────────────────────────────────────────────

export interface KeyStat {
  /** Times this character was the expected next character. */
  attempts: number;
  /** Times the user typed something else instead. */
  errors: number;
  /** Number of keystrokes contributing to the latency sums. */
  latencyN: number;
  /** Sum of inter-keystroke intervals, milliseconds. */
  latencySum: number;
  /** Sum of squared intervals, for a standard deviation without storing samples. */
  latencySumSq: number;
}

export interface DigraphStat {
  n: number;
  sumMs: number;
}

export type KeyStats = Record<string, KeyStat>;
export type DigraphStats = Record<string, DigraphStat>;

export interface LatencyBaseline {
  mean: number;
  sd: number;
}

export type StruggleReason = 'accuracy' | 'speed' | 'both';

export interface StruggleKey {
  key: string;
  score: number;
  reason: StruggleReason;
}

// ── Tuning ───────────────────────────────────────────────────────

/** Evidence halves in weight after this long. */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Below this many attempts a key has no trustworthy score. */
export const MIN_ATTEMPTS = 12;

/** A key must clear this many attempts before it can be called mastered. */
export const MASTERY_ATTEMPTS = 150;

/**
 * Struggle score under which a well-evidenced key counts as mastered. Combined
 * with ACCURACY_WEIGHT this means roughly "under a 5% error rate, at speed".
 */
export const MASTERY_SCORE = 0.03;

/** Intervals outside this range are pauses or key-repeat, not typing. */
export const MIN_LATENCY_MS = 20;
export const MAX_LATENCY_MS = 3000;

/** Cap on stored digraphs, so the user document cannot grow without bound. */
export const MAX_DIGRAPHS = 300;

const ACCURACY_WEIGHT = 0.65;
const SPEED_WEIGHT = 0.35;

// ── Construction and merging ─────────────────────────────────────

export function emptyKeyStat(): KeyStat {
  return { attempts: 0, errors: 0, latencyN: 0, latencySum: 0, latencySumSq: 0 };
}

/** Coerce whatever came back from Firestore into a usable stat. */
function coerceKeyStat(value: unknown): KeyStat {
  const v = (value ?? {}) as Partial<KeyStat>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  return {
    attempts: num(v.attempts),
    errors: num(v.errors),
    latencyN: num(v.latencyN),
    latencySum: num(v.latencySum),
    latencySumSq: num(v.latencySumSq),
  };
}

export function coerceKeyStats(value: unknown): KeyStats {
  if (!value || typeof value !== 'object') return {};
  const out: KeyStats = {};
  for (const [key, stat] of Object.entries(value as Record<string, unknown>)) {
    if (key) out[key] = coerceKeyStat(stat);
  }
  return out;
}

export function coerceDigraphStats(value: unknown): DigraphStats {
  if (!value || typeof value !== 'object') return {};
  const out: DigraphStats = {};
  for (const [key, stat] of Object.entries(value as Record<string, unknown>)) {
    const v = (stat ?? {}) as Partial<DigraphStat>;
    const n = typeof v.n === 'number' && Number.isFinite(v.n) && v.n > 0 ? v.n : 0;
    const sumMs = typeof v.sumMs === 'number' && Number.isFinite(v.sumMs) && v.sumMs >= 0 ? v.sumMs : 0;
    if (key && n > 0) out[key] = { n, sumMs };
  }
  return out;
}

/** Weight multiplier for evidence recorded `elapsedMs` ago. */
export function decayFactor(elapsedMs: number, halfLifeMs = HALF_LIFE_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  if (halfLifeMs <= 0) return 1;
  return Math.pow(0.5, elapsedMs / halfLifeMs);
}

function scaleKeyStat(stat: KeyStat, factor: number): KeyStat {
  return {
    attempts: stat.attempts * factor,
    errors: stat.errors * factor,
    latencyN: stat.latencyN * factor,
    latencySum: stat.latencySum * factor,
    latencySumSq: stat.latencySumSq * factor,
  };
}

/**
 * Age existing evidence, then fold in this session's observations. Keys whose
 * aged attempts have faded to nothing are dropped.
 */
export function mergeKeyStats(existing: KeyStats, session: KeyStats, elapsedMs: number): KeyStats {
  const factor = decayFactor(elapsedMs);
  const merged: KeyStats = {};

  for (const [key, stat] of Object.entries(existing)) {
    const aged = scaleKeyStat(stat, factor);
    if (aged.attempts >= 0.5) merged[key] = aged;
  }

  for (const [key, stat] of Object.entries(session)) {
    const base = merged[key] ?? emptyKeyStat();
    merged[key] = {
      attempts: base.attempts + stat.attempts,
      errors: base.errors + stat.errors,
      latencyN: base.latencyN + stat.latencyN,
      latencySum: base.latencySum + stat.latencySum,
      latencySumSq: base.latencySumSq + stat.latencySumSq,
    };
  }

  return roundKeyStats(merged);
}

/** Trim float noise so Firestore documents stay small and readable. */
function roundKeyStats(stats: KeyStats): KeyStats {
  const out: KeyStats = {};
  for (const [key, stat] of Object.entries(stats)) {
    out[key] = {
      attempts: round2(stat.attempts),
      errors: round2(stat.errors),
      latencyN: round2(stat.latencyN),
      latencySum: Math.round(stat.latencySum),
      latencySumSq: Math.round(stat.latencySumSq),
    };
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Same ageing for digraphs, keeping only the most-observed pairs so the document
 * cannot grow without bound.
 */
export function mergeDigraphStats(
  existing: DigraphStats,
  session: DigraphStats,
  elapsedMs: number,
  limit = MAX_DIGRAPHS,
): DigraphStats {
  const factor = decayFactor(elapsedMs);
  const merged: DigraphStats = {};

  for (const [pair, stat] of Object.entries(existing)) {
    const n = stat.n * factor;
    if (n >= 0.5) merged[pair] = { n, sumMs: stat.sumMs * factor };
  }

  for (const [pair, stat] of Object.entries(session)) {
    const base = merged[pair] ?? { n: 0, sumMs: 0 };
    merged[pair] = { n: base.n + stat.n, sumMs: base.sumMs + stat.sumMs };
  }

  return Object.entries(merged)
    .sort(([, a], [, b]) => b.n - a.n)
    .slice(0, limit)
    .reduce<DigraphStats>((acc, [pair, stat]) => {
      acc[pair] = { n: round2(stat.n), sumMs: Math.round(stat.sumMs) };
      return acc;
    }, {});
}

// ── Capture ──────────────────────────────────────────────────────

/** Mutable accumulator for one practice session's keystrokes. */
export interface KeystrokeSession {
  keys: KeyStats;
  digraphs: DigraphStats;
  /** Last correctly typed character, for digraph timing. Null breaks the chain. */
  previousChar: string | null;
}

export function newKeystrokeSession(): KeystrokeSession {
  return { keys: {}, digraphs: {}, previousChar: null };
}

/**
 * Record one forward keystroke.
 *
 * Every keystroke counts toward `attempts` — that denominator is what turns an
 * error count into an error rate. Latency is kept only for correct keystrokes,
 * because the timing around a mistake is contaminated by hesitation and recovery,
 * and an error already registers through the rate.
 *
 * A mistake also breaks the digraph chain: the transition into the next character
 * came after a correction, so it does not measure fluent movement.
 */
export function recordKeystroke(
  session: KeystrokeSession,
  expected: string,
  typed: string | undefined,
  latency: number | null,
): void {
  if (!expected) return;

  const current = session.keys[expected] ?? emptyKeyStat();
  current.attempts += 1;

  const correct = typed === expected;
  const usableLatency =
    latency !== null && latency >= MIN_LATENCY_MS && latency <= MAX_LATENCY_MS;

  if (!correct) {
    current.errors += 1;
  } else if (usableLatency) {
    current.latencyN += 1;
    current.latencySum += latency!;
    current.latencySumSq += latency! * latency!;

    // Letter-to-letter transition time — what actually caps typing speed.
    const previous = session.previousChar;
    if (previous) {
      const pair = (previous + expected).toLowerCase();
      if (/^[a-z]{2}$/.test(pair)) {
        const digraph = session.digraphs[pair] ?? { n: 0, sumMs: 0 };
        digraph.n += 1;
        digraph.sumMs += latency!;
        session.digraphs[pair] = digraph;
      }
    }
  }

  session.keys[expected] = current;
  session.previousChar = correct ? expected : null;
}

// ── Scoring ──────────────────────────────────────────────────────

/**
 * Wilson score lower bound for the error rate. Ranks by evidence rather than raw
 * proportion, so 2 errors in 3 attempts does not outrank 40 in 500.
 */
export function wilsonLowerBound(errors: number, attempts: number, z = 1.96): number {
  if (attempts <= 0) return 0;
  const p = Math.min(1, Math.max(0, errors / attempts));
  const z2 = z * z;
  const denominator = 1 + z2 / attempts;
  const centre = p + z2 / (2 * attempts);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * attempts)) / attempts);
  return Math.max(0, (centre - margin) / denominator);
}

export function latencyMean(stat: KeyStat): number | null {
  if (stat.latencyN < 1) return null;
  return stat.latencySum / stat.latencyN;
}

/**
 * Mean and spread of per-key latencies, measured across keys rather than
 * keystrokes so one very common letter cannot define the baseline.
 */
export function latencyBaseline(stats: KeyStats): LatencyBaseline | null {
  const means: number[] = [];
  for (const stat of Object.values(stats)) {
    const mean = latencyMean(stat);
    if (mean !== null && stat.latencyN >= 5) means.push(mean);
  }
  if (means.length < 3) return null;
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const variance = means.reduce((sum, v) => sum + (v - mean) ** 2, 0) / means.length;
  return { mean, sd: Math.sqrt(variance) };
}

/** Map a latency z-score onto 0..1, where 0 is at or below baseline. */
export function speedPenalty(stat: KeyStat, baseline: LatencyBaseline | null): number {
  if (!baseline || baseline.sd <= 0) return 0;
  const mean = latencyMean(stat);
  if (mean === null || stat.latencyN < 5) return 0;
  const z = (mean - baseline.mean) / baseline.sd;
  return Math.min(1, Math.max(0, z / 2.5));
}

/**
 * How much this key needs work, 0..1. Null when there is not enough evidence to
 * say anything — an unmeasured key is not the same as a strong one.
 */
export function struggleScore(stat: KeyStat, baseline: LatencyBaseline | null): number | null {
  if (stat.attempts < MIN_ATTEMPTS) return null;
  const accuracy = wilsonLowerBound(stat.errors, stat.attempts);
  const speed = speedPenalty(stat, baseline);
  return ACCURACY_WEIGHT * accuracy + SPEED_WEIGHT * speed;
}

export function struggleReason(stat: KeyStat, baseline: LatencyBaseline | null): StruggleReason {
  const accuracy = wilsonLowerBound(stat.errors, stat.attempts) * ACCURACY_WEIGHT;
  const speed = speedPenalty(stat, baseline) * SPEED_WEIGHT;
  if (accuracy > 0 && speed > 0 && Math.min(accuracy, speed) / Math.max(accuracy, speed) > 0.5) {
    return 'both';
  }
  return speed > accuracy ? 'speed' : 'accuracy';
}

/** A key with a long clean record needs no more drilling. */
export function isMastered(stat: KeyStat, baseline: LatencyBaseline | null): boolean {
  if (stat.attempts < MASTERY_ATTEMPTS) return false;
  const score = struggleScore(stat, baseline);
  return score !== null && score < MASTERY_SCORE;
}

/** The keys most worth practising, worst first. */
export function rankStruggleKeys(stats: KeyStats, limit = 5): StruggleKey[] {
  const baseline = latencyBaseline(stats);
  const ranked: StruggleKey[] = [];

  for (const [key, stat] of Object.entries(stats)) {
    const score = struggleScore(stat, baseline);
    if (score === null || score <= 0) continue;
    if (isMastered(stat, baseline)) continue;
    ranked.push({ key, score, reason: struggleReason(stat, baseline) });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** Keys with a long clean record — eligible for spaced review, not drilling. */
export function listMasteredKeys(stats: KeyStats): string[] {
  const baseline = latencyBaseline(stats);
  return Object.entries(stats)
    .filter(([, stat]) => isMastered(stat, baseline))
    .map(([key]) => key)
    .sort();
}

/** Digraphs the user is slowest on, relative to their own typing speed. */
export function rankSlowDigraphs(digraphs: DigraphStats, limit = 3, minN = 8): string[] {
  const eligible = Object.entries(digraphs).filter(([, s]) => s.n >= minN);
  if (eligible.length < 3) return [];
  const means = eligible.map(([pair, s]) => ({ pair, mean: s.sumMs / s.n }));
  const overall = means.reduce((sum, m) => sum + m.mean, 0) / means.length;
  return means
    .filter(m => m.mean > overall)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, limit)
    .map(m => m.pair);
}

/**
 * Combine upper and lower case into one stat per physical key. Scoring keeps the
 * cases apart so shift problems stay visible, but anything drawn on a keyboard
 * has one key per letter.
 */
export function foldCase(stats: KeyStats): KeyStats {
  const out: KeyStats = {};
  for (const [key, stat] of Object.entries(stats)) {
    const k = key.toLowerCase();
    const base = out[k] ?? emptyKeyStat();
    out[k] = {
      attempts: base.attempts + stat.attempts,
      errors: base.errors + stat.errors,
      latencyN: base.latencyN + stat.latencyN,
      latencySum: base.latencySum + stat.latencySum,
      latencySumSq: base.latencySumSq + stat.latencySumSq,
    };
  }
  return out;
}

/** Per-key error rates folded to lowercase, for the dashboard heatmap. */
export function errorRateByKey(stats: KeyStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, stat] of Object.entries(foldCase(stats))) {
    if (stat.attempts >= MIN_ATTEMPTS) out[key] = stat.errors / stat.attempts;
  }
  return out;
}

// ── Progression ──────────────────────────────────────────────────

export type KeyState = 'mastered' | 'practising' | 'unmeasured';

export interface KeyProgress {
  key: string;
  state: KeyState;
  attempts: number;
  /** How far this key has come toward the evidence gate for mastery, 0..1. */
  evidence: number;
  /** Struggle score, or null when there is not yet enough evidence to score it. */
  score: number | null;
  /** Observed error rate, 0..1. */
  errorRate: number;
}

/**
 * Per-key standing, for showing the user where they actually are. "Unmeasured"
 * is deliberately its own state rather than being lumped in with "fine" — not
 * having seen a key is not the same as having seen it go well.
 */
export function keyProgress(stats: KeyStats, keys: readonly string[]): KeyProgress[] {
  const folded = foldCase(stats);
  const baseline = latencyBaseline(folded);

  return keys.map(key => {
    const stat = folded[key];
    const attempts = stat?.attempts ?? 0;
    const evidence = Math.min(1, attempts / MASTERY_ATTEMPTS);

    const errorRate = attempts > 0 ? (stat?.errors ?? 0) / attempts : 0;

    if (!stat || attempts < MIN_ATTEMPTS) {
      return { key, state: 'unmeasured' as const, attempts, evidence, score: null, errorRate };
    }
    return {
      key,
      state: isMastered(stat, baseline) ? ('mastered' as const) : ('practising' as const),
      attempts,
      evidence,
      score: struggleScore(stat, baseline),
      errorRate,
    };
  });
}

export interface ProgressSummary {
  mastered: number;
  practising: number;
  unmeasured: number;
  total: number;
}

export function progressSummary(progress: KeyProgress[]): ProgressSummary {
  return {
    mastered: progress.filter(p => p.state === 'mastered').length,
    practising: progress.filter(p => p.state === 'practising').length,
    unmeasured: progress.filter(p => p.state === 'unmeasured').length,
    total: progress.length,
  };
}

export interface MasteryCandidate extends KeyProgress {
  /**
   * True when the rate is already good enough and only mileage is missing — the
   * key is held back by the evidence gate rather than by mistakes.
   */
  awaitingEvidence: boolean;
  /** Attempts still needed before mastery can be awarded. */
  attemptsRemaining: number;
}

/**
 * Keys closest to mastery, best first. Mastery has two gates — a low enough
 * score and enough attempts — and a key can be held back by either, so the
 * caller is told which one applies rather than being shown a bare number.
 */
export function nearestToMastery(progress: KeyProgress[], limit = 3): MasteryCandidate[] {
  return progress
    .filter(p => p.state === 'practising' && p.score !== null)
    .sort((a, b) => a.score! - b.score! || b.attempts - a.attempts)
    .slice(0, limit)
    .map(p => ({
      ...p,
      awaitingEvidence: p.score! < MASTERY_SCORE,
      attemptsRemaining: Math.max(0, Math.ceil(MASTERY_ATTEMPTS - p.attempts)),
    }));
}

// ── Level ────────────────────────────────────────────────────────

/**
 * Exponentially weighted mean over recent lessons, newest first. Unlike a
 * lifetime running average this tracks the user as they improve, so difficulty
 * stops being anchored to their first week.
 */
export function recentLevel(valuesNewestFirst: number[], alpha = 0.3): number | null {
  const values = valuesNewestFirst.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = Math.pow(1 - alpha, i);
    weightedSum += values[i] * weight;
    weightTotal += weight;
  }
  return weightedSum / weightTotal;
}
