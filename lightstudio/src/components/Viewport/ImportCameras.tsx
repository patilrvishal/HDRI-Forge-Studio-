import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMERA_SOURCE_LABEL, importSelectedCameras, listSourceCameras,
  type CameraSource, type RemoteCamera,
} from '../../bridge/cameraImport';

const SOURCES: CameraSource[] = ['erik', 'blender', 'maya'];

/** Bottom-left "Import cameras" button: pick Erik / Blender / Maya, tick the
 *  cameras you want from that scene, import only those. */
export const ImportCameras: React.FC<{ standalone?: boolean }> = ({ standalone }) => {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<CameraSource | null>(null);
  const [cams, setCams] = useState<RemoteCamera[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const load = async (s: CameraSource) => {
    setSource(s); setCams([]); setPicked(new Set()); setError(null); setDone(null); setFilter('');
    setLoading(true);
    try {
      const list = await listSourceCameras(s);
      setCams(list);
      setPicked(new Set(list.filter((c) => !c.alreadyImported).map((c) => c.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(
    () => cams.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())),
    [cams, filter],
  );
  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setAllVisible = (on: boolean) =>
    setPicked((p) => { const n = new Set(p); visible.forEach((c) => { if (on) n.add(c.id); else n.delete(c.id); }); return n; });

  const doImport = () => {
    if (!source) return;
    const n = importSelectedCameras(source, cams, picked);
    setDone(`Imported ${n} camera${n === 1 ? '' : 's'} from ${CAMERA_SOURCE_LABEL[source]}`);
    setCams((cs) => cs.map((c) => (picked.has(c.id) ? { ...c, alreadyImported: true } : c)));
  };

  const btn: React.CSSProperties = { fontSize: 10, padding: '3px 8px' };

  return (
    <div
      ref={rootRef}
      style={standalone
        ? { position: 'absolute', bottom: 8, left: 8, zIndex: 6,
            background: 'var(--bg-panel)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '3px 4px' }
        : { position: 'relative', display: 'flex' }}
    >
      <button
        className="btn-sm"
        style={{ fontSize: 9, padding: '2px 6px', marginLeft: standalone ? 0 : 4 }}
        onClick={() => setOpen((o) => !o)}
        title="Import cameras from Erik, Blender or Maya"
      >
        Import cameras
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, width: 280, zIndex: 20,
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
          boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {SOURCES.map((s) => (
              <button
                key={s}
                className="btn-sm"
                onClick={() => load(s)}
                style={{ ...btn, flex: 1, ...(source === s ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}) }}
              >
                {CAMERA_SOURCE_LABEL[s]} cameras
              </button>
            ))}
          </div>

          {!source && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Choose where to import cameras from.</div>}
          {loading && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Reading cameras…</div>}
          {error && <div style={{ fontSize: 10, color: '#e5706a' }}>{error}</div>}

          {cams.length > 0 && (
            <>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${cams.length} cameras…`}
                style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)',
                  border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
                <button className="btn-sm" style={btn} onClick={() => setAllVisible(true)}>All</button>
                <button className="btn-sm" style={btn} onClick={() => setAllVisible(false)}>None</button>
                <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', alignSelf: 'center' }}>{picked.size} selected</span>
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {visible.map((c) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                    color: 'var(--text-sec)', cursor: 'pointer', padding: '2px 2px' }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</span>
                    {c.alreadyImported && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>in Forge</span>}
                  </label>
                ))}
              </div>
              <button
                className="btn-sm"
                disabled={picked.size === 0}
                onClick={doImport}
                style={{ ...btn, background: 'var(--accent)', color: '#fff', opacity: picked.size ? 1 : 0.4 }}
              >
                Import {picked.size} camera{picked.size === 1 ? '' : 's'}
              </button>
              {done && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{done}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};
