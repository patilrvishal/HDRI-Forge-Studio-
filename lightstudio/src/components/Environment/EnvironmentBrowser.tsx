import React, { useCallback, useRef, useState, useMemo } from 'react';
import { useSceneStore } from '../../store/sceneStore';
import { setRawHDRIData } from '../../store/hdriDataStore';
import { Slider } from '../UI/Slider';
import { Toggle } from '../UI/Toggle';
import { HDRI_PRESETS, getHDRIPresetById } from '../../types/Environment';
import type { HDRIPreset } from '../../types/Environment';

interface EnvironmentBrowserProps {
  onClose: () => void;
  /** Optional: callback to also apply env to 3D scene immediately */
  onPresetSelect?: (presetId: string) => void;
}

const CATEGORIES: { key: HDRIPreset['category'] | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'studio', label: 'Studio' },
  { key: 'outdoor', label: 'Outdoor' },
  { key: 'creative', label: 'Creative' },
];

const EnvironmentBrowser: React.FC<EnvironmentBrowserProps> = ({ onClose, onPresetSelect }) => {
  const environment = useSceneStore((s) => s.environment);
  const setEnvironment = useSceneStore((s) => s.setEnvironment);
  const setEnvironmentPreset = useSceneStore((s) => s.setEnvironmentPreset);
  const setEnvironmentRotation = useSceneStore((s) => s.setEnvironmentRotation);
  const toggleBackground = useSceneStore((s) => s.toggleBackground);

  const [activeCategory, setActiveCategory] = useState<HDRIPreset['category'] | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customLoading, setCustomLoading] = useState(false);

  // Filter presets
  const filteredPresets = useMemo(() => {
    let list = activeCategory === 'all' ? HDRI_PRESETS : HDRI_PRESETS.filter((p) => p.category === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [activeCategory, searchQuery]);

  const activePreset = useMemo(() => getHDRIPresetById(environment.presetId), [environment.presetId]);

  const handlePresetClick = useCallback(
    (preset: HDRIPreset) => {
      setEnvironmentPreset(preset.id);
      onPresetSelect?.(preset.id);
    },
    [setEnvironmentPreset, onPresetSelect],
  );

  const handleRotationChange = useCallback(
    (v: number) => {
      setEnvironmentRotation(v);
    },
    [setEnvironmentRotation],
  );

  const handleIntensityChange = useCallback(
    (v: number) => {
      setEnvironment({ intensity: v });
    },
    [setEnvironment],
  );

  const handleBackgroundChange = useCallback(
    (v: string) => {
      setEnvironment({ background: v });
    },
    [setEnvironment],
  );

  const handleCustomUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setCustomLoading(true);
      try {
        // Read raw binary for scene persistence
        try {
          const arrayBuffer = await file.arrayBuffer();
          setRawHDRIData(arrayBuffer, file.name);
        } catch {
          // Non-critical
        }
        // Create blob URL for 3D scene loading
        const url = URL.createObjectURL(file);
        setEnvironment({ hdri: url, presetId: '__custom__' });
      } finally {
        setCustomLoading(false);
        e.target.value = '';
      }
    },
    [setEnvironment],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="render-settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 620, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div className="rs-header">
          <span className="rs-title">Environment Browser</span>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="rs-body" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* ── Controls row ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
            <Slider
              label="Intensity"
              value={environment.intensity}
              min={0}
              max={3}
              step={0.05}
              onChange={handleIntensityChange}
              unit=""
            />
            <Slider
              label="Rotation"
              value={environment.rotation}
              min={0}
              max={360}
              step={1}
              onChange={handleRotationChange}
              unit="°"
            />
          </div>

          <div style={{ display: 'flex', gap: 12, flexShrink: 0, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Background</label>
              <input
                type="color"
                value={environment.background}
                onChange={(e) => handleBackgroundChange(e.target.value)}
                style={{ width: 32, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}
              />
              <Toggle label="Show BG" checked={environment.showBackground} onChange={toggleBackground} />
            </div>
            <button
              className="btn-sm"
              onClick={handleCustomUpload}
              disabled={customLoading}
              style={{ fontSize: 10, whiteSpace: 'nowrap' }}
            >
              {customLoading ? 'Loading...' : 'Load Custom HDRI'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".hdr,.hdri,.exr"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* ── Category tabs + Search ───────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                className={`tab-item ${activeCategory === cat.key ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 'var(--radius-sm)' }}
              >
                {cat.label}
              </button>
            ))}
            <input
              type="text"
              placeholder="Search environments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                marginLeft: 'auto',
                flex: 1,
                maxWidth: 180,
                height: 24,
                padding: '0 8px',
                fontSize: 10,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text)',
                outline: 'none',
              }}
            />
          </div>

          {/* ── Active preset indicator ──────────────────────────────── */}
          {activePreset && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>
              Active: <span style={{ color: 'var(--accent)' }}>{activePreset.name}</span>
              <span style={{ marginLeft: 8, color: 'var(--text-sec)' }}>— {activePreset.description}</span>
            </div>
          )}

          {/* ── Preset Grid ──────────────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 8,
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
              padding: '4px 0',
            }}
          >
            {filteredPresets.map((preset) => {
              const isActive = environment.presetId === preset.id;
              return (
                <div
                  key={preset.id}
                  onClick={() => handlePresetClick(preset)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    border: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    background: 'var(--bg-card)',
                    transition: 'border-color 0.15s, transform 0.15s',
                    transform: isActive ? 'scale(1.02)' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-light)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent';
                  }}
                >
                  {/* Thumbnail swatch */}
                  <div
                    style={{
                      width: '100%',
                      height: 64,
                      background: `linear-gradient(135deg, ${preset.thumbnailGradient[0]}, ${preset.thumbnailGradient[1]}, ${preset.thumbnailGradient[2]})`,
                      position: 'relative',
                    }}
                  >
                    {isActive && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.5">
                          <path d="M2 5l2 2 4-4" />
                        </svg>
                      </div>
                    )}
                    {/* Category badge */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        left: 4,
                        fontSize: 8,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(0,0,0,0.5)',
                        color: '#ccc',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {preset.category}
                    </div>
                  </div>
                  {/* Name */}
                  <div
                    style={{
                      padding: '4px 6px',
                      fontSize: 10,
                      fontWeight: 500,
                      color: isActive ? 'var(--text)' : 'var(--text-sec)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {preset.name}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredPresets.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, padding: 20 }}>
              No environments match your search.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rs-footer">
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {HDRI_PRESETS.length} built-in presets
          </div>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export { EnvironmentBrowser };