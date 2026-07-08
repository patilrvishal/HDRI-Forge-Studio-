import React, { useCallback } from 'react';
import { clamp } from '../../utils/math';

interface NumericInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  width?: string;
}

export const NumericInput: React.FC<NumericInputProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
  width,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseFloat(e.target.value);
      if (isNaN(parsed)) return;
      const clamped = clamp(parsed, min ?? -Infinity, max ?? Infinity);
      onChange(clamped);
    },
    [onChange, min, max]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const parsed = parseFloat(e.target.value);
      if (isNaN(parsed)) {
        e.target.value = String(value);
        return;
      }
      const clamped = clamp(parsed, min ?? -Infinity, max ?? Infinity);
      if (clamped !== parsed) {
        e.target.value = String(clamped);
      }
      onChange(clamped);
    },
    [onChange, min, max, value]
  );

  return (
    <div className={`field-row ${className}`}>
      <span className="field-label">{label}</span>
      <input
        className="field-input numeric-input"
        type="number"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
        style={width ? { width } : undefined}
      />
    </div>
  );
};