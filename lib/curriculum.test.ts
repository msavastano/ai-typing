import { describe, it, expect } from 'vitest';
import {
  planLesson,
  renderLessonPrompt,
  planSummary,
  tierFor,
  modeRotation,
  type PlanInput,
  type LessonMode,
} from './curriculum';
import type { StruggleKey } from './skill-model';

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    index: 0,
    totalLessons: 20,
    level: 40,
    levelAccuracy: 92,
    topic: 'general',
    struggleKeys: [],
    masteredKeys: [],
    focusKeys: [],
    slowDigraphs: [],
    confusions: [],
    chunkIndex: 0,
    totalChunks: 1,
    ...overrides,
  };
}

function struggle(key: string, score: number, reason: StruggleKey['reason'] = 'accuracy'): StruggleKey {
  return { key, score, reason };
}

describe('tierFor', () => {
  it('keeps newcomers at tier 1 regardless of speed', () => {
    expect(tierFor(2, 80, 99)).toBe(1);
  });

  it('uses speed and accuracy once there is history', () => {
    expect(tierFor(50, 20, 99)).toBe(1);
    expect(tierFor(50, 40, 99)).toBe(2);
    expect(tierFor(50, 60, 80)).toBe(2); // fast but inaccurate
    expect(tierFor(50, 60, 95)).toBe(3);
  });
});

describe('modeRotation', () => {
  it('always includes prose more than once', () => {
    const rotation = modeRotation(2, 'general', false, 0, false, false);
    expect(rotation.filter(m => m === 'prose').length).toBeGreaterThan(1);
  });

  it('offers code only for the programming topic', () => {
    expect(modeRotation(2, 'general', true, 0.5, false, false)).not.toContain('code');
    expect(modeRotation(2, 'programming', true, 0.5, false, false)).toContain('code');
  });

  it('withholds drills when nothing is badly wrong', () => {
    expect(modeRotation(3, 'general', true, 0.05, false, false)).not.toContain('drill');
    expect(modeRotation(3, 'general', true, 0.4, false, false)).toContain('drill');
  });

  it('always offers drills to beginners with targets', () => {
    expect(modeRotation(1, 'general', true, 0.01, false, false)).toContain('drill');
  });

  it('withholds drills when there is nothing to drill', () => {
    expect(modeRotation(1, 'general', false, 0, false, false)).not.toContain('drill');
  });

  it('offers numerals to fluent typists or anyone weak on digits', () => {
    expect(modeRotation(2, 'general', false, 0, false, false)).not.toContain('numerals');
    expect(modeRotation(3, 'general', false, 0, false, false)).toContain('numerals');
    expect(modeRotation(2, 'general', true, 0.3, false, true)).toContain('numerals');
  });
});

describe('planLesson — target selection', () => {
  it('lets an explicit user choice override the model', () => {
    const plan = planLesson(input({
      focusKeys: ['q', 'z'],
      struggleKeys: [struggle('p', 0.4)],
    }));
    expect(plan.targets.map(t => t.key)).toEqual(['q', 'z']);
    expect(plan.targets.every(t => t.reason === 'chosen')).toBe(true);
  });

  it('uses the skill model when the user has not chosen', () => {
    const plan = planLesson(input({ struggleKeys: [struggle('p', 0.4), struggle('b', 0.2, 'speed')] }));
    expect(plan.targets).toEqual([
      { key: 'p', reason: 'accuracy' },
      { key: 'b', reason: 'speed' },
    ]);
  });

  it('caps the target count', () => {
    const many = 'abcdefgh'.split('').map(k => struggle(k, 0.3));
    expect(planLesson(input({ struggleKeys: many })).targets).toHaveLength(5);
  });

  it('says so plainly when there is nothing measured yet', () => {
    const plan = planLesson(input({ totalLessons: 0, level: 0, levelAccuracy: 0 }));
    expect(plan.targets).toEqual([]);
    expect(planSummary(plan)).toMatch(/no weak keys measured/i);
  });
});

describe('planLesson — spaced review', () => {
  it('brings back one mastered key at a time', () => {
    const plan = planLesson(input({ masteredKeys: ['f', 'j', 'k'] }));
    expect(plan.review).toHaveLength(1);
  });

  it('cycles through the mastered set across sessions', () => {
    const mastered = ['f', 'j', 'k'];
    const seen = [0, 1, 2].map(i => planLesson(input({ index: i, masteredKeys: mastered })).review[0]);
    expect(new Set(seen).size).toBe(3);
  });

  it('never reviews a key that is already a target', () => {
    const plan = planLesson(input({
      masteredKeys: ['f'],
      struggleKeys: [struggle('f', 0.4)],
      focusKeys: ['f'],
    }));
    expect(plan.review).toEqual([]);
  });

  it('has nothing to review before anything is mastered', () => {
    expect(planLesson(input()).review).toEqual([]);
  });
});

