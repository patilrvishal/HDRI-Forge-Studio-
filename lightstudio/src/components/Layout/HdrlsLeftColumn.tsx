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

const ElementTile: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button
    onClick={onClick}
    title={`Add ${label}`}
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 6px', cursor: 'pointer',
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12,
    }}
  >
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="1.6">{children}</svg>
    {label}
  </button>
);

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

  const addFromPreset: ApplyFn = (a, asp) => {
    const st = useLightsStore.getState();
    st.addLight('area');
    const created = useLightsStore.getState().lights.slice(-1)[0];
    if (!created) return;
    const area = 4;
    const w = Math.min(20, Math.max(0.1, +Math.sqrt(area * asp).toFixed(2)));
    st.updateLight(created.id, { name: a.name, appearance: a, areaWidth: w, areaHeight: Math.min(20, Math.max(0.1, +(area / w).toFixed(2))) });
    st.selectLight(created.id);
  };

  const applyToSelected: ApplyFn = (a, asp) => {
    const st = useLightsStore.getState();
    const l = st.lights.find((x) => x.id === st.selectedLightId);
    if (!l) return;
    const w = l.areaWidth ?? 2;
    st.updateLight(l.id, { appearance: a, areaHeight: Math.min(20, Math.max(0.1, +(w / Math.max(0.05, asp)).toFixed(2))) });
  };

  const seg = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 6,
    background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--text-sec)',
  });

  return (
    <div ref={boxRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
            <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <ElementTile label="Rectangle" onClick={() => useHDRIShapesStore.getState().addShape('rectangle')}>
                <rect x="7" y="12" width="30" height="20" rx="2" />
              </ElementTile>
              <ElementTile label="Circle" onClick={() => useHDRIShapesStore.getState().addShape('circle')}>
                <circle cx="22" cy="22" r="13" />
              </ElementTile>
              <ElementTile label="Gradient strip" onClick={() => useHDRIShapesStore.getState().addShape('gradient-strip')}>
                <rect x="5" y="16" width="34" height="12" rx="2" />
                <path d="M12 16v12M20 16v12M28 16v12" opacity="0.5" />
              </ElementTile>
              <div style={{ ...hint, gridColumn: '1 / -1', padding: 0 }}>Elements are painted straight into the HDRI, not into a light.</div>
            </div>
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
