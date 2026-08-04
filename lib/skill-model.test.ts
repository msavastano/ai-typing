import { describe, it, expect } from 'vitest';
import {
  emptyKeyStat,
  coerceKeyStats,
  coerceDigraphStats,
  decayFactor,
  mergeKeyStats,
  mergeDigraphStats,
  wilsonLowerBound,
  latencyMean,
  latencyBaseline,
  speedPenalty,
  struggleScore,
  struggleReason,
  isMastered,
  rankStruggleKeys,
  rankSlowDigraphs,
  errorRateByKey,
  recentLevel,
  newKeystrokeSession,
  recordKeystroke,
  foldCase,
  keyProgress,
  progressSummary,
  nearestToMastery,
  type KeystrokeSession,
  HALF_LIFE_MS,
  MIN_ATTEMPTS,
  MASTERY_ATTEMPTS,
  type KeyStat,
  type KeyStats,
} from './skill-model';

/** Build a stat with a fixed per-keystroke latency. */
function stat(attempts: number, errors: number, latencyMs?: number, latencyN = attempts): KeyStat {
  const base = { ...emptyKeyStat(), attempts, errors };
  if (latencyMs === undefined) return base;
  return {
    ...base,
    latencyN,
    latencySum: latencyMs * latencyN,
    latencySumSq: latencyMs * latencyMs * latencyN,
  };
}

describe('wilsonLowerBound', () => {
  it('is 0 with no attempts', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('is 0 with no errors', () => {
    expect(wilsonLowerBound(0, 100)).toBe(0);
  });

  it('ranks a well-evidenced bad key above a barely-sampled one', () => {
    const sparse = wilsonLowerBound(2, 3);    // 67% but only 3 samples
    const evidenced = wilsonLowerBound(200, 500); // 40% over 500 samples
    expect(evidenced).toBeGreaterThan(sparse);
  });

  it('grows toward the raw rate as evidence accumulates', () => {
    const few = wilsonLowerBound(2, 10);
    const many = wilsonLowerBound(200, 1000);
    expect(few).toBeLessThan(0.1);
    expect(many).toBeGreaterThan(0.17);
    expect(many).toBeLessThan(0.2);
  });

  it('never exceeds the observed rate', () => {
    expect(wilsonLowerBound(5, 10)).toBeLessThanOrEqual(0.5);
  });
});

describe('decayFactor', () => {
  it('is 1 for no elapsed time', () => {
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(-100)).toBe(1);
  });

  it('halves over one half-life', () => {
    expect(decayFactor(HALF_LIFE_MS)).toBeCloseTo(0.5);
    expect(decayFactor(2 * HALF_LIFE_MS)).toBeCloseTo(0.25);
  });
});

describe('mergeKeyStats', () => {
  it('adds session observations to fresh existing data', () => {
    const merged = mergeKeyStats({ a: stat(10, 2) }, { a: stat(5, 1) }, 0);
    expect(merged.a.attempts).toBe(15);
    expect(merged.a.errors).toBe(3);
  });

  it('preserves the error rate while ageing, so only confidence drops', () => {
    const existing: KeyStats = { a: stat(100, 20) };
    const merged = mergeKeyStats(existing, {}, HALF_LIFE_MS);
    expect(merged.a.attempts).toBeCloseTo(50);
    expect(merged.a.errors).toBeCloseTo(10);
    expect(merged.a.errors / merged.a.attempts).toBeCloseTo(0.2);
  });

  it('introduces keys seen for the first time', () => {
    const merged = mergeKeyStats({}, { z: stat(4, 1) }, 0);
    expect(merged.z.attempts).toBe(4);
  });

  it('drops keys that have faded to nothing', () => {
    const merged = mergeKeyStats({ q: stat(1, 1) }, {}, 20 * HALF_LIFE_MS);
    expect(merged.q).toBeUndefined();
  });

  it('accumulates latency sums', () => {
    const merged = mergeKeyStats({ a: stat(10, 0, 200) }, { a: stat(10, 0, 200) }, 0);
    expect(latencyMean(merged.a)).toBeCloseTo(200);
    expect(merged.a.latencyN).toBe(20);
  });
});

