import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import { useUIStore } from '../../store/uiStore';
import type { PBRMaterialState, TextureSlotKey } from '../../types/MaterialEditor';
import { TEXTURE_SLOT_LABELS } from '../../types/MaterialEditor';
import type { MaterialManager } from '../../three/MaterialManager';

interface MaterialEditorPanelProps {
  materialManagerRef: React.MutableRefObject<MaterialManager | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

const TEXTURE_SLOTS: TextureSlotKey[] = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap',
];

const PROP_ROWS: { label: string; key: keyof PBRMaterialState; min: number; max: number; step: number; section: string }[] = [
  { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.01, section: 'Surface' },
  { label: 'Metalness', key: 'metalness', min: 0, max: 1, step: 0.01, section: 'Surface' },
  { label: 'Normal Scale', key: 'normalScale', min: 0, max: 2, step: 0.05, section: 'Surface' },
  { label: 'Opacity', key: 'opacity', min: 0, max: 1, step: 0.01, section: 'Base' },
  { label: 'Emissive Int.', key: 'emissiveIntensity', min: 0, max: 5, step: 0.1, section: 'Emission' },
  { label: 'Bump Scale', key: 'bumpScale', min: 0, max: 2, step: 0.05, section: 'Surface' },
  { label: 'AO Intensity', key: 'aoMapIntensity', min: 0, max: 3, step: 0.05, section: 'Surface' },
];

const SECTIONS = ['Base', 'Surface', 'Emission', 'Texture Maps'] as const;

