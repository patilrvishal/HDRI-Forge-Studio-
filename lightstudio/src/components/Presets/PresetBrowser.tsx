import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { usePresetsStore } from '../../store/presetsStore';
import { useLightsStore } from '../../store/lightsStore';
import { presetToLights } from '../../types/Preset';
import type { Preset } from '../../types/Preset';
import { renderPresetThumbnail } from '../../three/PresetThumbnailRenderer';
import { useHDRIAssetStore } from '../../store/hdriAssetStore';
import { useLooksStore } from '../../store/looksStore';

interface PresetBrowserProps {
  /** Optional ref to a MaterialPreview's renderThumbnail function for generating thumbnails */
  onGenerateThumbnail?: (lights: Preset['lights']) => string;
}

type PresetCategory = Preset['category'];

const CATEGORY_TABS: Array<{ key: PresetCategory; label: string }> = [
  { key: 'lightprofiles', label: 'Light Profiles' },
  { key: 'studio', label: 'Studio' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'spotlight', label: 'Spotlight' },
  { key: 'sidelights', label: 'Sidelights' },
  { key: 'custom', label: 'Custom' },
];

const THUMB_SIZE_KEY = 'lightforge-preset-thumb-size';
const THUMB_SIZE_MIN = 48;
const THUMB_SIZE_MAX = 140;
const THUMB_SIZE_DEFAULT = 64;

