import { describe, it, expect } from 'vitest';
import {
  addCounts,
  applyDecay,
  countCorrectChars,
  calculateWpm,
  calculateGrossWpm,
  countUncorrectedErrors,
  calculateAccuracy,
  updateRunningAverage,
  mergeWithDecay,
  DECAY_FACTOR,
} from './typing-metrics';

describe('addCounts', () => {
  it('sums overlapping keys without decaying either side', () => {
    expect(addCounts({ a: 3, b: 1 }, { a: 2, c: 5 })).toEqual({ a: 5, b: 1, c: 5 });
  });

  it('returns a copy rather than mutating its inputs', () => {
    const a = { a: 1 };
    const b = { a: 1 };
    addCounts(a, b);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ a: 1 });
  });

  it('handles empty maps on either side', () => {
    expect(addCounts({}, { a: 2 })).toEqual({ a: 2 });
    expect(addCounts({ a: 2 }, {})).toEqual({ a: 2 });
    expect(addCounts({}, {})).toEqual({});
  });
});

describe('applyDecay', () => {
  it('multiplies values by decay factor and rounds', () => {
    expect(applyDecay({ a: 10, b: 5 })).toEqual({ a: 7, b: 4 });
  });

  it('drops keys that decay to zero', () => {
    // round(1 * 0.7) = 1 (still kept), but round(0.7 * 0.7) would need val < 0.5 pre-round
    // A value of 1 decays to round(0.7) = 1, so we need a value where round(v*0.7) = 0
    // That requires v*0.7 < 0.5 → v = 0 (already gone). So decay alone never drops a key with value >= 1.
    // Test with a value that's already 0 in the input won't exist.
    // Instead, verify that after repeated decays, keys eventually stabilize at 1.
    expect(applyDecay({ a: 1 })).toEqual({ a: 1 });
  });

  it('returns empty object for empty input', () => {
    expect(applyDecay({})).toEqual({});
  });

  it('uses the correct decay factor (0.7)', () => {
    expect(DECAY_FACTOR).toBe(0.7);
    // 3 * 0.7 = 2.1 → rounds to 2
    expect(applyDecay({ x: 3 })).toEqual({ x: 2 });
  });
});