describe('planLesson — mode and stretch', () => {
  it('rotates modes across consecutive sessions', () => {
    const modes: LessonMode[] = [];
    for (let i = 0; i < 6; i++) {
      modes.push(planLesson(input({ index: i, tier: undefined, struggleKeys: [struggle('p', 0.4)] } as Partial<PlanInput>)).mode);
    }
    expect(new Set(modes).size).toBeGreaterThan(1);
  });

  it('does not stack a stretch on a mode that is already one', () => {
    for (let i = 0; i < 12; i++) {
      const plan = planLesson(input({ index: i, level: 60, levelAccuracy: 95, struggleKeys: [struggle('p', 0.5)] }));
      if (plan.mode === 'drill' || plan.mode === 'punctuation' || plan.mode === 'numerals') {
        expect(plan.stretch).toBeNull();
      }
    }
  });

  it('pitches the stretch at the tier', () => {
    const beginner = planLesson(input({ totalLessons: 1, level: 10, levelAccuracy: 70 }));
    expect(beginner.stretch).toBe('capitals');

    const fluent = planLesson(input({ index: 1, level: 60, levelAccuracy: 95 }));
    expect(['punctuation', 'numerals', 'symbols']).toContain(fluent.stretch);
  });

  it('scales word count with tier', () => {
    expect(planLesson(input({ totalLessons: 1 })).wordCount).toEqual([25, 35]);
    expect(planLesson(input({ level: 60, levelAccuracy: 95 })).wordCount).toEqual([50, 70]);
  });
});

describe('planLesson — determinism', () => {
  it('is a pure function of its input', () => {
    const args = input({ index: 7, struggleKeys: [struggle('p', 0.4)], masteredKeys: ['f', 'j'] });
    expect(planLesson(args)).toEqual(planLesson(args));
  });

  it('tolerates a junk index', () => {
    expect(() => planLesson(input({ index: -5 }))).not.toThrow();
    expect(() => planLesson(input({ index: NaN }))).not.toThrow();
  });

  it('leads the rationale with the mode when it is not ordinary prose', () => {
    for (let i = 0; i < 12; i++) {
      const plan = planLesson(input({ index: i, level: 60, levelAccuracy: 95, struggleKeys: [struggle('p', 0.5)] }));
      if (plan.mode === 'punctuation') {
        expect(planSummary(plan)).toMatch(/punctuation/i);
      }
      if (plan.mode === 'numerals') {
        expect(planSummary(plan)).toMatch(/number/i);
      }
      if (plan.mode === 'drill') {
        expect(planSummary(plan)).toMatch(/drill/i);
      }
    }
  });

  it('names the target keys in a drill summary', () => {
    let drillPlan = null;
    for (let i = 0; i < 8 && !drillPlan; i++) {
      const plan = planLesson(input({ index: i, totalLessons: 1, level: 10, struggleKeys: [struggle('p', 0.5), struggle('b', 0.4)] }));
      if (plan.mode === 'drill') drillPlan = plan;
    }
    expect(planSummary(drillPlan!)).toContain('p, b');
  });

  it('always explains itself', () => {
    for (let i = 0; i < 10; i++) {
      const plan = planLesson(input({ index: i, struggleKeys: [struggle('p', 0.4)] }));
      expect(plan.rationale.length).toBeGreaterThan(0);
      expect(planSummary(plan).length).toBeGreaterThan(0);
    }
  });
});

