import React from 'react';
import { useErikLiveStore, startAutoLink } from './ErikLiveSync';
import { useMatchGainStore, isMatchActive } from './matchGain';
import { useSceneStore } from '../store/sceneStore';

const COLORS: Record<string, string> = {
  off: '#6b7280', idle: '#22c55e', rendering: '#f59e0b', sent: '#22c55e', error: '#ef4444',
};

/** Floating toggle (dev only): turns the Erik live link on/off and shows what it's doing. */
export const ErikLiveBadge: React.FC = () => {
  const { enabled, status, pass, lastMs, lastBytes, clients, apps, error, targetLabel, port, setEnabled } = useErikLiveStore();
  // Start streaming by itself as soon as Blender, Maya or Unreal links, so one click in that app is enough.
  React.useEffect(() => { startAutoLink(); }, []);
  const gain = useMatchGainStore((s) => s.gain);
  const resetMatch = useMatchGainStore((s) => s.reset);
  const matched = isMatchActive(gain);
  // Forge starts with a grey radial "Gradient background" switched ON, and it is baked into the HDRI sent to Erik, so an
  // empty Forge scene still lights the car. Show it here (it used to be hidden in the Viewport panel) with a one-click switch.
  const gradient = useSceneStore((s) => s.environment.gradientBackground);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);
  // Erik is the SSE client(s); Blender / Maya are named, polling clients. Say who is actually linked.
  const linked = [...(clients > 0 ? ['Erik'] : []), ...apps];
  const label =
    status === 'off' ? 'Erik Live: off'
    : status === 'rendering' ? `Erik Live: rendering ${pass}…${linked.length ? ` · ${linked.join(', ')}` : ''}`
    : status === 'error' ? 'Erik Live: error'
    : linked.length > 0 ? `Erik Live: linked · ${linked.join(', ')} · ${targetLabel}`
    : port && port !== 5173 ? `Erik Live: waiting for an app (port ${port})` : 'Erik Live: waiting for Erik, Blender, Maya or Unreal';
  // desktop app: tell the user which port to type into the Erik panel when 5173 was already taken
  const portNote = port && port !== 5173 ? ` · set Erik's "Forge port" to ${port}` : '';
  const detail = status === 'error' ? error
    : lastMs ? `${lastMs} ms · ${(lastBytes / 1024).toFixed(0)} KB${portNote}` : `Streams the HDRI to Erik Adjuster, Blender, Maya or Unreal (starts by itself when one links)${portNote}`;
  const pill: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999,
    border: '1px solid rgba(255,255,255,.18)', background: 'rgba(20,22,28,.88)', color: '#e5e7eb',
    font: '500 12px/1 system-ui, sans-serif', cursor: 'pointer', backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 14px rgba(0,0,0,.35)',
  };
  return (
    <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      {status !== 'off' && gradient?.enabled && (
        <button
          onClick={() => setEnvironment({ gradientBackground: { ...gradient, enabled: false } })}
          title="The default grey Gradient background is part of the HDRI Forge sends, so it lights the scene even when nothing else is added. Click to turn it off (turn it back on in the Viewport panel, top-left of the viewport)."
          style={{ ...pill, padding: '6px 10px' }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 3, background: 'linear-gradient(135deg,#b3b3b3,#333)' }} />
          Default gradient light: ON — click to turn off
        </button>
      )}
      {matched && (
        <button
          onClick={resetMatch}
          title="Erik is matching a reference photo: the HDRI is scaled by these per-channel gains (also baked into Export HDRI). Click to remove."
          style={{ ...pill, padding: '6px 10px' }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 3, background: `rgb(${gain.map((g) => Math.min(255, Math.round(128 * g))).join(',')})` }} />
          Photo match ×{gain.map((g) => g.toFixed(2)).join(' / ')} — reset
        </button>
      )}
      <button onClick={() => setEnabled(!enabled)} title={detail} style={pill}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS[status] ?? COLORS.off,
          boxShadow: enabled ? `0 0 8px ${COLORS[status]}` : 'none' }} />
        {label}
        {status !== 'off' && lastMs > 0 && status !== 'error' && <span style={{ opacity: .6 }}>{lastMs} ms</span>}
      </button>
    </div>
  );
};
