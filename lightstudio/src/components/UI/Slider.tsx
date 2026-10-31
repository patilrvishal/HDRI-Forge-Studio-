import React, { useCallback } from 'react';
import { SliderNumberField } from './SliderNumberField';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  unit?: string;
  showValue?: boolean;
  className?: string;
  /** Typed values may go beyond the slider's own range (default: the slider range). */
  inputMin?: number;
  inputMax?: number;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = '',
  showValue = true,
  className = '',
  inputMin,
  inputMax,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange]
  );

  return (
    <div className={`slider-row ${className}`} style={className ? undefined : undefined}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
      />
      {showValue && (
        <>
          <SliderNumberField
            value={value}
            onChange={onChange}
            min={inputMin ?? min}
            max={inputMax ?? max}
            step={step}
            label={label}
          />
          {unit && <span className="slider-unit">{unit}</span>}
        </>
      )}
    </div>
  );
};
