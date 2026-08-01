import React from 'react';
import { useCameraStore } from '../../store/cameraStore';

export const CameraSwitcher: React.FC = () => {
  const cameras = useCameraStore((s) => s.cameras);
  const activeCameraId = useCameraStore((s) => s.activeCameraId);
  const setActiveCamera = useCameraStore((s) => s.setActiveCamera);

  return (
    <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 20 }}>
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
    </div>
  );
};
