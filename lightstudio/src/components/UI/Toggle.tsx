import React, { useCallback } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** 'glossy' renders the physical slide-switch look (dotted handle +
   *  glowing ON/OFF readout) used as a trial in the Properties panel. */
  variant?: 'default' | 'glossy';
}

const DOT_COUNT = 9;

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, variant = 'default' }) => {
  const handleClick = useCallback(() => {
    onChange(!checked);
  }, [checked, onChange]);

  const switchEl =
    variant === 'glossy' ? (
      <div
        className={`glossy-toggle ${checked ? 'on' : 'off'}`}
        onClick={handleClick}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <span className="glossy-toggle-label">{checked ? 'ON' : 'OFF'}</span>
        <div className="glossy-toggle-handle">
          <span className="glossy-toggle-dots">
            {Array.from({ length: DOT_COUNT }).map((_, i) => (
              <span key={i} />
            ))}
          </span>
        </div>
      </div>
    ) : (
      <div
        className={`toggle-track ${checked ? 'on' : ''}`}
        onClick={handleClick}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      />
    );

  return (
    <div className="field-row">
      {label && <span className="field-label">{label}</span>}
      {switchEl}
    </div>
  );
};