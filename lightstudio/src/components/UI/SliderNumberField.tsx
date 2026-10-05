import React, { useState } from 'react';

/** Decimal places to show for a given step (0.05 -> 2, 0.25 -> 2, 1 -> 0). */
export function decimalsForStep(step: number): number {
  if (!(step > 0) || Number.isInteger(step)) return 0;
  const frac = String(step).split('.')[1] ?? '';
  return Math.min(4, frac.length);
}

interface SliderNumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Smallest / largest value that can be typed (may be wider than the slider's own range). */
  min: number;
  max: number;
  step?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Editable value box that sits next to a slider. Typing applies live (clamped to
 * min..max); the box shows the raw text while it has focus and snaps back to the
 * canonical formatted value on blur. Enter confirms, Escape cancels, arrow keys step.
 */
export const SliderNumberField: React.FC<SliderNumberFieldProps> = ({
  value, onChange, min, max, step = 1, label, className = 'slider-input', style,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const dec = decimalsForStep(step);

  const commit = (text: string) => {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, n)));
  };

  return (
    <input
      className={className}
      style={style}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      aria-label={label}
      value={draft ?? (Number.isFinite(value) ? value.toFixed(dec) : '')}
      onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
      onFocus={(e) => e.target.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
      }}
    />
  );
};
