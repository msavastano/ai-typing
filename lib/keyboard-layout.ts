/** Shared QWERTY layout, so the heatmap, progress map and focus picker agree. */

export const KEYBOARD_ROWS: readonly (readonly string[])[] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/** Left indent per row, in pixels, to give the staggered keyboard look. */
export const KEYBOARD_ROW_OFFSETS = [0, 18, 46];

/** Every letter key, in layout order. */
export const KEYBOARD_LETTERS: readonly string[] = KEYBOARD_ROWS.flat();
