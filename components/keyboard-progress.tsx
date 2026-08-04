'use client';

import { KEYBOARD_ROWS, KEYBOARD_ROW_OFFSETS } from '@/lib/keyboard-layout';
import { MASTERY_ATTEMPTS, type KeyProgress } from '@/lib/skill-model';

const STATE_STYLE = {
  mastered: { background: '#5c6f52', color: '#fff', border: '1px solid #4a5b42', borderBottom: '3px solid #3b4935' },
  practising: { background: '#e8d9c4', color: '#2a2620', border: '1px solid #c9b89c', borderBottom: '3px solid #b5a385' },
  unmeasured: { background: '#fcf9f6', color: '#b5b0aa', border: '1px dashed #dcd9d7', borderBottom: '3px solid #e5e2df' },
} as const;

function describe(entry: KeyProgress): string {
  const attempts = Math.round(entry.attempts);
  const rate = `${(entry.errorRate * 100).toFixed(1)}% errors`;

  switch (entry.state) {
    case 'mastered':
      return `${entry.key}: mastered — clean over ${attempts} attempts`;
    case 'practising':
      // Mastery needs both a low error rate and enough attempts. Naming the gate
      // that is actually binding avoids "150 of 150" reading as finished.
      return attempts < MASTERY_ATTEMPTS
        ? `${entry.key}: practising — ${rate}, ${attempts} of ${MASTERY_ATTEMPTS} attempts toward mastery`
        : `${entry.key}: practising — ${rate}, enough practice but the rate is still too high`;
    default:
      return attempts > 0
        ? `${entry.key}: only ${attempts} attempt${attempts === 1 ? '' : 's'} so far, not enough to judge`
        : `${entry.key}: not typed yet`;
  }
}

export default function KeyboardProgress({ progress }: { progress: KeyProgress[] }) {
  const byKey = new Map(progress.map(p => [p.key, p]));

  return (
    <div className="flex flex-col items-center gap-1.5">
      {KEYBOARD_ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-1.5" style={{ paddingLeft: KEYBOARD_ROW_OFFSETS[rowIdx] }}>
          {row.map(key => {
            const entry = byKey.get(key);
            const state = entry?.state ?? 'unmeasured';
            return (
              <div
                key={key}
                className="relative flex items-center justify-center font-mono text-xs font-semibold rounded-[5px] w-[34px] h-[34px] overflow-hidden transition-colors"
                style={STATE_STYLE[state]}
                title={entry ? describe(entry) : `${key}: not typed yet`}
              >
                {/* Fill showing how far this key has come toward the evidence gate. */}
                {state === 'practising' && (
                  <span
                    aria-hidden
                    className="absolute left-0 bottom-0 w-full bg-[#c9a07a] opacity-45"
                    style={{ height: `${Math.round((entry?.evidence ?? 0) * 100)}%` }}
                  />
                )}
                <span className="relative">{key}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="flex items-center gap-4 mt-2.5 text-[0.68rem] text-[#7b7771] flex-wrap justify-center">
        {([
          ['mastered', 'Mastered'],
          ['practising', 'Practising'],
          ['unmeasured', 'Not enough data'],
        ] as const).map(([state, label]) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-sm" style={STATE_STYLE[state]} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