describe('mergeDigraphStats', () => {
  it('merges and ages', () => {
    const merged = mergeDigraphStats({ th: { n: 10, sumMs: 1000 } }, { th: { n: 10, sumMs: 2000 } }, 0);
    expect(merged.th).toEqual({ n: 20, sumMs: 3000 });
  });

  it('caps the number of stored pairs, keeping the most observed', () => {
    const existing: Record<string, { n: number; sumMs: number }> = {};
    for (let i = 0; i < 50; i++) existing[`p${i}`] = { n: i + 1, sumMs: (i + 1) * 100 };
    const merged = mergeDigraphStats(existing, {}, 0, 10);
    expect(Object.keys(merged)).toHaveLength(10);
    expect(merged.p49).toBeDefined();
    expect(merged.p0).toBeUndefined();
  });
});

describe('latencyBaseline', () => {
  it('returns null without enough measured keys', () => {
    expect(latencyBaseline({ a: stat(20, 0, 200) })).toBeNull();
  });

  it('ignores keys with too few latency samples', () => {
    const baseline = latencyBaseline({
      a: stat(20, 0, 200),
      b: stat(20, 0, 200),
      c: stat(20, 0, 200),
      z: stat(2, 0, 9000, 2),
    });
    expect(baseline).not.toBeNull();
    expect(baseline!.mean).toBeCloseTo(200);
  });
});

describe('speedPenalty', () => {
  const baseline = { mean: 200, sd: 40 };

  it('is 0 at or below baseline', () => {
    expect(speedPenalty(stat(20, 0, 200), baseline)).toBe(0);
    expect(speedPenalty(stat(20, 0, 120), baseline)).toBe(0);
  });

  it('rises with slowness and clamps at 1', () => {
    expect(speedPenalty(stat(20, 0, 250), baseline)).toBeCloseTo(0.5);
    expect(speedPenalty(stat(20, 0, 600), baseline)).toBe(1);
  });

  it('is 0 without a baseline or without samples', () => {
    expect(speedPenalty(stat(20, 0, 500), null)).toBe(0);
    expect(speedPenalty(stat(20, 0), baseline)).toBe(0);
  });
});

describe('struggleScore', () => {
  it('is null below the evidence floor', () => {
    expect(struggleScore(stat(MIN_ATTEMPTS - 1, 5), null)).toBeNull();
  });

  it('is 0 for a clean, fast key', () => {
    expect(struggleScore(stat(100, 0, 180), { mean: 200, sd: 40 })).toBe(0);
  });

  it('flags a key that is accurate but slow', () => {
    const score = struggleScore(stat(100, 0, 400), { mean: 200, sd: 40 });
    expect(score).toBeGreaterThan(0);
  });

  it('does not let a common letter outrank a genuinely weak one', () => {
    // 'e' appears constantly and picks up errors by sheer exposure.
    const common = struggleScore(stat(1000, 30, 200), { mean: 200, sd: 40 })!;
    // 'p' is rarer but goes wrong a quarter of the time.
    const weak = struggleScore(stat(80, 20, 200), { mean: 200, sd: 40 })!;
    expect(weak).toBeGreaterThan(common);
  });
});

describe('struggleReason', () => {
  const baseline = { mean: 200, sd: 40 };

  it('reports accuracy when errors dominate', () => {
    expect(struggleReason(stat(100, 30, 200), baseline)).toBe('accuracy');
  });

  it('reports speed when latency dominates', () => {
    expect(struggleReason(stat(100, 0, 500), baseline)).toBe('speed');
  });

  it('reports both when they are comparable', () => {
    // 20% errors weighs about the same as being 0.6 sd slow than baseline.
    expect(struggleReason(stat(100, 20, 225), baseline)).toBe('both');
  });
});

describe('isMastered', () => {
  it('needs a long clean record', () => {
    expect(isMastered(stat(MASTERY_ATTEMPTS - 1, 0, 190), { mean: 200, sd: 40 })).toBe(false);
    expect(isMastered(stat(MASTERY_ATTEMPTS, 0, 190), { mean: 200, sd: 40 })).toBe(true);
  });

  it('is false for a key that still errors', () => {
    expect(isMastered(stat(500, 60, 190), { mean: 200, sd: 40 })).toBe(false);
  });
});