export const PresetBrowser: React.FC<PresetBrowserProps> = ({ onGenerateThumbnail }) => {
  const presets = usePresetsStore((s) => s.presets);
  const activeCategory = usePresetsStore((s) => s.activeCategory);
  const searchQuery = usePresetsStore((s) => s.searchQuery);
  const previewingId = usePresetsStore((s) => s.previewingId);
  const dbLoaded = usePresetsStore((s) => s.dbLoaded);

  const setActiveCategory = usePresetsStore((s) => s.setActiveCategory);
  const setSearchQuery = usePresetsStore((s) => s.setSearchQuery);
  const setPreviewPreset = usePresetsStore((s) => s.setPreviewPreset);
  const deletePresetFromDB = usePresetsStore((s) => s.deletePresetFromDB);
  const saveCurrentAsPreset = usePresetsStore((s) => s.saveCurrentAsPreset);
  const exportPresets = usePresetsStore((s) => s.exportPresets);
  const importPresetsFromFile = usePresetsStore((s) => s.importPresetsFromFile);
  const loadFromDB = usePresetsStore((s) => s.loadFromDB);
  const updatePreset = usePresetsStore((s) => s.updatePreset);

  const lights = useLightsStore((s) => s.lights);
  const setLightsFromPreset = useLightsStore((s) => s.setLightsFromPreset);
  const selectLight = useLightsStore((s) => s.selectLight);

  // Custom HDRI assets are still persisted from here on Save (see
  // handleSavePreset below), even though loading/browsing them moved to
  // src/utils/loadCustomHDRI.ts (Create menu + HDRI Preview panel) and
  // EnvironmentAssetsPanel (Env tab).
  const hdriDbLoaded = useHDRIAssetStore((s) => s.dbLoaded);
  const loadHDRIsFromDB = useHDRIAssetStore((s) => s.loadFromDB);
  const saveHDRIsToDB = useHDRIAssetStore((s) => s.saveAllToDB);

  // Looks: whole-scene snapshots (lights + HDRI shapes + camera), a
  // superset of a Preset (lights only) - HDR Light Studio's "Light Looks".
  const looks = useLooksStore((s) => s.looks);
  const looksDbLoaded = useLooksStore((s) => s.dbLoaded);
  const loadLooksFromDB = useLooksStore((s) => s.loadFromDB);
  const saveCurrentAsLook = useLooksStore((s) => s.saveCurrentAsLook);
  const applyLook = useLooksStore((s) => s.applyLook);
  const deleteLook = useLooksStore((s) => s.deleteLook);
  const [browserMode, setBrowserMode] = useState<'presets' | 'looks'>('presets');
  // A/B compare: each slot holds a Look id (or null = not set). Clicking
  // "Compare" applies whichever slot ISN'T currently shown, so repeated
  // clicks flicker between the two - the same workflow as HDR Light
  // Studio's Light Looks compare, without needing a real split-screen
  // render (a second full render pass just to preview two static Looks
  // side-by-side isn't worth the complexity here).
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');
  const [showingSlot, setShowingSlot] = useState<'A' | 'B' | null>(null);
  // null = "Save Look" button showing; a string = the inline name field is
  // showing with this as its current value. window.prompt() is NOT an
  // option here - WebView2 (the desktop app's actual runtime) doesn't
  // support it at all, confirmed live ("prompt() is not supported"), so
  // this needed a real in-app input regardless of how it tested.
  const [savingLookName, setSavingLookName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());
  const hasStartedRendering = useRef(false);

  // Thumbnail size adjuster — applies to every category (Studio/Outdoor/
  // Spotlight/Sidelights/Custom) since it drives a shared CSS variable.
  const [thumbSize, setThumbSize] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(THUMB_SIZE_KEY));
      return Number.isFinite(stored) && stored >= THUMB_SIZE_MIN && stored <= THUMB_SIZE_MAX
        ? stored
        : THUMB_SIZE_DEFAULT;
    } catch {
      return THUMB_SIZE_DEFAULT;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(THUMB_SIZE_KEY, String(thumbSize));
    } catch {
      // ignore storage errors (private browsing, etc.)
    }
  }, [thumbSize]);

  const showToast = useCallback((msg: string, duration = 2000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  // Load from IndexedDB on mount
  useEffect(() => {
    if (!dbLoaded) {
      loadFromDB().catch(() => {});
    }
  }, [dbLoaded, loadFromDB]);

  // Restore persisted custom HDRI environment imports on mount
  useEffect(() => {
    if (!hdriDbLoaded) {
      loadHDRIsFromDB().catch(() => {});
    }
  }, [hdriDbLoaded, loadHDRIsFromDB]);

  // Restore saved Looks on mount
  useEffect(() => {
    if (!looksDbLoaded) {
      loadLooksFromDB().catch(() => {});
    }
  }, [looksDbLoaded, loadLooksFromDB]);

  // Async thumbnail rendering for presets without 3D thumbnails
  useEffect(() => {
    if (hasStartedRendering.current) return;
    hasStartedRendering.current = true;

    const needsRendering = presets.filter(
      (p) => p.isDefault && p.thumbnail && !p.thumbnail.startsWith('data:image/png'),
    );

    if (needsRendering.length === 0) return;

    const renderQueue = needsRendering.map((p) => ({ id: p.id, lights: p.lights }));

    setRenderingIds(new Set(renderQueue.map((r) => r.id)));

    renderQueue.reduce<Promise<void>>(
      async (prev, item) => {
        await prev;
        try {
          const thumb = await renderPresetThumbnail(item.id, item.lights);
          updatePreset(item.id, { thumbnail: thumb });
        } catch {
          // Silently skip failed renders
        }
        setRenderingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        // Yield
        await new Promise((r) => setTimeout(r, 5));
      },
      Promise.resolve(),
    );
  }, [presets, updatePreset]);

  // Filter presets by category and search query
  const filteredPresets = useMemo(() => {
    let list = presets.filter((p) => p.category === activeCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q) ||
          (p.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [presets, activeCategory, searchQuery]);

  // Preview preset: temporarily override lights
  const previewPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      const previewLights = presetToLights(preset);
      setLightsFromPreset(previewLights);
      setPreviewPreset(id);
      showToast(`Previewing "${preset.name}" — double-click to apply`);
    },
    [presets, setLightsFromPreset, setPreviewPreset, showToast],
  );

  // Apply preset permanently
  const applyPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      const newLights = presetToLights(preset);
      setLightsFromPreset(newLights);
      setPreviewPreset(null);
      if (newLights.length > 0) selectLight(newLights[0].id);
      showToast(`Applied "${preset.name}"`);
    },
    [presets, setLightsFromPreset, setPreviewPreset, selectLight, showToast],
  );

  // Save current lights as custom preset
  const handleSavePreset = useCallback(async () => {
    const hasLights = lights.length > 0;
    const hdriCount = useHDRIAssetStore.getState().assets.length;
    const hasHDRIs = hdriCount > 0;

    if (!hasLights && !hasHDRIs) {
      showToast('Add some lights or import an HDRI first');
      return;
    }

    const messages: string[] = [];

    // Persist every currently-loaded custom HDRI import so it survives a
    // reload — imports are staged in memory only until Save is clicked.
    if (hasHDRIs) {
      await saveHDRIsToDB();
      messages.push(`${hdriCount} HDRI${hdriCount !== 1 ? 's' : ''} saved`);
    }

    if (hasLights) {
      const thumbnail = onGenerateThumbnail
        ? onGenerateThumbnail(usePresetsStore.getState().lightsToPresetLights(lights))
        : '';
      const preset = await saveCurrentAsPreset(lights, thumbnail);
      messages.push(`"${preset.name}" saved`);
    }

    showToast(messages.join(' · '));
  }, [lights, saveCurrentAsPreset, onGenerateThumbnail, showToast, saveHDRIsToDB]);

  // Delete a custom preset
  const handleDeletePreset = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const preset = presets.find((p) => p.id === id);
      deletePresetFromDB(id);
      showToast(`Deleted "${preset?.name ?? 'preset'}"`);
    },
    [presets, deletePresetFromDB, showToast],
  );

  // Save the current scene (lights + HDRI shapes + camera) as a new Look
  const startSaveLook = useCallback(() => {
    setSavingLookName(`Look ${looks.length + 1}`);
  }, [looks.length]);

  const confirmSaveLook = useCallback(async () => {
    const name = savingLookName?.trim();
    if (!name) return;
    const look = await saveCurrentAsLook(name);
    setSavingLookName(null);
    showToast(`"${look.name}" saved`);
  }, [savingLookName, saveCurrentAsLook, showToast]);

  const handleApplyLook = useCallback(
    (id: string) => {
      const look = looks.find((l) => l.id === id);
      if (!look) return;
      applyLook(id);
      setShowingSlot(null);
      showToast(`Applied "${look.name}"`);
    },
    [looks, applyLook, showToast],
  );

  const handleDeleteLook = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const look = looks.find((l) => l.id === id);
      deleteLook(id);
      if (compareA === id) setCompareA('');
      if (compareB === id) setCompareB('');
      showToast(`Deleted "${look?.name ?? 'Look'}"`);
    },
    [looks, deleteLook, compareA, compareB, showToast],
  );

  // Flicker-compare: apply whichever slot isn't currently shown, so
  // repeated clicks alternate A/B/A/B like a photo lighting comparison.
  const handleCompareToggle = useCallback(() => {
    const nextSlot = showingSlot === 'A' ? 'B' : 'A';
    const nextId = nextSlot === 'A' ? compareA : compareB;
    if (!nextId) {
      showToast(`Pick a Look for slot ${nextSlot} first`);
      return;
    }
    applyLook(nextId);
    setShowingSlot(nextSlot);
  }, [showingSlot, compareA, compareB, applyLook, showToast]);

  // Import presets (JSON). Custom HDRI loading moved to the Create menu's
  // "Custom HDRI..." entry and the HDRI Preview panel's "Custom HDRI"
  // button (both use src/utils/loadCustomHDRI.ts), so this only handles
  // preset JSON now.
  const handleImport = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    try {
      const count = await importPresetsFromFile(file);
      showToast(`Imported ${count} presets`);
    } catch {
      showToast('Invalid preset file');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [importPresetsFromFile, showToast]);

  // Click handling with double-click detection
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCardClick = useCallback(
    (e: React.MouseEvent, presetId: string) => {
      if ((e.target as HTMLElement).closest('.pc-del')) return;
      if (clickTimer.current) {
        clearTimeout(clickTimer.current);
        clickTimer.current = null;
        applyPreset(presetId);
      } else {
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          previewPreset(presetId);
        }, 300);
      }
    },
    [applyPreset, previewPreset],
  );

  // Drag start
  const handleDragStart = useCallback(
    (e: React.DragEvent, presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset && preset.lights.length >= 1) {
        e.dataTransfer.setData('application/json', JSON.stringify(preset.lights[0]));
        e.dataTransfer.effectAllowed = 'copy';
      }
    },
    [presets],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Presets / Looks mode switch */}
      <div className="preset-tabs" style={{ paddingRight: 6 }}>
        <div
          className={`preset-tab ${browserMode === 'presets' ? 'active' : ''}`}
          onClick={() => setBrowserMode('presets')}
        >
          Presets
        </div>
        <div
          className={`preset-tab ${browserMode === 'looks' ? 'active' : ''}`}
          onClick={() => setBrowserMode('looks')}
          title="Whole-scene snapshots: lights, HDRI shapes, and camera together"
        >
          Looks
        </div>
      </div>

      {browserMode === 'presets' && (
        <>
      {/* Category tabs + thumbnail size adjuster */}
      <div className="preset-tabs" style={{ justifyContent: 'space-between', paddingRight: 6 }}>
        <div style={{ display: 'flex' }}>
          {CATEGORY_TABS.map((tab) => (
            <div
              key={tab.key}
              className={`preset-tab ${activeCategory === tab.key ? 'active' : ''}`}
              onClick={() => setActiveCategory(tab.key)}
            >
              {tab.label}
            </div>
          ))}
        </div>

        <div className="preset-size-adjuster" title={`Thumbnail size: ${thumbSize}px`}>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6">
            <rect x="1" y="4" width="3" height="5" />
            <rect x="6" y="1" width="3" height="8" />
          </svg>
          <input
            type="range"
            min={THUMB_SIZE_MIN}
            max={THUMB_SIZE_MAX}
            step={4}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            aria-label="Adjust preset thumbnail size"
          />
        </div>
      </div>

      {/* Search bar */}
      <div style={{ padding: '4px 6px' }}>
        <input
          className="field-input preset-search"
          type="text"
          placeholder="Search presets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Preset grid */}
      <div
        className="panel-body"
        style={{ flex: 1, padding: '0 6px', overflowY: 'auto' }}
      >
        {filteredPresets.length === 0 ? (
          <div className="preset-empty">
            {searchQuery ? 'No matching presets' : 'No presets in this category'}
          </div>
        ) : (
          <div className="preset-grid" style={{ '--preset-thumb-size': `${thumbSize}px` } as React.CSSProperties}>
            {filteredPresets.map((preset) => (
              <div
                key={preset.id}
                className={`preset-card ${previewingId === preset.id ? 'previewing' : ''}`}
                onClick={(e) => handleCardClick(e, preset.id)}
                onDoubleClick={(e) => {
                  if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
                  applyPreset(preset.id);
                }}
                onDragStart={(e) => handleDragStart(e, preset.id)}
                draggable
                title="Click: preview, Double-click: apply"
                style={{ position: 'relative' }}
              >
                {/* Description tooltip */}
                {preset.description && (
                  <div className="preset-card-tooltip">{preset.description}</div>
                )}

                <div className="pc-inner">
                  {renderingIds.has(preset.id) ? (
                    <div className="thumbnail-skeleton" />
                  ) : preset.thumbnail ? (
                    <img
                      src={preset.thumbnail}
                      alt={preset.name}
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className="pc-placeholder">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                        <circle cx="10" cy="10" r="5" />
                        <path d="M10 3v2M10 15v2M3 10h2M15 10h2" />
                      </svg>
                    </div>
                  )}
                  {!preset.isDefault && (
                    <button
                      className="pc-del"
                      data-del={preset.id}
                      onClick={(e) => handleDeletePreset(e, preset.id)}
                      title="Delete preset"
                      aria-label={`Delete ${preset.name}`}
                    >
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 1l10 10M11 1L1 11" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="pc-name">{preset.name}</div>
                <div style={{ fontSize: 8, color: 'var(--text-dim)', padding: '0 4px 3px', textAlign: 'center' }}>
                  {preset.lights.length} light{preset.lights.length !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {browserMode === 'looks' && (
        <>
          {/* A/B compare */}
          <div style={{ padding: '6px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <select
                className="field-input"
                style={{ flex: 1, fontSize: 10 }}
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
              >
                <option value="">A: pick a Look…</option>
                {looks.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <select
                className="field-input"
                style={{ flex: 1, fontSize: 10 }}
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
              >
                <option value="">B: pick a Look…</option>
                {looks.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <button
              className="btn-sm btn-glow"
              onClick={handleCompareToggle}
              disabled={!compareA || !compareB}
              title="Flicker between Look A and Look B"
            >
              {showingSlot ? `Showing ${showingSlot} — click for ${showingSlot === 'A' ? 'B' : 'A'}` : 'Compare A / B'}
            </button>
          </div>

          {/* Looks grid */}
          <div className="panel-body" style={{ flex: 1, padding: '6px', overflowY: 'auto' }}>
            {looks.length === 0 ? (
              <div className="preset-empty">No Looks saved yet — set up your lighting, then Save below</div>
            ) : (
              <div className="preset-grid" style={{ '--preset-thumb-size': `${thumbSize}px` } as React.CSSProperties}>
                {looks.map((look) => (
                  <div
                    key={look.id}
                    className="preset-card"
                    onClick={() => handleApplyLook(look.id)}
                    title="Click to apply this Look"
                    style={{ position: 'relative' }}
                  >
                    <div className="pc-inner">
                      {look.thumbnail ? (
                        <img src={look.thumbnail} alt={look.name} loading="lazy" draggable={false} />
                      ) : (
                        <div className="pc-placeholder">
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                            <circle cx="10" cy="10" r="5" />
                            <path d="M10 3v2M10 15v2M3 10h2M15 10h2" />
                          </svg>
                        </div>
                      )}
                      <button
                        className="pc-del"
                        onClick={(e) => handleDeleteLook(e, look.id)}
                        title="Delete Look"
                        aria-label={`Delete ${look.name}`}
                      >
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 1l10 10M11 1L1 11" />
                        </svg>
                      </button>
                    </div>
                    <div className="pc-name">{look.name}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-dim)', padding: '0 4px 3px', textAlign: 'center' }}>
                      {look.lights.length} light{look.lights.length !== 1 ? 's' : ''}
                      {look.hdriShapes.length > 0 ? ` · ${look.hdriShapes.length} shape${look.hdriShapes.length !== 1 ? 's' : ''}` : ''}
                      {look.camera ? ' · cam' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Bottom toolbar: Save / Export / Import */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 6px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {browserMode === 'looks' ? (
          savingLookName !== null ? (
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              <input
                className="field-input"
                style={{ flex: 1, fontSize: 11 }}
                value={savingLookName}
                autoFocus
                onChange={(e) => setSavingLookName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmSaveLook();
                  if (e.key === 'Escape') setSavingLookName(null);
                }}
              />
              <button className="btn-sm btn-glow" onClick={confirmSaveLook} title="Confirm">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M1.5 5.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="btn-sm" onClick={() => setSavingLookName(null)} title="Cancel">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ) : (
            <button className="btn-sm btn-glow" onClick={startSaveLook} title="Save the current lights, HDRI shapes, and camera as a Look">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 9V3l2-2h4l2 2v6H1z" />
                <rect x="3.5" y="5" width="3" height="4" />
              </svg>
              Save Look
            </button>
          )
        ) : (
          <>
            <button className="btn-sm btn-glow" onClick={handleSavePreset} title="Save current lights as preset">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 9V3l2-2h4l2 2v6H1z" />
                <rect x="3.5" y="5" width="3" height="4" />
              </svg>
              Save
            </button>
            <button className="btn-sm btn-glow" onClick={exportPresets} title="Export presets to JSON">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 1v6M2 4l3 3 3-3" />
                <path d="M1 8h8" />
              </svg>
              Export
            </button>
            <button
              className="btn-sm btn-glow"
              onClick={() => fileInputRef.current?.click()}
              title="Import presets from JSON"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 9V3M2 6l3-3 3 3" />
                <path d="M1 2h8" />
              </svg>
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
          </>
        )}
      </div>

      {/* Toast notification */}
      {toast && <div className="preset-toast">{toast}</div>}
    </div>
  );
};