import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, label }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleChange = useCallback(
    (newColor: string) => {
      onChange(newColor);
    },
    [onChange]
  );

  useEffect(() => {
    if (!open) return;

    const handleDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    // Use a small delay to avoid the toggle click immediately closing the picker
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleDocClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleDocClick);
    };
  }, [open]);

  return (
    <div className="field-row" style={{ position: 'relative' }}>
      {label && <span className="field-label">{label}</span>}
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <div
          onClick={handleToggle}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: color,
            border: '2px solid var(--border-light)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-light)';
          }}
        />
        {open && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 8,
              zIndex: 1000,
            }}
          >
            {/* Arrow */}
            <div
              style={{
                position: 'absolute',
                top: -6,
                left: 8,
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: '6px solid var(--bg-card)',
              }}
            />
            {/* Picker card */}
            <div
              style={{
                width: 180,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius)',
                padding: 8,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
              }}
            >
              <HexColorPicker color={color} onChange={handleChange} style={{ width: '100%' }} />
              <div
                style={{
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-sec)',
                  textAlign: 'center',
                }}
              >
                {color.toUpperCase()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};