describe('rankStruggleKeys', () => {
  it('returns nothing without evidence', () => {
    expect(rankStruggleKeys({ a: stat(3, 2) })).toEqual([]);
  });

  it('ranks by rate, not by raw error count', () => {
    const stats: KeyStats = {
      e: stat(140, 6, 200), // most errors overall, but only 4%
      p: stat(60, 15, 200), // fewest attempts, but 25%
      a: stat(120, 5, 200),
    };
    const ranked = rankStruggleKeys(stats);
    expect(ranked[0].key).toBe('p');
    expect(ranked.map(r => r.key)).toContain('e');
  });

  it('retires a common letter once its rate is good over many attempts', () => {
    // Same 4% rate as above, but now with enough evidence to call it settled.
    const stats: KeyStats = { e: stat(1000, 40, 200), p: stat(60, 15, 200) };
    expect(rankStruggleKeys(stats).map(r => r.key)).toEqual(['p']);
  });

  it('excludes mastered keys', () => {
    const stats: KeyStats = {
      f: stat(600, 0, 190),
      j: stat(100, 25, 200),
      k: stat(100, 10, 200),
      l: stat(100, 8, 200),
    };
    expect(rankStruggleKeys(stats).map(r => r.key)).not.toContain('f');
  });

  it('honours the limit', () => {
    const stats: KeyStats = {};
    for (const k of 'abcdefgh') stats[k] = stat(100, 20, 200);
    expect(rankStruggleKeys(stats, 3)).toHaveLength(3);
  });

  it('keeps uppercase separate so shift problems stay visible', () => {
    const stats: KeyStats = { a: stat(500, 5, 200), A: stat(60, 24, 200) };
    expect(rankStruggleKeys(stats)[0].key).toBe('A');
  });
});

describe('rankSlowDigraphs', () => {
  it('returns nothing without enough pairs', () => {
    expect(rankSlowDigraphs({ th: { n: 20, sumMs: 4000 } })).toEqual([]);
  });

  it('picks the slowest above-average pairs', () => {
    const digraphs = {
      th: { n: 20, sumMs: 20 * 150 },
      er: { n: 20, sumMs: 20 * 160 },
      ct: { n: 20, sumMs: 20 * 400 },
      br: { n: 20, sumMs: 20 * 350 },
    };
    expect(rankSlowDigraphs(digraphs, 2)).toEqual(['ct', 'br']);
  });

  it('ignores pairs below the sample floor', () => {
    const digraphs = {
      th: { n: 20, sumMs: 20 * 150 },
      er: { n: 20, sumMs: 20 * 160 },
      ct: { n: 20, sumMs: 20 * 300 },
      zz: { n: 2, sumMs: 2 * 5000 },
    };
    expect(rankSlowDigraphs(digraphs, 3)).not.toContain('zz');
  });
});

describe('errorRateByKey', () => {
  it('folds case together and reports a rate', () => {
    const rates = errorRateByKey({ a: stat(100, 10), A: stat(100, 30) });
    expect(rates.a).toBeCloseTo(0.2);
  });

  it('omits keys below the evidence floor', () => {
    expect(errorRateByKey({ q: stat(3, 3) })).toEqual({});
  });
});

describe('recentLevel', () => {
  it('returns null for no data', () => {
    expect(recentLevel([])).toBeNull();
  });

  it('weights recent lessons above old ones', () => {
    // Newest first: the user has improved from 20 to 60 wpm.
    const level = recentLevel([60, 55, 50, 30, 20, 20, 20, 20, 20, 20])!;
    const lifetimeMean = 31.5;
    expect(level).toBeGreaterThan(lifetimeMean);
    expect(level).toBeGreaterThan(45);
  });

  it('matches the value when every lesson is the same', () => {
    expect(recentLevel([40, 40, 40])).toBeCloseTo(40);
  });

  it('ignores non-finite entries', () => {
    expect(recentLevel([NaN, 40, 40] as number[])).toBeCloseTo(40);
  });
});

