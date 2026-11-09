import React, { useCallback, useRef, useState } from 'react';
import type * as THREE from 'three';
import { LightListPanel } from '../Lights/LightListPanel';
import { PresetBrowser } from '../Presets/PresetBrowser';
import { PresetLibrary } from '../Appearance/PresetLibrary';
import { EnvironmentAssetsPanel } from '../Environment/EnvironmentAssetsPanel';
import { GradientBackgroundPanel } from '../Environment/GradientBackgroundPanel';
import { SceneHierarchy } from '../Scene/SceneHierarchy';
import { FilterStackEditor } from '../Filters/FilterStackEditor';
import { ErrorBoundary } from '../UI/ErrorBoundary';
import { useLightsStore } from '../../store/lightsStore';
import { useHDRIShapesStore } from '../../store/hdriShapesStore';
import { useUIStore } from '../../store/uiStore';
import { newAppearance } from '../../appearance/content';
import { useSceneStore } from '../../store/sceneStore';
import { HDRI_PRESETS } from '../../types/Environment';
import { ENV_CARDS, ENV_PILL_ICONS } from '../../data/envCards';
import { renderPresetThumbnails } from '../../three/EnvPresetThumbnails';

/**
 * Left column laid out like HDR Light Studio: the Light List on top and, below it, the Preset Library with its six
 * tabs (Rig, Env, Light, Content, Element, Effect). Every tab reuses an existing, already working panel.
 */
type LibTab = 'rig' | 'env' | 'light' | 'content' | 'element' | 'effect';
const LIB_TABS: { key: LibTab; label: string; hint: string }[] = [
  { key: 'rig', label: 'Rig', hint: 'Whole lighting set-ups: click one to load a complete rig' },
  { key: 'env', label: 'Env', hint: 'Environments and backgrounds' },
  { key: 'light', label: 'Light', hint: 'Click a preset to add a new light that looks like it' },
  { key: 'content', label: 'Content', hint: 'Click a preset to change the look of the selected light' },
  { key: 'element', label: 'Element', hint: 'Shapes painted straight into the HDRI' },
  { key: 'effect', label: 'Effect', hint: 'Filters for the selected light' },
];

const LS_SPLIT = 'lightforge.leftSplit.v1';
const readSplit = (): number => {
  try {
    const v = Number(localStorage.getItem(LS_SPLIT));
    return v >= 0.2 && v <= 0.75 ? v : 0.42;
  } catch {
    return 0.42;
  }
};

const hint: React.CSSProperties = { fontSize: 12, color: 'var(--text-dim)', padding: '8px 12px', lineHeight: 1.4 };

type ApplyFn = React.ComponentProps<typeof PresetLibrary>['onApply'];

/** Card in the same look as the Light tab's presets: dark tile, thin border, orange highlight, label underneath. */
const LibCard: React.FC<{ label: string; onClick: () => void; active?: boolean; title?: string; children: React.ReactNode }> = ({ label, onClick, active, title, children }) => (
  <div className={`lib-card ${active ? 'active' : ''}`} onClick={onClick} title={title ?? label}>
    <div className="lib-thumb">{children}</div>
    <div className="lib-name">{label}</div>
  </div>
);

const ENV_CATS = [
  { key: 'all', label: 'All' },
  { key: 'studio', label: 'Studio' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'creative', label: 'Creative' },
] as const;

