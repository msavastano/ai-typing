'use client';

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const ROW_OFFSETS = [0, 18, 46];

function getHeatStyle(intensity: number): { bg: string; color: string } {
  if (intensity === 0) return { bg: '#fcf9f6', color: '#2a2620' };
  if (intensity < 0.25) return { bg: '#ece1d0', color: '#2a2620' };
  if (intensity < 0.5) return { bg: '#e8d9c4', color: '#2a2620' };
  if (intensity < 0.75) return { bg: '#c9a07a', color: '#2a2620' };
  return { bg: '#8a4a3a', color: '#fff' };
}

interface KeyboardHeatmapProps {
  weakKeys: Record<string, number>;
}

export default function KeyboardHeatmap({ weakKeys }: KeyboardHeatmapProps) {
  const values = Object.values(weakKeys);
  const maxErrors = Math.max(...values, 1);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-1.5" style={{ paddingLeft: ROW_OFFSETS[rowIdx] }}>
          {row.map((key) => {
            const errors = weakKeys[key] || 0;
            const intensity = errors / maxErrors;
            const { bg, color } = getHeatStyle(intensity);
            return (
              <div
                key={key}
                className="flex items-center justify-center font-mono text-xs font-semibold border border-[#dcd9d7] rounded-[5px] w-[34px] h-[34px] transition-colors"
                style={{
                  background: bg,
                  color,
                  borderBottom: '3px solid rgba(40,34,24,0.18)',
                }}
                title={errors > 0 ? `${key}: ${errors} error${errors !== 1 ? 's' : ''}` : key}
              >
                {key}
              </div>
            );
          })}
        </div>
      ))}
      {values.length > 0 && values.some(v => v > 0) && (
        <div className="flex items-center gap-2 mt-2 text-[0.68rem] text-ink-subtle">
          <span>Fewer errors</span>
          <div className="flex gap-0.5">
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#fcf9f6' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#e8d9c4' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#c9a07a' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#8a4a3a' }} />
          </div>
          <span>More errors</span>
        </div>
      )}
    </div>
  );
}
