import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APPEARANCE_PRESETS, PRESET_CATEGORIES, type AppearancePreset } from '../../appearance/presets';
import { useAppearanceStore } from '../../appearance/appearanceStore';
import { renderTexture } from '../../appearance/textures';
import { textureToDataUrl } from '../../appearance/preview';
import { cloneWithNewIds } from '../../appearance/content';
import type { LightAppearance } from '../../appearance/types';
import { useUIStore } from '../../store/uiStore';

const thumbCache = new Map<string, string>();
const LS_HIDDEN = 'lightforge.hiddenPresets.v1';
const LS_SIZE = 'lightforge.presetThumbSize.v1';
const loadHidden = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) ?? '[]') as string[]); } catch { return new Set(); } };
const loadSize = (dflt: number): number => { try { const v = Number(localStorage.getItem(LS_SIZE)); return v >= 48 && v <= 140 ? v : dflt; } catch { return dflt; } };

function thumbFor(key: string, build: () => LightAppearance, aspect: number): string {
  const hit = thumbCache.get(key);
  if (hit) return hit;
  try {
    const tex = renderTexture(build(), aspect, 72);
    const url = textureToDataUrl(tex, 1);
    thumbCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}

interface Item {
  id: string;
  name: string;
  category: string;
  aspect: number;
  tags: string[];
  user: boolean;
  build: () => LightAppearance;
}

interface Props {
  /** Apply permanently (click). */
  onApply: (a: LightAppearance, aspect: number) => void;
  /** Temporary audition on hover; null = restore. */
  onAudition?: (a: LightAppearance | null) => void;
  /** Current appearance so "Save as preset" has something to store. */
  current?: LightAppearance;
  currentAspect?: number;
  compact?: boolean;
}

/**
 * Categorised, searchable library of light appearances with live thumbnails.
 * Hovering a preset auditions it on the selected light; clicking applies it.
 */
export const PresetLibrary: React.FC<Props> = ({ onApply, onAudition, current, currentAspect = 1, compact }) => {
  const userPresets = useAppearanceStore((s) => s.userPresets);
  const saveUser = useAppearanceStore((s) => s.saveUserPreset);
  const delUser = useAppearanceStore((s) => s.deleteUserPreset);
  const [cat, setCat] = useState<string>('All');
  const [q, setQ] = useState('');
  // Thumbnail size and hidden presets are remembered between sessions.
  const [thumb, setThumb] = useState(() => loadSize(compact ? 64 : 84));
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const changeSize = (v: number) => { setThumb(v); try { localStorage.setItem(LS_SIZE, String(v)); } catch { /* ignore */ } };
  const setHiddenIds = (n: Set<string>) => { setHidden(n); try { localStorage.setItem(LS_HIDDEN, JSON.stringify([...n])); } catch { /* ignore */ } };
  const hoverTimer = useRef<number | null>(null);

  const items: Item[] = useMemo(() => {
    const built: Item[] = APPEARANCE_PRESETS.map((p: AppearancePreset) => ({ id: p.id, name: p.name, category: p.category, aspect: p.aspect, tags: p.tags, user: false, build: p.build }));
    const user: Item[] = userPresets.map((p) => ({ id: p.id, name: p.name, category: 'User', aspect: p.aspect, tags: [], user: true, build: () => cloneWithNewIds(p.appearance) }));
    return [...user, ...built];
  }, [userPresets]);

  const cats = ['All', ...(userPresets.length ? ['User'] : []), ...PRESET_CATEGORIES];
  const ql = q.trim().toLowerCase();
  const shown = items.filter((i) => (showHidden || !hidden.has(i.id)) && (cat === 'All' || i.category === cat) && (!ql || i.name.toLowerCase().includes(ql) || i.tags.some((t) => t.includes(ql))));

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  return (
    <div className="preset-library">
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input className="field-input" placeholder="Search presets…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        {current && (
          <button
            className="btn-sm"
            title="Save the current appearance as a reusable preset"
            onClick={async () => {
              const name = await useUIStore.getState().requestPrompt('Preset name', current.name && current.name !== 'Untitled' ? current.name : 'My Light');
              if (name) saveUser(name, current, currentAspect);
            }}
          >
            Save preset
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 10, color: 'var(--text-dim)' }}>
        <span>Size</span>
        <input type="range" min={48} max={140} step={4} value={thumb} onChange={(e) => changeSize(Number(e.target.value))} style={{ flex: 1 }} />
        {hidden.size > 0 && (
          <button className="btn-sm" style={{ fontSize: 9 }} onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? 'Hide again' : `Show hidden (${hidden.size})`}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {cats.map((c) => (
          <button
            key={c}
            className="btn-sm"
            onClick={() => setCat(c)}
            style={{ opacity: cat === c ? 1 : 0.6, outline: cat === c ? '1px solid var(--accent-bright, #4af)' : 'none', fontSize: 10 }}
          >
            {c}
          </button>
        ))}
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumb}px, 1fr))`, gap: 6, maxHeight: compact ? 220 : 360, overflowY: 'auto' }}
        onMouseLeave={() => onAudition?.(null)}
      >
        {shown.map((it) => (
          <div
            key={it.id}
            title={it.name + (it.user ? ' (right-click to delete)' : ' (right-click to hide)')}
            onMouseEnter={() => {
              if (!onAudition) return;
              if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
              hoverTimer.current = window.setTimeout(() => onAudition(it.build()), 60);
            }}
            onClick={() => {
              if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
              onApply(it.build(), it.aspect);
            }}
            onContextMenu={async (e) => {
              e.preventDefault();
              if (!it.user) {
                const n = new Set(hidden);
                if (n.has(it.id)) n.delete(it.id); else n.add(it.id);
                setHiddenIds(n);
                return;
              }
              if (await useUIStore.getState().requestConfirm(`Delete preset "${it.name}"?`, 'Delete')) delUser(it.id);
            }}
            style={{ cursor: 'pointer', textAlign: 'center' }}
          >
            <div style={{ aspectRatio: '1 / 1', background: '#151515', border: '1px solid var(--border, #333)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src={thumbFor(it.id, it.build, it.aspect)} alt={it.name} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-sec)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
          </div>
        ))}
        {!shown.length && <div style={{ gridColumn: '1/-1', fontSize: 10, color: 'var(--text-dim)' }}>No presets match.</div>}
      </div>
    </div>
  );
};
