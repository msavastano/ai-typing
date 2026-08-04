/**
 * The curriculum planner.
 *
 * The language model is good at writing readable English and bad at deciding what
 * a learner should practise — it has no memory, no measurements, and no reason to
 * be consistent between sessions. So the decision is made here, deterministically
 * and testably, and the model is handed a plan to satisfy.
 *
 * Everything that varies between sessions varies off a single rotation index, so
 * consecutive lessons differ by construction rather than by luck.
 */

import { pickConstraints, type VarietyConstraints } from './lesson-variety';
import type { StruggleKey, StruggleReason } from './skill-model';

// ── Types ────────────────────────────────────────────────────────

export type LessonMode = 'prose' | 'drill' | 'code' | 'punctuation' | 'numerals';

export type Stretch = 'capitals' | 'punctuation' | 'numerals' | 'symbols';

/** 1 = starting out, 2 = building, 3 = fluent. */
export type Tier = 1 | 2 | 3;

export interface PlanTarget {
  key: string;
  /** 'chosen' means the user picked it by hand, overriding the model. */
  reason: StruggleReason | 'chosen';
}

export interface LessonPlan {
  mode: LessonMode;
  tier: Tier;
  wordCount: [number, number];
  targets: PlanTarget[];
  /** Mastered keys brought back so they stay warm. */
  review: string[];
  /** One element pitched just above the current tier, or null when the mode is already a stretch. */
  stretch: Stretch | null;
  digraphs: string[];
  confusions: string[];
  topic: string;
  constraints: VarietyConstraints;
  chunkIndex: number;
  totalChunks: number;
  /** Plain-English account of why this plan looks the way it does. */
  rationale: string[];
}

export interface PlanInput {
  /** Monotonic rotation index; see varietyIndex in lesson-variety. */
  index: number;
  totalLessons: number;
  /** Trailing-window wpm, not a lifetime average. */
  level: number;
  levelAccuracy: number;
  /** Topic with any "custom:" prefix already stripped. */
  topic: string;
  struggleKeys: StruggleKey[];
  masteredKeys: string[];
  focusKeys: string[];
  slowDigraphs: string[];
  confusions: string[];
  chunkIndex: number;
  totalChunks: number;
}

const MAX_TARGETS = 5;

/** A drill is for an acute problem; below this a target belongs in ordinary prose. */
const DRILL_SCORE_THRESHOLD = 0.25;

const WORD_COUNTS: Record<Tier, [number, number]> = {
  1: [25, 35],
  2: [35, 50],
  3: [50, 70],
};

const DIFFICULTY: Record<Tier, string> = {
  1: 'Use simple, common words with short sentences.',
  2: 'Use moderately complex vocabulary with varied sentence structure.',
  3: 'Use rich vocabulary and varied punctuation, including commas, semicolons and hyphens.',
};

/** Stretch options per tier, rotated by index so they cycle rather than repeat. */
const STRETCH_BY_TIER: Record<Tier, Stretch[]> = {
  1: ['capitals'],
  2: ['capitals', 'punctuation'],
  3: ['punctuation', 'numerals', 'symbols'],
};

// ── Planning ─────────────────────────────────────────────────────

export function tierFor(totalLessons: number, level: number, levelAccuracy: number): Tier {
  if (totalLessons < 5 || level < 25) return 1;
  if (level < 45 || levelAccuracy < 85) return 2;
  return 3;
}

const TIER_LABELS: Record<Tier, { name: string; detail: string }> = {
  1: { name: 'Finding your footing', detail: 'Short lessons built from simple, common words.' },
  2: { name: 'Building speed', detail: 'Longer lessons with varied sentences and richer vocabulary.' },
  3: { name: 'Refining', detail: 'Full-length lessons with dense punctuation, numerals and proper nouns.' },
};

/** How the current tier should be described to the user. */
export function tierLabel(tier: Tier): { name: string; detail: string } {
  return TIER_LABELS[tier];
}

function describeKey(key: string): string {
  if (key === ' ') return 'space';
  return key;
}

/**
 * Modes are drawn from a weighted rotation. Prose holds several slots because it
 * is the ordinary case; the specialised modes appear only when the user's data
 * says they are worth spending a session on.
 */
export function modeRotation(
  tier: Tier,
  topic: string,
  hasTargets: boolean,
  worstScore: number,
  hasPunctuationTarget: boolean,
  hasDigitTarget: boolean,
): LessonMode[] {
  const rotation: LessonMode[] = ['prose'];

  if (topic === 'programming') rotation.push('code');
  rotation.push('prose');

  // Drills only earn a slot when something is genuinely going wrong; otherwise
  // repetitive word lists are a worse use of a session than reading real prose.
  if (hasTargets && (tier === 1 || worstScore >= DRILL_SCORE_THRESHOLD)) {
    rotation.push('drill');
  }
  rotation.push('prose');

  if (hasPunctuationTarget || tier >= 2) rotation.push('punctuation');
  if (hasDigitTarget || tier === 3) rotation.push('numerals');

  return rotation;
}

