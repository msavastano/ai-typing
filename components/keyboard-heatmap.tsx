'use client';

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

function getHeatColor(intensity: number): string {
  // intensity 0..1 → zinc-800 (cool) to red-500 (hot)
  if (intensity === 0) return 'bg-zinc-800 text-zinc-500';
  if (intensity < 0.25) return 'bg-yellow-900/40 text-yellow-400';
  if (intensity < 0.5) return 'bg-orange-900/50 text-orange-400';
  if (intensity < 0.75) return 'bg-red-900/50 text-red-400';
  return 'bg-red-700/60 text-red-300';
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
        <div key={rowIdx} className="flex gap-1.5" style={{ paddingLeft: rowIdx * 16 }}>
          {row.map((key) => {
            const errors = weakKeys[key] || 0;
            const intensity = errors / maxErrors;
            const heatClass = getHeatColor(intensity);
            return (
              <div
                key={key}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-mono font-semibold transition-colors ${heatClass}`}
                title={errors > 0 ? `${key}: ${errors} error${errors !== 1 ? 's' : ''}` : key}
              >
                {key}
              </div>
            );
          })}
        </div>
      ))}
      {values.length > 0 && values.some(v => v > 0) && (
        <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
          <span>Fewer errors</span>
          <div className="flex gap-0.5">
            <div className="w-4 h-2 rounded-sm bg-zinc-800" />
            <div className="w-4 h-2 rounded-sm bg-yellow-900/40" />
            <div className="w-4 h-2 rounded-sm bg-orange-900/50" />
            <div className="w-4 h-2 rounded-sm bg-red-900/50" />
            <div className="w-4 h-2 rounded-sm bg-red-700/60" />
          </div>
          <span>More errors</span>
        </div>
      )}
    </div>
  );
}