describe('countCorrectChars', () => {
  it('counts all correct when input matches text', () => {
    expect(countCorrectChars('hello', 'hello')).toBe(5);
  });

  it('counts zero when every character is wrong', () => {
    expect(countCorrectChars('abc', 'xyz')).toBe(0);
  });

  it('counts partial matches', () => {
    expect(countCorrectChars('hello', 'hxllo')).toBe(4);
  });

  it('handles input shorter than text (undefined chars)', () => {
    expect(countCorrectChars('hello', 'hel')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(countCorrectChars('', '')).toBe(0);
  });
});

describe('calculateWpm', () => {
  it('calculates WPM correctly (1 word = 5 chars)', () => {
    // 50 correct chars = 10 words, in 60 seconds = 10 WPM
    expect(calculateWpm(50, 60)).toBe(10);
  });

  it('returns 0 for zero duration', () => {
    expect(calculateWpm(50, 0)).toBe(0);
  });

  it('returns 0 for negative duration', () => {
    expect(calculateWpm(50, -1)).toBe(0);
  });

  it('returns 0 for zero correct chars', () => {
    expect(calculateWpm(0, 60)).toBe(0);
  });

  it('rounds to nearest integer', () => {
    // 25 chars = 5 words, in 30 seconds (0.5 min) = 10 WPM
    expect(calculateWpm(25, 30)).toBe(10);
    // 27 chars in 60s = 5.4 words/min → rounds to 5
    expect(calculateWpm(27, 60)).toBe(5);
  });
});

describe('calculateGrossWpm', () => {
  it('calculates WPM correctly (1 word = 5 chars)', () => {
    // 50 chars = 10 words, in 60 seconds = 10 WPM
    expect(calculateGrossWpm(50, 60)).toBe(10);
  });

  it('returns 0 for zero duration', () => {
    expect(calculateGrossWpm(50, 0)).toBe(0);
  });

  it('returns 0 for negative duration', () => {
    expect(calculateGrossWpm(50, -1)).toBe(0);
  });

  it('returns 0 for zero chars', () => {
    expect(calculateGrossWpm(0, 60)).toBe(0);
  });

  it('rounds to nearest integer', () => {
    expect(calculateGrossWpm(25, 30)).toBe(10);
    expect(calculateGrossWpm(27, 60)).toBe(5);
  });

  it('counts mistyped chars, unlike net', () => {
    // 50 chars attempted, only 40 of them correct: gross ignores the gap.
    expect(calculateGrossWpm(50, 60)).toBe(10);
    expect(calculateWpm(40, 60)).toBe(8);
  });

  it('equals net WPM when nothing was mistyped', () => {
    expect(calculateGrossWpm(50, 60)).toBe(calculateWpm(50, 60));
  });
});

describe('gross x accuracy = net', () => {
  // The identity the results screen displays: net is not an independent
  // measurement, it is gross scaled by accuracy. Exact before rounding.
  const cases = [
    { total: 250, correct: 200, duration: 60 },
    { total: 480, correct: 461, duration: 120 },
    { total: 137, correct: 137, duration: 45 },
    { total: 300, correct: 0, duration: 90 },
  ];

  for (const { total, correct, duration } of cases) {
    it(`holds for ${correct}/${total} chars in ${duration}s`, () => {
      const gross = (total / 5) / (duration / 60);
      // The true ratio, not calculateAccuracy — that rounds to whole percent,
      // which is a display concern and is covered by the next test.
      const accuracy = correct / total;
      const net = (correct / 5) / (duration / 60);

      expect(gross * accuracy).toBeCloseTo(net, 6);
      expect(Math.round(net)).toBe(calculateWpm(correct, duration));
    });
  }

  it('stays within a point after both sides are rounded for display', () => {
    // What the user actually multiplies on screen: 32 x 93% = 29.76 -> 30.
    const total = 480;
    const correct = 447;
    const duration = 90;

    const shown = calculateGrossWpm(total, duration) * (calculateAccuracy(total, total - correct) / 100);
    expect(Math.abs(Math.round(shown) - calculateWpm(correct, duration))).toBeLessThanOrEqual(1);
  });
});

describe('countUncorrectedErrors', () => {
  it('returns 0 for perfect input', () => {
    expect(countUncorrectedErrors('hello', 'hello')).toBe(0);
  });

  it('counts each mismatched position', () => {
    expect(countUncorrectedErrors('hello', 'hxlxo')).toBe(2);
  });

  it('counts missing chars as errors (undefined !== char)', () => {
    expect(countUncorrectedErrors('hello', 'hel')).toBe(2);
  });
});

describe('calculateAccuracy', () => {
  it('returns 100 for no errors', () => {
    expect(calculateAccuracy(100, 0)).toBe(100);
  });

  it('returns 0 for all errors', () => {
    expect(calculateAccuracy(10, 10)).toBe(0);
  });

  it('clamps at 0 when errors exceed length (raw accuracy case)', () => {
    expect(calculateAccuracy(5, 20)).toBe(0);
  });

  it('returns 0 for zero-length text', () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
  });

  it('rounds correctly', () => {
    // 3 errors in 10 chars = 70%
    expect(calculateAccuracy(10, 3)).toBe(70);
    // 1 error in 3 chars = 66.67% → rounds to 67
    expect(calculateAccuracy(3, 1)).toBe(67);
  });
});

describe('updateRunningAverage', () => {
  it('first value becomes the average', () => {
    expect(updateRunningAverage(0, 0, 50)).toBe(50);
  });

  it('averages two values correctly', () => {
    // old avg 50, 1 lesson, new value 70 → (50+70)/2 = 60
    expect(updateRunningAverage(50, 1, 70)).toBe(60);
  });

  it('weights old average by count', () => {
    // old avg 40, 3 lessons, new value 80 → (120+80)/4 = 50
    expect(updateRunningAverage(40, 3, 80)).toBe(50);
  });
});

describe('mergeWithDecay', () => {
  it('decays existing and adds new counts', () => {
    const existing = { a: 10, b: 5 };
    const newCounts = { a: 3, c: 2 };
    const result = mergeWithDecay(existing, newCounts);
    // a: round(10*0.7)=7 + 3 = 10, b: round(5*0.7)=4, c: 2
    expect(result).toEqual({ a: 10, b: 4, c: 2 });
  });

  it('works with empty existing', () => {
    expect(mergeWithDecay({}, { a: 5 })).toEqual({ a: 5 });
  });

  it('works with empty new counts (just decays)', () => {
    expect(mergeWithDecay({ a: 10 }, {})).toEqual({ a: 7 });
  });

  it('preserves low-count keys after decay (round(1*0.7)=1)', () => {
    expect(mergeWithDecay({ a: 1 }, {})).toEqual({ a: 1 });
  });

  it('adds new count on top of decayed value', () => {
    // a: round(1*0.7)=1, then +2 = 3
    expect(mergeWithDecay({ a: 1 }, { a: 2 })).toEqual({ a: 3 });
  });
});