export function planLesson(input: PlanInput): LessonPlan {
  const index = Math.max(0, Math.trunc(input.index) || 0);
  const tier = tierFor(input.totalLessons, input.level, input.levelAccuracy);
  const rationale: string[] = [];

  // What to practise: an explicit user choice wins outright, otherwise the skill
  // model's ranking. Neither is invented here — this only decides how to use it.
  const userChose = input.focusKeys.length > 0;
  const targets: PlanTarget[] = userChose
    ? input.focusKeys.slice(0, MAX_TARGETS).map(key => ({ key, reason: 'chosen' as const }))
    : input.struggleKeys.slice(0, MAX_TARGETS).map(s => ({ key: s.key, reason: s.reason }));

  const worstScore = input.struggleKeys.length > 0 ? input.struggleKeys[0].score : 0;
  const targetKeys = new Set(targets.map(t => t.key));
  const isPunctuation = (k: string) => /[^a-zA-Z0-9\s]/.test(k);
  const isDigit = (k: string) => /[0-9]/.test(k);

  const rotation = modeRotation(
    tier,
    input.topic,
    targets.length > 0,
    worstScore,
    targets.some(t => isPunctuation(t.key)),
    targets.some(t => isDigit(t.key)),
  );
  const mode = rotation[index % rotation.length];

  // Spaced review: cycle through mastered keys by index so each comes back around
  // periodically. No "last practised" timestamp is needed — the rotation is the
  // schedule.
  const reviewPool = input.masteredKeys.filter(k => !targetKeys.has(k)).sort();
  const review = reviewPool.length > 0 ? [reviewPool[index % reviewPool.length]] : [];

  // Modes that are themselves a stretch do not get a second one stacked on top.
  const modeIsAlreadyStretch = mode === 'drill' || mode === 'punctuation' || mode === 'numerals';
  const stretchOptions = STRETCH_BY_TIER[tier];
  const stretch = modeIsAlreadyStretch ? null : stretchOptions[index % stretchOptions.length];

  // The mode leads the rationale whenever it is not ordinary prose, because that
  // is what the user will notice first about the lesson in front of them.
  const targetNames = targets.map(t => describeKey(t.key)).join(', ');
  switch (mode) {
    case 'drill':
      rationale.push(`Drill on ${targetNames} — these need repetition more than they need something to read.`);
      break;
    case 'code':
      rationale.push('Code format, to practise the symbols and punctuation programmers reach for constantly.');
      break;
    case 'punctuation':
      rationale.push('Punctuation-heavy text — the marks between words are where most speed is lost.');
      break;
    case 'numerals':
      rationale.push('Number-heavy text, since the digit row gets far less practice than the letters.');
      break;
  }

  if (userChose) {
    rationale.push(`Practising the keys you picked: ${targetNames}.`);
  } else if (targets.length > 0) {
    const mistyped = targets.filter(t => t.reason !== 'speed').map(t => describeKey(t.key));
    const slow = targets.filter(t => t.reason !== 'accuracy').map(t => describeKey(t.key));
    if (mistyped.length > 0) rationale.push(`Targeting ${mistyped.join(', ')} — mistyped more often than the keys around them.`);
    if (slow.length > 0) rationale.push(`Targeting ${slow.join(', ')} — accurate but slow to reach.`);
  } else {
    rationale.push('No weak keys measured yet, so this is general practice while data builds up.');
  }

  if (review.length > 0) {
    rationale.push(`Keeping ${describeKey(review[0])} warm — you have it, so it only needs a light touch.`);
  }

  if (stretch) {
    rationale.push(`Stretching you slightly with ${stretch}.`);
  }

  const digraphs = input.slowDigraphs.slice(0, 3);
  if (digraphs.length > 0) {
    rationale.push(`Working the slow transitions ${digraphs.join(', ')}.`);
  }

  return {
    mode,
    tier,
    wordCount: WORD_COUNTS[tier],
    targets,
    review,
    stretch,
    digraphs,
    confusions: input.confusions.slice(0, 3),
    topic: input.topic,
    constraints: pickConstraints(index),
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    rationale,
  };
}

// ── Prompt rendering ─────────────────────────────────────────────

const STRETCH_INSTRUCTION: Record<Stretch, string> = {
  capitals: 'Include several capitalised proper nouns so the shift key gets used.',
  punctuation: 'Include commas and straight apostrophes, and at least one semicolon or colon.',
  numerals: 'Include at least three numbers written as numerals rather than words.',
  symbols: 'Include a few symbols that require a reach, such as & % / # or @.',
};