describe('renderLessonPrompt', () => {
  it('carries every part of the plan into the prompt', () => {
    const plan = planLesson(input({
      struggleKeys: [struggle('p', 0.4, 'accuracy'), struggle('b', 0.3, 'speed')],
      masteredKeys: ['f'],
      slowDigraphs: ['ct', 'br'],
      confusions: ['e→r'],
      topic: 'science',
    }));
    const prompt = renderLessonPrompt(plan);

    expect(prompt).toContain('science');
    expect(prompt).toMatch(/mistypes[^.]*p/);
    expect(prompt).toMatch(/slow on[^.]*b/);
    expect(prompt).toContain('f');
    expect(prompt).toContain('ct, br');
    expect(prompt).toContain('confuses "e" with "r"');
  });

  it('distinguishes mistyped keys from slow ones', () => {
    const plan = planLesson(input({ struggleKeys: [struggle('p', 0.4, 'accuracy')] }));
    const prompt = renderLessonPrompt(plan);
    expect(prompt).toContain('several different words');
    expect(prompt).not.toContain('build rhythm on');
  });

  it('asks for rhythm rather than repetition for slow keys', () => {
    const plan = planLesson(input({ struggleKeys: [struggle('b', 0.3, 'speed')] }));
    const prompt = renderLessonPrompt(plan);
    expect(prompt).toContain('build rhythm on');
    expect(prompt).not.toContain('several different words');
  });

  it('does not re-state targets inside a drill, which already names them', () => {
    let drillPlan = null;
    for (let i = 0; i < 8 && !drillPlan; i++) {
      const plan = planLesson(input({ index: i, totalLessons: 1, level: 10, struggleKeys: [struggle('p', 0.5)] }));
      if (plan.mode === 'drill') drillPlan = plan;
    }
    expect(drillPlan).not.toBeNull();
    const prompt = renderLessonPrompt(drillPlan!);
    expect(prompt).toContain('typing drill');
    expect(prompt).toContain('p');
    expect(prompt).not.toContain('mistypes');
  });

  it('includes the do-not-reuse list when given one', () => {
    const plan = planLesson(input());
    const prompt = renderLessonPrompt(plan, ['the harbour lights flickered across']);
    expect(prompt).toContain('the harbour lights flickered across');
    expect(prompt).toContain('Do NOT reuse');
  });

  it('omits the do-not-reuse section when there is no history', () => {
    expect(renderLessonPrompt(planLesson(input()))).not.toContain('Do NOT reuse');
  });

  it('always ends with the output format rules', () => {
    for (let i = 0; i < 12; i++) {
      const prompt = renderLessonPrompt(planLesson(input({ index: i, struggleKeys: [struggle('p', 0.4)] })));
      expect(prompt).toContain('Output ONLY the text');
    }
  });

  it('always demands typeable ASCII, in every mode', () => {
    const modes = new Set<LessonMode>();
    for (let i = 0; i < 16; i++) {
      const plan = planLesson(input({
        index: i,
        topic: 'programming',
        level: 60,
        levelAccuracy: 95,
        struggleKeys: [struggle('p', 0.5)],
      }));
      modes.add(plan.mode);
      expect(renderLessonPrompt(plan)).toContain('Never use em dashes');
    }
    // Confirms the loop actually covered the specialised modes, not just prose.
    expect(modes.size).toBeGreaterThan(2);
  });

  it('never asks for a dash, which the model renders as an untypeable em dash', () => {
    for (let i = 0; i < 16; i++) {
      const plan = planLesson(input({ index: i, level: 60, levelAccuracy: 95, struggleKeys: [struggle('p', 0.5)] }));
      const instructions = renderLessonPrompt(plan).replace(/Never use em dashes[^.]*\./, '');
      expect(instructions).not.toMatch(/\bdashes?\b/);
    }
  });

  it('produces a different prompt for consecutive sessions', () => {
    const a = renderLessonPrompt(planLesson(input({ index: 4, struggleKeys: [struggle('p', 0.4)] })));
    const b = renderLessonPrompt(planLesson(input({ index: 5, struggleKeys: [struggle('p', 0.4)] })));
    expect(a).not.toBe(b);
  });

  it('skips the topic for a drill, which is a word list rather than prose', () => {
    let drillPlan = null;
    for (let i = 0; i < 8 && !drillPlan; i++) {
      const plan = planLesson(input({ index: i, totalLessons: 1, level: 10, topic: 'science', struggleKeys: [struggle('p', 0.5)] }));
      if (plan.mode === 'drill') drillPlan = plan;
    }
    expect(drillPlan).not.toBeNull();
    expect(renderLessonPrompt(drillPlan!)).not.toContain('Write about the topic');
  });

  it('keeps the topic for ordinary prose', () => {
    const plan = planLesson(input({ topic: 'science' }));
    expect(plan.mode).toBe('prose');
    expect(renderLessonPrompt(plan)).toContain('Write about the topic: science');
  });

  it('skips the topic for code, which has its own subject matter', () => {
    let codePlan = null;
    for (let i = 0; i < 8 && !codePlan; i++) {
      const plan = planLesson(input({ index: i, topic: 'programming' }));
      if (plan.mode === 'code') codePlan = plan;
    }
    expect(codePlan).not.toBeNull();
    expect(renderLessonPrompt(codePlan!)).not.toContain('Write about the topic');
  });

  it('mentions the block position only in multi-block sessions', () => {
    expect(renderLessonPrompt(planLesson(input({ totalChunks: 1 })))).not.toContain('exercise 1 of');
    expect(renderLessonPrompt(planLesson(input({ totalChunks: 3, chunkIndex: 1 })))).toContain('exercise 2 of 3');
  });
});