describe('recordKeystroke', () => {
  /** Type a string correctly at a fixed cadence. */
  function typeCorrectly(session: KeystrokeSession, text: string, latency = 200) {
    for (let i = 0; i < text.length; i++) {
      recordKeystroke(session, text[i], text[i], i === 0 ? null : latency);
    }
  }

  it('counts an attempt for every keystroke, right or wrong', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'a', 'a', 150);
    recordKeystroke(s, 'a', 'q', 150);
    recordKeystroke(s, 'a', 'a', 150);
    expect(s.keys.a.attempts).toBe(3);
    expect(s.keys.a.errors).toBe(1);
  });

  it('records the attempt against the expected key, not the typed one', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'a', 'q', 150);
    expect(s.keys.a.errors).toBe(1);
    expect(s.keys.q).toBeUndefined();
  });

  it('keeps latency only for correct keystrokes', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'a', 'a', 200);
    recordKeystroke(s, 'a', 'q', 900);
    expect(s.keys.a.latencyN).toBe(1);
    expect(latencyMean(s.keys.a)).toBeCloseTo(200);
  });

  it('ignores pauses and impossibly fast intervals', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'a', 'a', 60_000);       // walked away
    recordKeystroke(s, 'a', 'a', 1);            // key repeat
    recordKeystroke(s, 'a', 'a', null);         // first keystroke of a block
    expect(s.keys.a.attempts).toBe(3);
    expect(s.keys.a.latencyN).toBe(0);
  });

  it('is case-sensitive so shift problems stay visible', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'A', 'a', 200);
    recordKeystroke(s, 'a', 'a', 200);
    expect(s.keys.A.errors).toBe(1);
    expect(s.keys.a.errors).toBe(0);
  });

  it('accumulates digraph timing across a fluent run', () => {
    const s = newKeystrokeSession();
    typeCorrectly(s, 'that', 200);
    // 'th', 'ha', 'at' — the first character has no preceding transition.
    expect(s.digraphs.th).toEqual({ n: 1, sumMs: 200 });
    expect(s.digraphs.ha).toEqual({ n: 1, sumMs: 200 });
    expect(s.digraphs.at).toEqual({ n: 1, sumMs: 200 });
  });

  it('breaks the digraph chain across a mistake', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, 'c', 'c', 200);
    recordKeystroke(s, 't', 'r', 200); // wrong
    recordKeystroke(s, 't', 't', 200); // corrected
    // 'ct' must not be credited: the transition included a correction.
    expect(s.digraphs.ct).toBeUndefined();
  });

  it('only tracks letter pairs, not spaces or punctuation', () => {
    const s = newKeystrokeSession();
    typeCorrectly(s, 'a b.', 200);
    expect(Object.keys(s.digraphs)).toEqual([]);
  });

  it('ignores an out-of-range expected character', () => {
    const s = newKeystrokeSession();
    recordKeystroke(s, '', undefined, 200);
    expect(s.keys).toEqual({});
  });

  it('produces stats the model can score', () => {
    const s = newKeystrokeSession();
    // 'p' goes wrong every fourth time; everything else is clean.
    for (let i = 0; i < 40; i++) {
      recordKeystroke(s, 'p', i % 4 === 0 ? 'o' : 'p', 200);
      recordKeystroke(s, 'a', 'a', 200);
      recordKeystroke(s, 'n', 'n', 200);
    }
    const ranked = rankStruggleKeys(s.keys);
    expect(ranked[0].key).toBe('p');
    expect(ranked[0].reason).toBe('accuracy');
  });
});

describe('foldCase', () => {
  it('combines upper and lower case into one physical key', () => {
    const folded = foldCase({ a: stat(100, 10, 200), A: stat(50, 20, 200) });
    expect(folded.a.attempts).toBe(150);
    expect(folded.a.errors).toBe(30);
    expect(folded.a.latencyN).toBe(150);
    expect(Object.keys(folded)).toEqual(['a']);
  });

  it('leaves non-letter keys alone', () => {
    expect(Object.keys(foldCase({ ',': stat(20, 1) }))).toEqual([',']);
  });
});

