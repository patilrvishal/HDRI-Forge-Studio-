import React from 'react';
import { useErikLiveStore } from './ErikLiveSync';
import { useMatchGainStore, isMatchActive } from './matchGain';

const COLORS: Record<string, string> = {
  off: '#6b7280', idle: '#22c55e', rendering: '#f59e0b', sent: '#22c55e', error: '#ef4444',
};

/** Floating toggle (dev only): turns the Erik live link on/off and shows what it's doing. */
export const ErikLiveBadge: React.FC = () => {
  const { enabled, status, pass, lastMs, lastBytes, clients, error, targetLabel, port, setEnabled } = useErikLiveStore();
  const gain = useMatchGainStore((s) => s.gain);
  const resetMatch = useMatchGainStore((s) => s.reset);
  const matched = isMatchActive(gain);
  const label =
    status === 'off' ? 'Erik Live: off'
    : status === 'rendering' ? `Erik Live: rendering ${pass}…`
    : status === 'error' ? 'Erik Live: error'
    : clients > 0 ? `Erik Live: linked (${clients}) · ${targetLabel}`
    : port && port !== 5173 ? `Erik Live: waiting for Erik (port ${port})` : 'Erik Live: waiting for Erik';
  // desktop app: tell the user which port to type into the Erik panel when 5173 was already taken
  const portNote = port && port !== 5173 ? ` · set Erik's "Forge port" to ${port}` : '';
  const detail = status === 'error' ? error
    : lastMs ? `${lastMs} ms · ${(lastBytes / 1024).toFixed(0)} KB${portNote}` : `Click to stream the HDRI to Erik Adjuster${portNote}`;
  const pill: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999,
    border: '1px solid rgba(255,255,255,.18)', background: 'rgba(20,22,28,.88)', color: '#e5e7eb',
    font: '500 12px/1 system-ui, sans-serif', cursor: 'pointer', backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 14px rgba(0,0,0,.35)',
  };
  return (
    <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
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