/** Turn a plan into the instruction the model actually receives. */
export function renderLessonPrompt(plan: LessonPlan, recentOpeningsList: string[] = []): string {
  const [minWords, maxWords] = plan.wordCount;
  const wordCount = `${minWords}-${maxWords}`;
  const targetKeys = plan.targets.map(t => t.key);
  const { angle, anchor, register } = plan.constraints;

  let prompt: string;

  switch (plan.mode) {
    case 'drill':
      prompt = `Generate a focused typing drill of around ${wordCount} words that builds muscle memory for these keys: ${targetKeys.join(', ')}. Use a variety of real, common short words featuring those letters. Do NOT repeat any word more than twice, and vary the sentence structure — for example "jeff fed the fluffy fox five figs and found fresh fruit" for the letter f.`;
      break;

    case 'code':
      prompt = `Generate a realistic-looking code snippet of around ${wordCount} words for a typing test. Use common programming patterns: variable declarations, function calls, if/else blocks, loops, string literals and comments. Use the symbols programmers type often: = {} () [] ; : . , < > / " ' \` _ - + && ||. Output plain text that looks like code but can be typed as one continuous block with no line breaks.`;
      if (targetKeys.length > 0) {
        prompt += ` Name variables and functions so they use these letters the user struggles with: ${targetKeys.join(', ')}.`;
      }
      break;

    case 'punctuation':
      prompt = `Generate a single paragraph of around ${wordCount} words that is unusually rich in punctuation: commas, apostrophes, quotation marks, semicolons, colons, hyphens and parentheses. ${DIFFICULTY[plan.tier]} ${angle} ${register} The punctuation must read naturally — it should come from the sentences, not be sprinkled on top.`;
      break;

    case 'numerals':
      prompt = `Generate a single paragraph of around ${wordCount} words containing many numbers written as numerals — dates, quantities, prices, measurements, times. Include at least eight separate numerals. ${DIFFICULTY[plan.tier]} ${angle} ${register}`;
      break;

    default:
      prompt = `Generate a single paragraph of plain prose of around ${wordCount} words for a typing test. ${DIFFICULTY[plan.tier]} ${angle} ${register}`;
      break;
  }

  // Code and drills have their own subject matter — a drill is a word list built
  // around letters, so asking it to be "about science" only muddies the output.
  if (plan.topic && plan.topic !== 'general' && plan.mode !== 'code' && plan.mode !== 'drill') {
    prompt += ` Write about the topic: ${plan.topic}.`;
  }

  if (plan.totalChunks > 1) {
    prompt += ` This is exercise ${plan.chunkIndex + 1} of ${plan.totalChunks} in a session — make it distinct from the others.`;
  }

  // A key can be a target because it goes wrong or because it is slow, and those
  // want different text: spread repetition versus fluent, rhythmic words.
  if (plan.mode !== 'drill' && plan.targets.length > 0) {
    const mistyped = plan.targets.filter(t => t.reason === 'accuracy' || t.reason === 'both').map(t => t.key);
    const slow = plan.targets.filter(t => t.reason === 'speed' || t.reason === 'both').map(t => t.key);
    const chosen = plan.targets.filter(t => t.reason === 'chosen').map(t => t.key);

    if (chosen.length > 0) {
      prompt += ` Feature these letters heavily: ${chosen.join(', ')}.`;
    }
    if (mistyped.length > 0) {
      prompt += ` The user mistypes ${mistyped.join(', ')} — place these across several different words rather than repeating one word.`;
    }
    if (slow.length > 0) {
      prompt += ` The user is accurate but slow on ${slow.join(', ')} — use these inside common, fluent words they can build rhythm on.`;
    }
  }

  if (plan.review.length > 0) {
    prompt += ` Also work in a little of ${plan.review.join(', ')}, lightly — this is review, not a focus.`;
  }

  if (plan.digraphs.length > 0) {
    prompt += ` The user slows down on the letter transitions ${plan.digraphs.join(', ')} — include several words containing them.`;
  }

  if (plan.confusions.length > 0) {
    const described = plan.confusions.map(pair => {
      const [expected, typed] = pair.split('→');
      return `confuses "${expected}" with "${typed}"`;
    });
    prompt += ` The user often ${described.join(', and ')}. Include words that practise the correct keys.`;
  }

  if (plan.stretch) {
    prompt += ` ${STRETCH_INSTRUCTION[plan.stretch]}`;
  }

  prompt += ` ${anchor}`;

  // The model has no memory of what it produced last time, so hand it back.
  if (recentOpeningsList.length > 0) {
    prompt += ` The user has recently typed lessons beginning: ${recentOpeningsList.map(o => `"${o}..."`).join('; ')}.`;
    prompt += ' Do NOT reuse those openings, subjects, or their distinctive nouns. Pick a clearly different subject.';
  }

  prompt += ' Do not repeat any word more than 3 times in the entire text.';

  // The user has to reproduce this on a physical keyboard, so anything without a
  // key on it makes the lesson impossible to complete. Output is sanitised
  // afterwards regardless, but asking cleanly gives better-formed text.
  prompt += ' Use ONLY plain ASCII characters that exist on a standard US keyboard: straight apostrophes and quotes, and the plain hyphen. Never use em dashes, en dashes, curly or smart quotes, ellipsis characters, or accented letters.';

  prompt += ' Output ONLY the text. No quotes, no markdown, no labels, no bullet points.';

  return prompt;
}

/** One-line summary of the plan, shown to the user during the lesson. */
export function planSummary(plan: LessonPlan): string {
  return plan.rationale[0] ?? 'General practice.';
}
