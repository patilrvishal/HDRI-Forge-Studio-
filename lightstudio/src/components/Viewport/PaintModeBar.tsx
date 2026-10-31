import React from 'react';
import { PAINT_MODES, type PaintMode } from '../../three/LightPaint';

interface Props {
  mode: PaintMode;
  onMode: (m: PaintMode) => void;
}

/** Mode picker shown while LightPaint is active (Reflection, Illumination, ..., Sun). */
export const PaintModeBar: React.FC<Props> = ({ mode, onMode }) => {
  const cur = PAINT_MODES.find((m) => m.id === mode);
  return (
    <div
      data-paint-ui
      style={{ position: 'absolute', top: 78, left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 8, background: 'rgba(20,22,28,0.8)', border: '1px solid var(--border, #3a3a3a)' }}>
        {PAINT_MODES.map((m) => (
          <button
            key={m.id}
            className="btn-sm"
            onClick={() => onMode(m.id)}
            style={{ outline: m.id === mode ? '1px solid var(--accent-bright, #4af)' : 'none', opacity: m.id === mode ? 1 : 0.7, fontSize: 10 }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {cur && <div style={{ fontSize: 9, color: 'var(--text-sec)', background: 'rgba(20,22,28,0.7)', padding: '1px 6px', borderRadius: 4 }}>{cur.hint}</div>}
    </div>
  );
};