const MaterialEditorPanel: React.FC<MaterialEditorPanelProps> = ({ materialManagerRef, sceneRef }) => {
  const materials = useMaterialEditorStore((s) => s.materials);
  const selectedId = useMaterialEditorStore((s) => s.selectedMaterialId);
  const selectMaterial = useMaterialEditorStore((s) => s.selectMaterial);
  const updateMaterial = useMaterialEditorStore((s) => s.updateMaterial);
  const updateTextureSlot = useMaterialEditorStore((s) => s.updateTextureSlot);
  const removeTextureSlot = useMaterialEditorStore((s) => s.removeTextureSlot);

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const textureInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = materials.find((m) => m.id === selectedId) ?? null;

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Filter materials by search
  const filteredMaterials = useMemo(() => {
    if (!search.trim()) return materials;
    const q = search.toLowerCase();
    return materials.filter(
      (m) => m.name.toLowerCase().includes(q) || m.meshNames.some((n) => n.toLowerCase().includes(q)),
    );
  }, [materials, search]);

  const handlePropChange = useCallback(
    (key: keyof PBRMaterialState, value: number | string | boolean) => {
      if (!selectedId) return;
      updateMaterial(selectedId, { [key]: value } as Partial<PBRMaterialState>);

      const mm = materialManagerRef.current;
      const scene = sceneRef.current;
      if (mm && scene) {
        const updated = useMaterialEditorStore.getState().materials.find((m) => m.id === selectedId);
        if (updated) mm.applyMaterialState(updated, scene);
      }
    },
    [selectedId, updateMaterial, materialManagerRef, sceneRef],
  );

  const handleTextureUpload = useCallback((slotKey: TextureSlotKey) => {
    textureInputRefs.current[slotKey]?.click();
  }, []);

  const handleTextureFileChange = useCallback(
    (slotKey: TextureSlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedId) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateTextureSlot(selectedId, slotKey, dataUrl, file.name);

        const mm = materialManagerRef.current;
        const scene = sceneRef.current;
        if (mm && scene) {
          const updated = useMaterialEditorStore.getState().materials.find((m) => m.id === selectedId);
          if (updated) mm.applyMaterialState(updated, scene);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [selectedId, updateTextureSlot, materialManagerRef, sceneRef],
  );

  const handleRemoveTexture = useCallback(
    (slotKey: TextureSlotKey) => {
      if (!selectedId) return;
      removeTextureSlot(selectedId, slotKey);
    },
    [selectedId, removeTextureSlot],
  );

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const handleSearchSelect = useCallback(
    (id: string) => {
      selectMaterial(id);
      setSearch('');
      setSearchOpen(false);
    },
    [selectMaterial],
  );

  // Group props by section
  const propsBySection = useMemo(() => {
    const map: Record<string, typeof PROP_ROWS> = {};
    for (const row of PROP_ROWS) {
      if (!map[row.section]) map[row.section] = [];
      map[row.section].push(row);
    }
    return map;
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with search toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-dim)', flex: 1 }}>
          Materials ({materials.length})
        </span>
        <button
          className={`btn-icon btn-glow ${searchOpen ? 'active' : ''}`}
          style={{ width: 22, height: 22 }}
          onClick={() => setSearchOpen(!searchOpen)}
          title="Search materials"
          aria-label="Search materials"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5L15 15" />
          </svg>
        </button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <svg
              width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"
              style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="6.5" cy="6.5" r="5" />
              <path d="M10.5 10.5L15 15" />
            </svg>
            <input
              ref={searchInputRef}
              className="mat-search-input"
              type="text"
              placeholder="Search materials..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Search results dropdown */}
          {search && (
            <div className="mat-search-results">
              {filteredMaterials.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text-dim)' }}>
                  No materials found
                </div>
              )}
              {filteredMaterials.map((mat) => (
                <button
                  key={mat.id}
                  className="mat-search-result-item"
                  onClick={() => handleSearchSelect(mat.id)}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 2,
                      background: mat.color,
                      flexShrink: 0,
                      border: '1px solid var(--border)',
                    }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mat.name}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', flexShrink: 0 }}>
                    {mat.meshNames[0] ?? ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected material chip */}
      {selected && (
        <div className="mat-selected-chip">
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              background: selected.color,
              flexShrink: 0,
              border: '1px solid var(--border)',
            }}
          />
          <span className="mat-selected-chip-name">{selected.name}</span>
          <button
            className="panel-close-btn"
            onClick={() => selectMaterial(null)}
            title="Deselect material"
            aria-label="Deselect material"
          >
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l8 8M10 2L2 10" />
            </svg>
          </button>
        </div>
      )}

      {/* Empty state — click hint */}
      {!selected && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-dim)" strokeWidth="1.2">
              <path d="M8 1v5M8 10v5M1 8h5M10 8h5" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Click on the model surface to select a material, or use search above
          </p>
        </div>
      )}

      {/* Material properties — only shown when selected */}
      {selected && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {/* Material name + meshes */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{selected.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1 }}>
              {selected.meshNames.join(', ')}
            </div>
          </div>

          {/* Color pickers */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="mat-section-title" style={{ marginBottom: 3 }}>Base Color</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => handlePropChange('color', e.target.value)}
                  style={{ width: 28, height: 20, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{selected.color}</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="mat-section-title" style={{ marginBottom: 3 }}>Emissive</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input
                  type="color"
                  value={selected.emissive}
                  onChange={(e) => handlePropChange('emissive', e.target.value)}
                  style={{ width: 28, height: 20, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{selected.emissive}</span>
              </div>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['transparent', 'doubleSided', 'flatShading'] as const).map((key) => (
              <label
                key={key}
                style={{ fontSize: 10, color: 'var(--text-sec)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected[key] as boolean}
                  onChange={(e) => handlePropChange(key, e.target.checked)}
                  style={{ width: 12, height: 12 }}
                />
                {key === 'doubleSided' ? 'Double Sided' : key === 'flatShading' ? 'Flat Shading' : 'Transparent'}
              </label>
            ))}
          </div>

          {/* Sections: Base, Surface, Emission, Texture Maps */}
          {SECTIONS.map((section) => {
            if (section === 'Texture Maps') {
              return (
                <div key={section} style={{ marginBottom: 8 }}>
                  <div
                    className="mat-section-title"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => toggleSection(section)}
                  >
                    <svg
                      width="8" height="8" viewBox="0 0 8 8" fill="var(--text-dim)"
                      style={{ transform: collapsedSections.has(section) ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s ease', flexShrink: 0 }}
                    >
                      <path d="M1 1l6 3-6 3z" />
                    </svg>
                    {section}
                  </div>
                  {!collapsedSections.has(section) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {TEXTURE_SLOTS.map((slotKey) => {
                        const slot = selected[slotKey];
                        return (
                          <div
                            key={slotKey}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 4px',
                              borderRadius: 'var(--radius-sm)',
                              background: slot.enabled ? 'var(--bg-card)' : 'transparent',
                              border: `1px solid ${slot.enabled ? 'var(--border-light)' : 'var(--border)'}`,
                            }}
                          >
                            <label className="mat-param-label" style={{ fontSize: 9 }}>{TEXTURE_SLOT_LABELS[slotKey]}</label>
                            {slot.enabled && slot.dataUrl ? (
                              <>
                                <div
                                  style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: 3,
                                    background: `url(${slot.dataUrl}) center/cover`,
                                    border: '1px solid var(--border)',
                                    flexShrink: 0,
                                  }}
                                />
                                <span style={{ flex: 1, fontSize: 8, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={slot.fileName}>
                                  {slot.fileName}
                                </span>
                                <button
                                  onClick={() => handleRemoveTexture(slotKey)}
                                  style={{ fontSize: 8, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', flexShrink: 0 }}
                                >
                                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l8 8M10 2L2 10" /></svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleTextureUpload(slotKey)}
                                  style={{ fontSize: 8, color: 'var(--text-dim)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}
                                >
                                  + Load
                                </button>
                                <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>None</span>
                              </>
                            )}
                            <input
                              ref={(el) => { textureInputRefs.current[slotKey] = el; }}
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={(e) => handleTextureFileChange(slotKey, e)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const rows = propsBySection[section];
            if (!rows || rows.length === 0) return null;

            return (
              <div key={section} style={{ marginBottom: 8 }}>
                <div
                  className="mat-section-title"
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => toggleSection(section)}
                >
                  <svg
                    width="8" height="8" viewBox="0 0 8 8" fill="var(--text-dim)"
                    style={{ transform: collapsedSections.has(section) ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s ease', flexShrink: 0 }}
                  >
                    <path d="M1 1l6 3-6 3z" />
                  </svg>
                  {section}
                </div>
                {!collapsedSections.has(section) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {rows.map((row) => (
                      <div key={row.key} className="mat-param-row">
                        <label className="mat-param-label">{row.label}</label>
                        <input
                          type="range"
                          min={row.min}
                          max={row.max}
                          step={row.step}
                          value={selected[row.key] as number}
                          onChange={(e) => handlePropChange(row.key, parseFloat(e.target.value))}
                          style={{ flex: 1, height: 4, cursor: 'pointer', accentColor: 'var(--accent)' }}
                        />
                        <span className="mat-param-value">
                          {(selected[row.key] as number).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export { MaterialEditorPanel };