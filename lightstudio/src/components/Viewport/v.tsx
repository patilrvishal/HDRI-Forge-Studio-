import React, { useState } from 'react';
import { useSceneStore } from '../../store/sceneStore';

export const ViewportPropertiesPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const gradientBackground = useSceneStore((s) => s.environment.gradientBackground);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);

  const patch = (updates: Partial<typeof gradientBackground>) => {
    setEnvironment({ gradientBackground: { ...gradientBackground, ...updates } });
  };

  const patchStop = (idx: number, updates: Partial<{ color: string; position: number; opacity: number }>) => {
    const stops = gradientBackground.stops.map((s, i) => (i === idx ? { ...s, ...updates } : s));
    patch({ stops });
  };

  const addStop = () => {
    patch({ stops: [...gradientBackground.stops, { color: '#ffffff', position: 0.5, opacity: 1 }] });
  };

  const removeStop = (idx: number) => {
    if (gradientBackground.stops.length <= 2) return;
    patch({ stops: gradientBackground.stops.filter((_, i) => i !== idx) });
  };

  return (
    <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 20, width: open ? 220 : 'auto' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderRadius: open ? '6px 6px 0 0' : 6,
          background: 'rgba(12,12,16,0.9)', border: '1px solid var(--border)',
          color: 'var(--text-sec)', fontSize: 11, cursor: 'pointer', backdropFilter: 'blur(4px)',
        }}
      >
        <span>Viewport</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div
          style={{
            background: 'rgba(12,12,16,0.92)', border: '1px solid var(--border)', borderTop: 'none',
            borderRadius: '0 0 6px 6px', padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
            backdropFilter: 'blur(4px)', maxHeight: 420, overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Gradient background
            </span>
            <button
              onClick={() => patch({ enabled: !gradientBackground.enabled })}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                background: gradientBackground.enabled ? 'var(--accent)' : 'transparent',
                color: gradientBackground.enabled ? '#fff' : 'var(--text-dim)',
                border: '1px solid var(--border)',
              }}
            >
              {gradientBackground.enabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {gradientBackground.enabled && (
            <>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['linear', 'radial', 'conic'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => patch({ type: t })}
                    style={{
                      flex: 1, fontSize: 9, padding: '4px 0', borderRadius: 4, cursor: 'pointer',
                      textTransform: 'capitalize',
                      background: gradientBackground.type === t ? 'var(--accent)' : 'transparent',
                      color: gradientBackground.type === t ? '#fff' : 'var(--text-dim)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {gradientBackground.type === 'linear' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, width: 34, color: 'var(--text-dim)' }}>Angle</span>
                  <input
                    type="range" min={0} max={360} step={1}
                    value={gradientBackground.angle}
                    onChange={(e) => patch({ angle: parseFloat(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 9, width: 26, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                    {gradientBackground.angle}\u00B0
                  </span>
                </div>
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

              {gradientBackground.stops.map((stop, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 3, padding: 5,
                    borderRadius: 4, border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      type="color"
                      value={stop.color}
                      onChange={(e) => patchStop(idx, { color: e.target.value })}
                      style={{ width: 20, height: 18, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer' }}
                    />
                    <span style={{ flex: 1, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                      {stop.color}
                    </span>
                    {gradientBackground.stops.length > 2 && (
                      <button
                        onClick={() => removeStop(idx)}
                        style={{ fontSize: 11, lineHeight: 1, background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                        aria-label="Remove stop"
                      >
                        \u00D7
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 8, width: 30, color: 'var(--text-dim)' }}>Pos</span>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={stop.position}
                      onChange={(e) => patchStop(idx, { position: parseFloat(e.target.value) })}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 8, width: 30, color: 'var(--text-dim)' }}>Opac</span>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={stop.opacity}
                      onChange={(e) => patchStop(idx, { opacity: parseFloat(e.target.value) })}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              ))}

              <button
                onClick={addStop}
                style={{
                  fontSize: 9, padding: '4px 0', borderRadius: 4, cursor: 'pointer',
                  background: 'transparent', color: 'var(--accent)', border: '1px dashed var(--border)',
                }}
              >
                + Add stop
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
