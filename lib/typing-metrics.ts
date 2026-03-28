/**
 * Pure functions for typing test metrics calculations.
 * Extracted from typing-test component for testability.
 */

export const DECAY_FACTOR = 0.7;

/** Apply decay to error counts, dropping keys that round to zero. */
export function applyDecay(keys: Record<string, number>): Record<string, number> {
  const decayed: Record<string, number> = {};
  for (const [k, v] of Object.entries(keys)) {
    const val = Math.round(v * DECAY_FACTOR);
    if (val > 0) decayed[k] = val;
  }
  return decayed;
}

/** Count characters in finalInput that match the expected text. */
export function countCorrectChars(text: string, finalInput: string): number {
  let correct = 0;
  for (let i = 0; i < text.length; i++) {
    if (finalInput[i] === text[i]) correct++;
  }
  return correct;
}

/** Net WPM: only correctly typed characters count (1 word = 5 chars). */
export function calculateWpm(correctChars: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const durationMinutes = durationSeconds / 60;
  return Math.max(0, Math.round((correctChars / 5) / durationMinutes));
}

/** Count uncorrected errors (positions where finalInput differs from text). */
export function countUncorrectedErrors(text: string, finalInput: string): number {
  let errors = 0;
  for (let i = 0; i < text.length; i++) {
    if (finalInput[i] !== text[i]) errors++;
  }
  return errors;
}

/** Accuracy percentage (0-100) based on error count vs total characters. */
export function calculateAccuracy(textLength: number, errors: number): number {
  if (textLength <= 0) return 0;
  return Math.max(0, Math.round(((textLength - errors) / textLength) * 100));
}

/** Compute updated running average given old average, old count, and new value. */
export function updateRunningAverage(oldAvg: number, oldCount: number, newValue: number): number {
  const newCount = oldCount + 1;
  return ((oldAvg * oldCount) + newValue) / newCount;
}

/** Merge new error counts into decayed existing counts. */
export function mergeWithDecay(
  existing: Record<string, number>,
  newCounts: Record<string, number>
): Record<string, number> {
  const decayed = applyDecay(existing);
  const merged = { ...decayed };
  for (const [key, count] of Object.entries(newCounts)) {
    merged[key] = (merged[key] || 0) + count;
  }
  return merged;
}
