import React from 'react';
import { useCameraStore } from '../../store/cameraStore';

export const CameraSwitcher: React.FC = () => {
  const cameras = useCameraStore((s) => s.cameras);
  const activeCameraId = useCameraStore((s) => s.activeCameraId);
  const setActiveCamera = useCameraStore((s) => s.setActiveCamera);
  const updateCamera = useCameraStore((s) => s.updateCamera);

  const active = cameras.find((c) => c.id === activeCameraId) ?? null;

  return (
    <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
      <select
        value={activeCameraId ?? ''}
        onChange={(e) => setActiveCamera(e.target.value || null)}
        style={{
          padding: '4px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
          background: 'rgba(12,12,16,0.85)', border: '1px solid var(--border)',
          color: 'var(--text-sec)', backdropFilter: 'blur(4px)',
        }}
      >
        <option value="">Perspective</option>
        {cameras.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Per-camera lock - in 360 Workspace an active camera is orbit-
          adjustable by default (dragging updates it); locking it makes it
          read-only the same way Angle Hunt Mode always is, until unlocked
          or deactivated (picking "Perspective" above) to orbit freely
          again. No effect in Angle Hunt Mode, which is already always
          locked regardless of this flag. */}
      {active && (
        <button
          onClick={() => updateCamera(active.id, { locked: !active.locked })}
          title={active.locked ? 'Camera locked - click to unlock and allow orbit-drag to adjust it' : 'Camera unlocked - orbit-drag adjusts it. Click to lock.'}
          style={{
            width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 5, cursor: 'pointer', flexShrink: 0,
            background: active.locked ? 'var(--accent)' : 'rgba(12,12,16,0.85)',
            border: '1px solid ' + (active.locked ? 'var(--accent)' : 'var(--border)'),
            backdropFilter: 'blur(4px)',
          }}
        >
          {active.locked ? (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.3">
              <rect x="3" y="6.5" width="8" height="6" rx="1" />
              <path d="M4.5 6.5V4.2a2.5 2.5 0 015 0v2.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--text-sec)" strokeWidth="1.3">
              <rect x="3" y="6.5" width="8" height="6" rx="1" />
              <path d="M4.5 6.5V4.2a2.5 2.5 0 014.9-.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
};
