'use client';

import { KEYBOARD_ROWS as ROWS, KEYBOARD_ROW_OFFSETS as ROW_OFFSETS } from '@/lib/keyboard-layout';

function getHeatStyle(intensity: number): { bg: string; color: string } {
  if (intensity === 0) return { bg: '#fcf9f6', color: '#2a2620' };
  if (intensity < 0.25) return { bg: '#ece1d0', color: '#2a2620' };
  if (intensity < 0.5) return { bg: '#e8d9c4', color: '#2a2620' };
  if (intensity < 0.75) return { bg: '#c9a07a', color: '#2a2620' };
  return { bg: '#8a4a3a', color: '#fff' };
}

interface KeyboardHeatmapProps {
  weakKeys: Record<string, number>;
  /**
   * Per-key error rate, 0..1. When available this drives the heat instead of raw
   * counts — counts just rank letters by how often they appear in English.
   */
  errorRates?: Record<string, number>;
}

export default function KeyboardHeatmap({ weakKeys, errorRates }: KeyboardHeatmapProps) {
  const useRates = !!errorRates && Object.keys(errorRates).length > 0;
  const source = useRates ? errorRates! : weakKeys;
  const values = Object.values(source);
  const maxValue = Math.max(...values, useRates ? 0.01 : 1);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex gap-1.5" style={{ paddingLeft: ROW_OFFSETS[rowIdx] }}>
          {row.map((key) => {
            const value = source[key] || 0;
            const intensity = value / maxValue;
            const { bg, color } = getHeatStyle(intensity);
            const label = useRates
              ? value > 0
                ? `${key}: ${(value * 100).toFixed(1)}% error rate`
                : `${key}: no errors recorded`
              : value > 0
                ? `${key}: ${value} error${value !== 1 ? 's' : ''}`
                : key;
            return (
              <div
                key={key}
                className="flex items-center justify-center font-mono text-xs font-semibold border border-[#dcd9d7] rounded-[5px] w-[34px] h-[34px] transition-colors"
                style={{
                  background: bg,
                  color,
                  borderBottom: '3px solid rgba(40,34,24,0.18)',
                }}
                title={label}
              >
                {key}
              </div>
            );
          })}
        </div>
      ))}
      {values.length > 0 && values.some(v => v > 0) && (
        <div className="flex items-center gap-2 mt-2 text-[0.68rem] text-ink-subtle">
          <span>{useRates ? 'Lower error rate' : 'Fewer errors'}</span>
          <div className="flex gap-0.5">
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#fcf9f6' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#e8d9c4' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#c9a07a' }} />
            <div className="w-3.5 h-3.5 rounded-sm border border-[#dcd9d7]" style={{ background: '#8a4a3a' }} />
          </div>
          <span>{useRates ? 'Higher error rate' : 'More errors'}</span>
        </div>
      )}
    </div>
  );
}