/** Env tab: the built-in environments as globe cards (real renders of each environment), click to apply. */
const EnvLibrary: React.FC = () => {
  const [cat, setCat] = useState<'all' | 'studio' | 'outdoor' | 'creative'>('all');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const presetId = useSceneStore((s) => s.environment.presetId);
  const setPreset = useSceneStore((s) => s.setEnvironmentPreset);
  React.useEffect(() => renderPresetThumbnails(HDRI_PRESETS, (id, url) => setThumbs((t) => ({ ...t, [id]: url }))), []);
  const list = cat === 'all' ? HDRI_PRESETS : HDRI_PRESETS.filter((p) => p.category === cat);
  return (
    <>
      <div className="lib-pills">
        {ENV_CATS.map((c) => (
          <button key={c.key} className={`lib-pill ${cat === c.key ? 'active' : ''}`} onClick={() => setCat(c.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <img src={`/pillicons/${ENV_PILL_ICONS[c.key]}${cat === c.key ? '_on' : ''}.png`} alt="" draggable={false} style={{ width: 16, height: 16 }} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="lib-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {list.map((p) => ENV_CARDS[p.id] ? (
          <div key={p.id} className={`env-card ${presetId === p.id ? 'active' : ''}`} onClick={() => setPreset(p.id)} title={`${p.name} - ${p.description}`}>
            <img src={ENV_CARDS[p.id]} alt={p.name} draggable={false} />
            {presetId === p.id && <span className="env-check">&#10003;</span>}
          </div>
        ) : (
          <LibCard key={p.id} label={p.name} title={`${p.name} - ${p.description}`} active={presetId === p.id} onClick={() => setPreset(p.id)}>
            {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} /> : null}
          </LibCard>
        ))}
      </div>
    </>
  );
};

export const HdrlsLeftColumn: React.FC<{
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  onGenerateThumbnail: React.ComponentProps<typeof PresetBrowser>['onGenerateThumbnail'];
}> = ({ sceneRef, onGenerateThumbnail }) => {
  const [top, setTop] = useState<'lights' | 'scene'>('lights');
  const [tab, setTab] = useState<LibTab>('light');
  const [split, setSplit] = useState(readSplit);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const selectedLightId = useLightsStore((s) => s.selectedLightId);
  const selected = useLightsStore((s) => s.lights.find((l) => l.id === selectedLightId) ?? null);

  const startDrag = useCallback((e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    e.preventDefault();
    const rect = box.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      setSplit(Math.min(0.75, Math.max(0.2, (ev.clientY - rect.top) / rect.height)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplit((f) => {
        try { localStorage.setItem(LS_SPLIT, String(f)); } catch { /* ignore */ }
        return f;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  /** Size (m^2) a new light of this preset gets, so a bulb is a small bulb, a scrim is a big scrim and so on. */
  const areaFor = (info?: { category: string; name: string }): number => {
    switch (info?.category) {
      case 'Bulbs & Spots': return info.name === 'Sun Disc' ? 0.25 : info.name === 'Spot Tight' ? 0.5 : 1;
      case 'Rings': return 3;
      case 'Shapes': return 3;
      case 'Gradients': return 6;
      case 'Scrims': return 9;
      case 'Blinds & Flags': return 5;
      default: return 4;
    }
  };

  const addFromPreset: ApplyFn = (a, asp, info) => {
    const st = useLightsStore.getState();
    st.addLight('area');
    const created = useLightsStore.getState().lights.slice(-1)[0];
    if (!created) return;
    if (info?.category === 'Sky') {
      // A sky is the whole environment: its panorama wraps the full sphere, it is not a rectangle in front of the model.
      st.updateLight(created.id, { name: a.name, appearance: a, areaWidth: 4, areaHeight: 2, mapping: 'equirect', brightness: 100 });
    } else {
      const area = areaFor(info);
      const w = Math.min(20, Math.max(0.1, +Math.sqrt(area * asp).toFixed(2)));
      st.updateLight(created.id, { name: a.name, appearance: a, areaWidth: w, areaHeight: Math.min(20, Math.max(0.1, +(area / w).toFixed(2))), mapping: 'perspective' });
    }
    st.selectLight(created.id);
  };

  const applyToSelected: ApplyFn = (a, asp, info) => {
    const st = useLightsStore.getState();
    const l = st.lights.find((x) => x.id === st.selectedLightId);
    if (!l) return;
    if (info?.category === 'Sky') {
      st.updateLight(l.id, { appearance: a, areaWidth: 4, areaHeight: 2, mapping: 'equirect', brightness: 100 });
      return;
    }
    const w = l.areaWidth ?? 2;
    st.updateLight(l.id, {
      appearance: a,
      areaHeight: Math.min(20, Math.max(0.1, +(w / Math.max(0.05, asp)).toFixed(2))),
      ...(l.mapping === 'equirect' ? { mapping: 'perspective' as const } : {}),
    });
  };

  const seg = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 6,
    background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--text-sec)',
  });

  return (
    <div ref={boxRef} className="hdrls-lib" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Light List (top) */}
      <div style={{ flex: `0 0 ${split * 100}%`, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', flex: 1, gap: 2, padding: 2, background: 'var(--bg-deep)', borderRadius: 8 }}>
            <button style={seg(top === 'lights')} onClick={() => setTop('lights')}>Light List</button>
            <button style={seg(top === 'scene')} onClick={() => setTop('scene')}>Scene</button>
          </div>
          <button
            className="btn-icon"
            style={{ width: 28, height: 28 }}
            title="Add light"
            aria-label="Add light"
            onClick={() => useLightsStore.getState().addLight()}
          >
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 1v10M1 6h10" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {top === 'lights' ? (
            <LightListPanel />
          ) : (
            <ErrorBoundary><SceneHierarchy sceneRef={sceneRef} /></ErrorBoundary>
          )}
        </div>
      </div>

      {/* splitter */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => {
          setSplit(0.42);
          try { localStorage.setItem(LS_SPLIT, '0.42'); } catch { /* ignore */ }
        }}
        title="Drag to resize"
        style={{ height: 8, cursor: 'row-resize', flexShrink: 0, background: 'var(--border)', borderTop: '1px solid var(--border-light)' }}
      />

      {/* Preset Library (bottom) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 8px 2px', fontSize: 12, fontWeight: 700, color: 'var(--text-sec)', letterSpacing: 0.3 }}>
          Preset Library
        </div>
        <div style={{ display: 'flex', gap: 2, padding: '2px 8px 6px', flexShrink: 0, flexWrap: 'wrap' }}>
          {LIB_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.hint}
              className={`tab-item ${tab === t.key ? 'active' : ''}`}
              style={{ fontSize: 12, padding: '6px 11px', borderRadius: 6, cursor: 'pointer' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {tab === 'rig' && <PresetBrowser onGenerateThumbnail={onGenerateThumbnail} />}
          {tab === 'env' && (
            <>
              <div style={{ padding: '4px 8px' }}>
                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: '8px 0', fontSize: 12 }}
                  onClick={() => useUIStore.getState().setEnvBrowserModal(true)}
                >
                  Open Environment Browser
                </button>
              </div>
              <EnvLibrary />
              <EnvironmentAssetsPanel />
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <GradientBackgroundPanel />
              </div>
            </>
          )}
          {tab === 'light' && (
            <div style={{ padding: '0 6px 6px' }}>
              <div style={hint}>{LIB_TABS[2].hint}</div>
              <PresetLibrary onApply={addFromPreset} />
            </div>
          )}
          {tab === 'content' && (
            <div style={{ padding: '0 6px 6px' }}>
              {selected ? (
                <>
                  <div style={hint}>Changing the look of <b>{selected.name}</b>. Hover to audition, click to apply.</div>
                  <PresetLibrary onApply={applyToSelected} current={selected.appearance ?? newAppearance()} />
                </>
              ) : (
                <div style={hint}>Select a light in the Light List first, then pick a look for it here.</div>
              )}
            </div>
          )}
          {tab === 'element' && (
            <>
              <div style={hint}>{LIB_TABS[4].hint}. Click to add.</div>
              <div className="lib-grid">
                <LibCard label="Rectangle" onClick={() => useHDRIShapesStore.getState().addShape('rectangle')}>
                  <svg width="64%" viewBox="0 0 44 28" fill="#e8e8e8"><rect x="4" y="3" width="36" height="22" rx="2" /></svg>
                </LibCard>
                <LibCard label="Circle" onClick={() => useHDRIShapesStore.getState().addShape('circle')}>
                  <svg width="46%" viewBox="0 0 28 28" fill="#e8e8e8"><circle cx="14" cy="14" r="12" /></svg>
                </LibCard>
                <LibCard label="Gradient Strip" onClick={() => useHDRIShapesStore.getState().addShape('gradient-strip')}>
                  <svg width="70%" viewBox="0 0 44 16"><defs><linearGradient id="gs" x1="0" x2="1"><stop offset="0" stopColor="#f2f2f2" /><stop offset="1" stopColor="#2a2a2a" /></linearGradient></defs><rect x="2" y="2" width="40" height="12" rx="2" fill="url(#gs)" /></svg>
                </LibCard>
              </div>
            </>
          )}
          {tab === 'effect' && (
            <div style={{ padding: '0 8px 8px' }}>
              {selected && selected.appearance ? (
                <>
                  <div style={hint}>Filters for <b>{selected.name}</b></div>
                  <FilterStackEditor
                    filters={selected.appearance.filters}
                    onChange={(f) =>
                      useLightsStore.getState().updateLight(selected.id, { appearance: { ...selected.appearance!, filters: f } })
                    }
                  />
                </>
              ) : (
                <div style={hint}>Select a light that has an appearance (Round, Rect, Scrim, Gradient ...) to add filters to it.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
