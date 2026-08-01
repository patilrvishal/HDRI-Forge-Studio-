import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { usePresetsStore } from '../../store/presetsStore';
import { useLightsStore } from '../../store/lightsStore';
import { presetToLights } from '../../types/Preset';
import type { Preset } from '../../types/Preset';
import { renderPresetThumbnail } from '../../three/PresetThumbnailRenderer';

interface PresetBrowserProps {
  /** Optional ref to a MaterialPreview's renderThumbnail function for generating thumbnails */
  onGenerateThumbnail?: (lights: Preset['lights']) => string;
}

type PresetCategory = Preset['category'];

const CATEGORY_TABS: Array<{ key: PresetCategory; label: string }> = [
  { key: 'studio', label: 'Studio' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'spotlight', label: 'Spotlight' },
  { key: 'sidelights', label: 'Sidelights' },
  { key: 'custom', label: 'Custom' },
];

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());
  const hasStartedRendering = useRef(false);

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
    if (lights.length === 0) {
      showToast('Add some lights first');
      return;
    }
    const thumbnail = onGenerateThumbnail
      ? onGenerateThumbnail(usePresetsStore.getState().lightsToPresetLights(lights))
      : '';
    const preset = await saveCurrentAsPreset(lights, thumbnail);
    showToast(`"${preset.name}" saved`);
  }, [lights, saveCurrentAsPreset, onGenerateThumbnail, showToast]);

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

  // Import presets from file
  const handleImport = useCallback(async () => {
    if (!fileInputRef.current?.files?.[0]) return;
    try {
      const count = await importPresetsFromFile(fileInputRef.current.files[0]);
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
      {/* Category tabs */}
      <div className="preset-tabs">
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
          <div className="preset-grid">
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
        <button className="btn-sm btn-glow" onClick={() => fileInputRef.current?.click()} title="Import presets from JSON">
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
      </div>

      {/* Toast notification */}
      {toast && <div className="preset-toast">{toast}</div>}
    </div>
  );
};