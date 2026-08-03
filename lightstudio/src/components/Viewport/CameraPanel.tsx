import React, { useCallback } from 'react';
import { useCameraStore, type SceneCamera } from '../../store/cameraStore';
import { useLightsStore } from '../../store/lightsStore';
import { Toggle } from '../UI/Toggle';

interface TargetOption {
  id: string;
  label: string;
}

export const CameraPanel: React.FC = () => {
  const cameras = useCameraStore((s) => s.cameras);
  const activeCameraId = useCameraStore((s) => s.activeCameraId);
  const addCamera = useCameraStore((s) => s.addCamera);
  const removeCamera = useCameraStore((s) => s.removeCamera);
  const renameCamera = useCameraStore((s) => s.renameCamera);
  const updateCamera = useCameraStore((s) => s.updateCamera);
  const setActiveCamera = useCameraStore((s) => s.setActiveCamera);
  const lights = useLightsStore((s) => s.lights);

  const targetOptions: TargetOption[] = [
    { id: 'model', label: 'Model (car)' },
    { id: 'origin', label: 'Scene origin' },
    ...lights.map((l) => ({ id: `light:${l.id}`, label: l.name || 'Light' })),
  ];

  const active = cameras.find((c) => c.id === activeCameraId) ?? null;

  const patch = useCallback(
    (updates: Partial<SceneCamera>) => {
      if (!active) return;
      updateCamera(active.id, updates);
    },
    [active, updateCamera],
  );

  const num = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="section-header">Cameras</div>
        <button
          onClick={() => addCamera()}
          style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            background: 'var(--accent)', color: '#fff', border: 'none',
          }}
        >
          + Add
        </button>
      </div>

      {cameras.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          No cameras yet. Add one to frame a fixed shot.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {cameras.map((c) => {
          const isActive = c.id === activeCameraId;
          return (
            <div
              key={c.id}
              onClick={() => setActiveCamera(isActive ? null : c.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                background: isActive ? 'var(--accent)' : 'var(--bg-deep, #17171c)',
                border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--border)'),
              }}
            >
              <span style={{ fontSize: 11, color: isActive ? '#fff' : 'var(--text-sec)' }}>
                {c.name}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeCamera(c.id); }}
                style={{
                  fontSize: 12, lineHeight: 1, background: 'transparent', border: 'none',
                  color: isActive ? '#fff' : 'var(--text-dim)', cursor: 'pointer', padding: '0 2px',
                }}
              >×</button>
            </div>
          );
        })}
      </div>

      {active && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <input
            value={active.name}
            onChange={(e) => renameCamera(active.id, e.target.value)}
            style={{
              fontSize: 11, padding: '4px 6px', borderRadius: 4,
              background: 'var(--bg-deep, #17171c)', border: '1px solid var(--border)',
              color: 'var(--text-sec)',
            }}
          />

          <div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>Target</div>
            <select
              value={active.targetId ?? ''}
              onChange={(e) => patch({ targetId: e.target.value || null })}
              style={{
                width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4,
                background: 'var(--bg-deep, #17171c)', border: '1px solid var(--border)',
                color: 'var(--text-sec)',
              }}
            >
              <option value="">Free rotation</option>
              {targetOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Position</div>
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={'p' + axis} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, width: 12, color: 'var(--text-dim)' }}>{axis.toUpperCase()}</span>
              <input type="range" min={-30} max={30} step={0.1}
                value={active.position[axis]}
                onChange={(e) => patch({ position: { ...active.position, [axis]: parseFloat(e.target.value) } })}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                {num(active.position[axis])}
              </span>
            </div>
          ))}

          {!active.targetId && (
            <>
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Rotation</div>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={'r' + axis} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, width: 12, color: 'var(--text-dim)' }}>{axis.toUpperCase()}</span>
                  <input type="range" min={-180} max={180} step={1}
                    value={active.rotation[axis]}
                    onChange={(e) => patch({ rotation: { ...active.rotation, [axis]: parseFloat(e.target.value) } })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                    {num(active.rotation[axis])}
                  </span>
                </div>
              ))}
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 28, color: 'var(--text-dim)' }}>FOV</span>
            <input type="range" min={10} max={120} step={1}
              value={active.fov}
              onChange={(e) => patch({ fov: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.fov}
            </span>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>Lens</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Focal (mm)</span>
            <input type="range" min={10} max={300} step={1}
              value={active.focalLength}
              onChange={(e) => patch({ focalLength: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.focalLength}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Sensor fit</span>
            <select
              value={active.sensorFit}
              onChange={(e) => patch({ sensorFit: e.target.value as 'auto' | 'horizontal' | 'vertical' })}
              style={{ flex: 1, fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-deep, #17171c)', border: '1px solid var(--border)', color: 'var(--text-sec)' }}
            >
              <option value="auto">Auto</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Shift X</span>
            <input type="range" min={-2} max={2} step={0.01}
              value={active.shiftX}
              onChange={(e) => patch({ shiftX: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.shiftX.toFixed(2)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Shift Y</span>
            <input type="range" min={-2} max={2} step={0.01}
              value={active.shiftY}
              onChange={(e) => patch({ shiftY: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.shiftY.toFixed(2)}
            </span>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>Clip</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Start</span>
            <input type="range" min={0.001} max={10} step={0.01}
              value={active.clipStart}
              onChange={(e) => patch({ clipStart: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.clipStart.toFixed(2)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>End</span>
            <input type="range" min={1} max={10000} step={1}
              value={active.clipEnd}
              onChange={(e) => patch({ clipEnd: parseFloat(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
              {active.clipEnd}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Depth of field</span>
            <Toggle
              checked={active.dofEnabled}
              onChange={(v) => patch({ dofEnabled: v })}
              variant="glossy"
            />
          </div>
          {active.dofEnabled && (
            <>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 3 }}>Focus object</div>
                <select
                  value={active.dofFocusObjectId ?? ''}
                  onChange={(e) => patch({ dofFocusObjectId: e.target.value || null })}
                  style={{ width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-deep, #17171c)', border: '1px solid var(--border)', color: 'var(--text-sec)' }}
                >
                  <option value="">Manual distance</option>
                  {targetOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
              {!active.dofFocusObjectId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Distance</span>
                  <input type="range" min={0.1} max={100} step={0.1}
                    value={active.dofFocusDistance}
                    onChange={(e) => patch({ dofFocusDistance: parseFloat(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                    {active.dofFocusDistance.toFixed(1)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>F-stop</span>
                <input type="range" min={0.7} max={22} step={0.1}
                  value={active.dofFStop}
                  onChange={(e) => patch({ dofFStop: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                  f/{active.dofFStop.toFixed(1)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, width: 58, color: 'var(--text-dim)' }}>Blades</span>
                <input type="range" min={0} max={16} step={1}
                  value={active.dofBlades}
                  onChange={(e) => patch({ dofBlades: parseInt(e.target.value, 10) })}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 10, width: 34, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-sec)' }}>
                  {active.dofBlades}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