describe('keyProgress', () => {
  const letters = ['a', 'b', 'c'];

  it('marks keys with too little data as unmeasured, not as fine', () => {
    const progress = keyProgress({ a: stat(5, 0, 200) }, letters);
    expect(progress.map(p => p.state)).toEqual(['unmeasured', 'unmeasured', 'unmeasured']);
    expect(progress[0].attempts).toBe(5);
    expect(progress[0].score).toBeNull();
  });

  it('separates mastered from still-practising keys', () => {
    const progress = keyProgress(
      { a: stat(400, 0, 200), b: stat(400, 80, 200), c: stat(400, 2, 200) },
      letters,
    );
    const byKey = Object.fromEntries(progress.map(p => [p.key, p.state]));
    expect(byKey.a).toBe('mastered');
    expect(byKey.b).toBe('practising');
    expect(byKey.c).toBe('mastered');
  });

  it('counts an uppercase key toward its letter', () => {
    const progress = keyProgress({ A: stat(400, 0, 200), a: stat(400, 0, 200) }, ['a']);
    expect(progress[0].attempts).toBe(800);
  });

  it('reports evidence as progress toward the attempts gate', () => {
    const progress = keyProgress({ a: stat(75, 5, 200) }, ['a']);
    expect(progress[0].evidence).toBeCloseTo(0.5);
  });

  it('caps evidence at 1', () => {
    expect(keyProgress({ a: stat(1000, 5, 200) }, ['a'])[0].evidence).toBe(1);
  });

  it('returns one entry per requested key, in order', () => {
    expect(keyProgress({}, letters).map(p => p.key)).toEqual(letters);
  });
});

describe('progressSummary', () => {
  it('tallies the three states', () => {
    const progress = keyProgress(
      { a: stat(400, 0, 200), b: stat(400, 80, 200), c: stat(2, 0) },
      ['a', 'b', 'c', 'd'],
    );
    expect(progressSummary(progress)).toEqual({ mastered: 1, practising: 1, unmeasured: 2, total: 4 });
  });

  it('handles an empty profile', () => {
    expect(progressSummary(keyProgress({}, []))).toEqual({ mastered: 0, practising: 0, unmeasured: 0, total: 0 });
  });
});

describe('nearestToMastery', () => {
  const progress = keyProgress(
    {
      a: stat(140, 1, 200),   // good rate, just short of the attempts gate
      b: stat(140, 40, 200),  // a long way off
      c: stat(400, 0, 200),   // already mastered
      d: stat(200, 20, 200),  // enough attempts, held back by the rate
    },
    ['a', 'b', 'c', 'd'],
  );

  it('excludes mastered keys and ranks the rest by closeness', () => {
    expect(nearestToMastery(progress).map(p => p.key)).toEqual(['a', 'd', 'b']);
  });

  it('says when a key is held back only by needing more mileage', () => {
    const a = nearestToMastery(progress).find(p => p.key === 'a')!;
    expect(a.awaitingEvidence).toBe(true);
    expect(a.attemptsRemaining).toBe(MASTERY_ATTEMPTS - 140);
  });

  it('says when a key is held back by its error rate instead', () => {
    const d = nearestToMastery(progress).find(p => p.key === 'd')!;
    expect(d.awaitingEvidence).toBe(false);
    expect(d.attemptsRemaining).toBe(0);
    expect(d.errorRate).toBeCloseTo(0.1);
  });

  it('honours the limit', () => {
    expect(nearestToMastery(progress, 2)).toHaveLength(2);
  });

  it('returns nothing when there is no data', () => {
    expect(nearestToMastery(keyProgress({}, ['a', 'b']))).toEqual([]);
  });
});

describe('coercion', () => {
  it('survives missing or malformed Firestore data', () => {
    expect(coerceKeyStats(null)).toEqual({});
    expect(coerceKeyStats('nope')).toEqual({});
    expect(coerceKeyStats({ a: { attempts: 5 } }).a).toEqual({
      attempts: 5, errors: 0, latencyN: 0, latencySum: 0, latencySumSq: 0,
    });
    expect(coerceKeyStats({ a: { attempts: -3, errors: 'x' } }).a.attempts).toBe(0);
  });

  it('drops digraphs with no observations', () => {
    expect(coerceDigraphStats({ th: { n: 0, sumMs: 100 }, er: { n: 5, sumMs: 500 } })).toEqual({
      er: { n: 5, sumMs: 500 },
    });
  });
});
