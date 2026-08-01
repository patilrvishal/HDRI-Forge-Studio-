import React from 'react';
import { useSceneStore } from '../../store/sceneStore';

export const GradientBackgroundPanel: React.FC = () => {
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
    const stops = [...gradientBackground.stops, { color: '#ffffff', position: 0.5, opacity: 1 }];
    patch({ stops });
  };

  const removeStop = (idx: number) => {
    if (gradientBackground.stops.length <= 2) return;
    patch({ stops: gradientBackground.stops.filter((_, i) => i !== idx) });
  };

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="section-header">Gradient background</div>
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
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>Type</div>
            <select
              value={gradientBackground.type}
              onChange={(e) => patch({ type: e.target.value as 'linear' | 'radial' | 'conic' })}
              style={{
                width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4,
                background: 'var(--bg-deep, #17171c)', border: '1px solid var(--border)',
                color: 'var(--text-sec)',
              }}
            >
              <option value="linear">Linear</option>
              <option value="radial">Radial</option>
              <option value="conic">Conic</option>
            </select>
          </div>

          {gradientBackground.type === 'linear' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, width: 40, color: 'var(--text-dim)' }}>Angle</span>
              <input
                type="range" min={0} max={360} step={1}
                value={gradientBackground.angle}
                onChange={(e) => patch({ angle: parseFloat(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 10, width: 30, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                {gradientBackground.angle}°
              </span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Color stops</span>
            <button
              onClick={addStop}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
                background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)',
              }}
            >
              + Add stop
            </button>
          </div>

          {gradientBackground.stops.map((stop, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, padding: 6,
                borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-deep, #17171c)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => patchStop(idx, { color: e.target.value })}
                  style={{ width: 26, height: 22, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer' }}
                />
                <span style={{ flex: 1, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                  {stop.color}
                </span>
                {gradientBackground.stops.length > 2 && (
                  <button
                    onClick={() => removeStop(idx)}
                    style={{
                      fontSize: 12, lineHeight: 1, background: 'transparent', border: 'none',
                      color: 'var(--text-dim)', cursor: 'pointer',
                    }}
                    aria-label="Remove stop"
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, width: 40, color: 'var(--text-dim)' }}>Pos</span>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={stop.position}
                  onChange={(e) => patchStop(idx, { position: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 9, width: 28, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                  {stop.position.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, width: 40, color: 'var(--text-dim)' }}>Opacity</span>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={stop.opacity}
                  onChange={(e) => patchStop(idx, { opacity: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 9, width: 28, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                  {stop.opacity.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
