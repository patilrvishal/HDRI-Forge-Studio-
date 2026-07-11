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
  'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap', 'displacementMap',
];

interface PropRow {
  label: string;
  key: keyof PBRMaterialState;
  min: number;
  max: number;
  step: number;
  section: string;
  unit?: string;
  physicalOnly?: boolean;
  infinityKey?: boolean;
  isColor?: boolean;
  colorKey?: string;
  /** For iridescence thickness: 0 = min, 1 = max */
  iridTupleIndex?: 0 | 1;
  /** Show as integer (no decimals) */
  integerOnly?: boolean;
}

const PROP_ROWS: PropRow[] = [
  // ── Surface ──────────────────────────────────────────────────
  { label: 'Base Color', key: 'color', min: 0, max: 0, step: 0, section: 'Surface', isColor: true, colorKey: 'color' },
  { label: 'Metallic', key: 'metalness', min: 0, max: 1, step: 0.001, section: 'Surface' },
  { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.001, section: 'Surface' },
  { label: 'Normal Scale', key: 'normalScale', min: 0, max: 2, step: 0.001, section: 'Surface' },
  { label: 'Bump Scale', key: 'bumpScale', min: 0, max: 2, step: 0.001, section: 'Surface' },
  { label: 'AO Intensity', key: 'aoMapIntensity', min: 0, max: 3, step: 0.001, section: 'Surface' },

  // ── Specular ─────────────────────────────────────────────────
  { label: 'Specular Int.', key: 'specularIntensity', min: 0, max: 1, step: 0.001, section: 'Specular', physicalOnly: true },
  { label: 'Specular Color', key: 'specularColor', min: 0, max: 0, step: 0, section: 'Specular', physicalOnly: true, isColor: true, colorKey: 'specularColor' },

  // ── Transmission ─────────────────────────────────────────────
  { label: 'Transmission', key: 'transmission', min: 0, max: 1, step: 0.001, section: 'Transmission', physicalOnly: true },
  { label: 'Trans. Rough.', key: 'transmissionRoughness', min: 0, max: 1, step: 0.001, section: 'Transmission', physicalOnly: true },
  { label: 'Thickness', key: 'thickness', min: 0, max: 10, step: 0.001, section: 'Transmission', physicalOnly: true },
  { label: 'IOR', key: 'ior', min: 1, max: 2.5, step: 0.001, section: 'Transmission', physicalOnly: true },
  { label: 'Atten. Color', key: 'attenuationColor', min: 0, max: 0, step: 0, section: 'Transmission', physicalOnly: true, isColor: true, colorKey: 'attenuationColor' },
  { label: 'Atten. Dist.', key: 'attenuationDistance', min: 0, max: 20, step: 0.001, section: 'Transmission', physicalOnly: true, infinityKey: true },

  // ── Coat ─────────────────────────────────────────────────────
  { label: 'Clearcoat', key: 'clearcoat', min: 0, max: 1, step: 0.001, section: 'Coat', physicalOnly: true },
  { label: 'Clearcoat Rough.', key: 'clearcoatRoughness', min: 0, max: 1, step: 0.001, section: 'Coat', physicalOnly: true },

  // ── Fabric / Carpet ─────────────────────────────────────────
  { label: 'Sheen', key: 'sheen', min: 0, max: 1, step: 0.001, section: 'Fabric / Carpet', physicalOnly: true },
  { label: 'Sheen Rough.', key: 'sheenRoughness', min: 0, max: 1, step: 0.001, section: 'Fabric / Carpet', physicalOnly: true },
  { label: 'Sheen Color', key: 'sheenColor', min: 0, max: 0, step: 0, section: 'Fabric / Carpet', physicalOnly: true, isColor: true, colorKey: 'sheenColor' },

  // ── Iridescence ──────────────────────────────────────────────
  { label: 'Iridescence', key: 'iridescence', min: 0, max: 1, step: 0.001, section: 'Iridescence', physicalOnly: true },
  { label: 'Irid. IOR', key: 'iridescenceIOR', min: 1, max: 2.333, step: 0.001, section: 'Iridescence', physicalOnly: true },
  { label: 'Irid. Thick. Min', key: 'iridescenceThicknessRange', min: 100, max: 800, step: 1, section: 'Iridescence', physicalOnly: true, iridTupleIndex: 0, integerOnly: true },
  { label: 'Irid. Thick. Max', key: 'iridescenceThicknessRange', min: 100, max: 800, step: 1, section: 'Iridescence', physicalOnly: true, iridTupleIndex: 1, integerOnly: true },

  // ── Emission ─────────────────────────────────────────────────
  { label: 'Emissive Color', key: 'emissive', min: 0, max: 0, step: 0, section: 'Emission', isColor: true, colorKey: 'emissive' },
  { label: 'Emissive Int.', key: 'emissiveIntensity', min: 0, max: 5, step: 0.001, section: 'Emission' },

  // ── Displacement ───────────────────────────────────────────────
  { label: 'Displace Scale', key: 'displacementScale', min: 0, max: 5, step: 0.001, section: 'Displacement' },
  { label: 'Displace Bias', key: 'displacementBias', min: -1, max: 1, step: 0.001, section: 'Displacement' },

  // ── Environment ────────────────────────────────────────────────
  { label: 'Env Map Int.', key: 'envMapIntensity', min: 0, max: 5, step: 0.001, section: 'Environment' },

  // ── Settings ─────────────────────────────────────────────────
  { label: 'Opacity', key: 'opacity', min: 0, max: 1, step: 0.001, section: 'Settings' },
  { label: 'Alpha Test', key: 'alphaTest', min: 0, max: 1, step: 0.001, section: 'Settings' },
];

interface SectionDef {
  name: string;
  physicalOnly?: boolean;
  defaultExpanded?: boolean;
}

const SECTIONS: SectionDef[] = [
  { name: 'Surface', defaultExpanded: true },
  { name: 'Specular', physicalOnly: true },
  { name: 'Transmission', physicalOnly: true },
  { name: 'Coat', physicalOnly: true },
  { name: 'Fabric / Carpet', physicalOnly: true, defaultExpanded: true },
  { name: 'Iridescence', physicalOnly: true },
  { name: 'Emission' },
  { name: 'Displacement', defaultExpanded: false },
  { name: 'Environment', defaultExpanded: false },
  { name: 'Settings' },
  { name: 'Texture Maps' },
];

const NUM_INPUT_STYLE: React.CSSProperties = {
  width: 52,
  height: 20,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  color: 'var(--text-sec)',
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  padding: '0 4px',
  outline: 'none',
  flexShrink: 0,
  textAlign: 'right' as const,
};

const NUM_INPUT_FOCUS_STYLE: React.CSSProperties = {
  ...NUM_INPUT_STYLE,
  borderColor: 'var(--accent)',
};

const MaterialEditorPanel: React.FC<MaterialEditorPanelProps> = ({ materialManagerRef, sceneRef }) => {
  const materials = useMaterialEditorStore((s) => s.materials);
  const selectedId = useMaterialEditorStore((s) => s.selectedMaterialId);
  const selectMaterial = useMaterialEditorStore((s) => s.selectMaterial);
  const updateMaterial = useMaterialEditorStore((s) => s.updateMaterial);
  const updateTextureSlot = useMaterialEditorStore((s) => s.updateTextureSlot);
  const removeTextureSlot = useMaterialEditorStore((s) => s.removeTextureSlot);

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedNumInput, setFocusedNumInput] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const s of SECTIONS) {
      if (!s.defaultExpanded) set.add(s.name);
    }
    return set;
  });
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

  // Physical keys that auto-set isPhysical
  const physicalKeys = useMemo(() => new Set<string>([
    'clearcoat', 'clearcoatRoughness', 'transmission', 'transmissionRoughness',
    'thickness', 'ior', 'sheen', 'sheenRoughness', 'sheenColor',
    'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange',
    'attenuationColor', 'attenuationDistance', 'specularIntensity', 'specularColor',
  ]), []);

  const handlePropChange = useCallback(
    (key: keyof PBRMaterialState, value: number | string | boolean, iridTupleIndex?: 0 | 1) => {
      if (!selectedId) return;

      const updates: Partial<PBRMaterialState> = {};

      // Handle iridescence thickness range tuple specially
      if (key === 'iridescenceThicknessRange' && iridTupleIndex !== undefined) {
        const cur = useMaterialEditorStore.getState().materials.find((m) => m.id === selectedId);
        const existing: [number, number] = cur?.iridescenceThicknessRange ?? [100, 400];
        if (iridTupleIndex === 0) {
          updates.iridescenceThicknessRange = [value as number, existing[1]];
        } else {
          updates.iridescenceThicknessRange = [existing[0], value as number];
        }
      } else {
        (updates as any)[key] = value;
      }

      // Auto-set isPhysical for physical keys
      if (physicalKeys.has(key as string)) {
        updates.isPhysical = true;
      }
      // Auto-enable transparent when transmission > 0
      if (key === 'transmission' && typeof value === 'number' && value > 0) {
        updates.transparent = true;
      }

      updateMaterial(selectedId, updates);

      const mm = materialManagerRef.current;
      const scene = sceneRef.current;
      if (mm && scene) {
        const updated = useMaterialEditorStore.getState().materials.find((m) => m.id === selectedId);
        if (updated) mm.applyMaterialState(updated, scene);
      }
    },
    [selectedId, updateMaterial, materialManagerRef, sceneRef, physicalKeys],
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
    const map: Record<string, PropRow[]> = {};
    for (const row of PROP_ROWS) {
      if (!map[row.section]) map[row.section] = [];
      map[row.section].push(row);
    }
    return map;
  }, []);

  // Determine visible sections based on physical mode
  const visibleSections = useMemo(() => {
    if (!selected) return SECTIONS;
    const phys = selected.isPhysical;
    return SECTIONS.filter((s) => {
      if (s.name === 'Texture Maps') return true;
      if (s.physicalOnly) return phys;
      return true;
    });
  }, [selected]);

  /** Format numeric value for display: 3 decimal places, ∞ for Infinity, integer for irid */
  const formatNumValue = useCallback((rawVal: number | undefined, row: PropRow): string => {
    if (rawVal == null || Number.isNaN(rawVal)) return '0.000';
    if (row.infinityKey && (rawVal === Infinity || rawVal >= 20)) return '\u221e';
    if (row.integerOnly) return Math.round(rawVal).toString();
    return rawVal.toFixed(3);
  }, []);

  /** Get safe numeric value for slider */
  const getSafeNum = (rawVal: number | undefined, min: number): number => {
    if (rawVal != null && !Number.isNaN(rawVal)) return rawVal;
    return min;
  };

  /** Handle numeric input blur: clamp and handle NaN */
  const handleNumBlur = useCallback(
    (row: PropRow, inputValue: string) => {
      const v = parseFloat(inputValue);
      if (isNaN(v) || v == null) {
        handlePropChange(row.key, row.min, row.iridTupleIndex);
        return;
      }
      const clamped = Math.max(row.min, Math.min(row.max, v));
      handlePropChange(row.key, clamped, row.iridTupleIndex);
    },
    [handlePropChange],
  );

  /** Handle numeric input change: live update */
  const handleNumChange = useCallback(
    (row: PropRow, inputValue: string) => {
      const v = parseFloat(inputValue);
      if (!isNaN(v)) {
        handlePropChange(row.key, v, row.iridTupleIndex);
      }
    },
    [handlePropChange],
  );

  // Chevron SVG (8x8)
  const chevronSvg = (expanded: boolean) => (
    <svg
      width="8" height="8" viewBox="0 0 8 8" fill="var(--text-dim)"
      style={{ transform: expanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.15s ease', flexShrink: 0 }}
    >
      <path d="M1 1l6 3-6 3z" />
    </svg>
  );

  // PHYSICAL badge
  const physicalBadge = (
    <span style={{
      fontSize: 7, padding: '0 4px', borderRadius: 2, marginLeft: 'auto',
      background: 'rgba(167, 139, 250, 0.12)', color: 'var(--accent-bright)',
      letterSpacing: '0.4px', fontWeight: 600,
    }}>
      PHYSICAL
    </span>
  );

  // Render a slider property row (Blender-style: label | slider | numeric input)
  const renderSliderRow = (row: PropRow) => {
    if (!selected) return null;

    const inputId = `${row.key}-${row.iridTupleIndex ?? ''}`;

    // For iridescence thickness, extract the tuple element
    let rawVal: number;
    if (row.iridTupleIndex !== undefined) {
      rawVal = (selected.iridescenceThicknessRange?.[row.iridTupleIndex]) ?? row.min;
    } else {
      rawVal = selected[row.key] as number;
    }

    const safeVal = getSafeNum(rawVal, row.min);
    const displayVal = formatNumValue(rawVal, row);

    // For infinity key, slider value is clamped to 20
    const sliderVal = row.infinityKey && (rawVal === Infinity || rawVal >= 20) ? row.max : safeVal;

    return (
      <div key={inputId} className="mat-param-row">
        <label className="mat-param-label">{row.label}</label>
        <input
          type="range"
          min={row.min}
          max={row.max}
          step={row.step}
          value={sliderVal}
          onChange={(e) => handlePropChange(row.key, parseFloat(e.target.value), row.iridTupleIndex)}
          style={{ flex: 1, height: 4, cursor: 'pointer', accentColor: 'var(--accent)' }}
        />
        <input
          type="number"
          min={row.min}
          max={row.max}
          step={row.step}
          value={displayVal}
          onChange={(e) => handleNumChange(row, e.target.value)}
          onBlur={(e) => handleNumBlur(row, e.target.value)}
          onFocus={() => setFocusedNumInput(inputId)}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            if (focusedNumInput !== inputId) {
              (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)';
            }
          }}
          style={focusedNumInput === inputId ? NUM_INPUT_FOCUS_STYLE : NUM_INPUT_STYLE}
        />
      </div>
    );
  };

  // Render a color property row (Blender-style: label | color swatch | hex display)
  const renderColorRow = (row: PropRow) => {
    if (!selected || !row.colorKey) return null;
    const hexVal = (selected[row.colorKey] as string) ?? '#000000';

    return (
      <div key={row.colorKey} className="mat-param-row">
        <label className="mat-param-label">{row.label}</label>
        <input
          type="color"
          value={hexVal}
          onChange={(e) => handlePropChange(row.key, e.target.value)}
          style={{
            width: 32, height: 18, border: '1px solid var(--border)',
            borderRadius: 3, cursor: 'pointer', padding: 0, flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flex: 1,
        }}>
          {hexVal}
        </span>
      </div>
    );
  };

  // Render a section header
  const renderSectionHeader = (sectionName: string, isPhysical?: boolean) => {
    const expanded = !collapsedSections.has(sectionName);
    return (
      <div
        className="mat-section-title"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0 }}
        onClick={() => toggleSection(sectionName)}
      >
        {chevronSvg(expanded)}
        {sectionName}
        {isPhysical && physicalBadge}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header with search toggle ──────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-dim)', flex: 1 }}>
          Materials ({materials.length})
        </span>
        {selected && (
          <div
            style={{
              fontSize: 8,
              padding: '1px 5px',
              borderRadius: 3,
              background: selected.isPhysical ? 'rgba(167, 139, 250, 0.15)' : 'var(--bg-input)',
              color: selected.isPhysical ? 'var(--accent-bright)' : 'var(--text-dim)',
              border: `1px solid ${selected.isPhysical ? 'rgba(167, 139, 250, 0.3)' : 'var(--border)'}`,
              letterSpacing: '0.3px',
            }}
          >
            {selected.isPhysical ? 'PHYSICAL' : 'STANDARD'}
          </div>
        )}
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

      {/* ── Search bar ─────────────────────────────────────────── */}
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
                      width: 14, height: 14, borderRadius: 2,
                      background: mat.color, flexShrink: 0,
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

      {/* ── Selected material chip ─────────────────────────────── */}
      {selected && (
        <div className="mat-selected-chip">
          <div
            style={{
              width: 12, height: 12, borderRadius: 2,
              background: selected.color, flexShrink: 0,
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

      {/* ── Empty state ────────────────────────────────────────── */}
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

      {/* ── Material properties ────────────────────────────────── */}
      {selected && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {/* Material name + meshes */}
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={selected.name}
              onChange={(e) => handlePropChange('name', e.target.value)}
              style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text)',
                background: 'transparent', border: '1px solid transparent',
                borderRadius: 3, padding: '1px 4px', width: '100%',
                outline: 'none', fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--border)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = 'transparent'; }}
            />
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 1, paddingLeft: 4 }}>
              {selected.meshNames.join(', ')}
            </div>
          </div>

          {/* ── Property sections ─────────────────────────────── */}
          {visibleSections.map((section) => {
            const sectionName = section.name;

            // ── Texture Maps (special rendering) ──────────────
            if (sectionName === 'Texture Maps') {
              const expanded = !collapsedSections.has(sectionName);
              return (
                <div key={sectionName} style={{ marginBottom: 8 }}>
                  {renderSectionHeader(sectionName, false)}
                  {expanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                      {TEXTURE_SLOTS.map((slotKey) => {
                        const slot = selected[slotKey];
                        return (
                          <div
                            key={slotKey}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              padding: '3px 4px', borderRadius: 'var(--radius-sm)',
                              background: slot.enabled ? 'var(--bg-card)' : 'transparent',
                              border: `1px solid ${slot.enabled ? 'var(--border-light)' : 'var(--border)'}`,
                            }}
                          >
                            <label className="mat-param-label" style={{ fontSize: 9 }}>
                              {TEXTURE_SLOT_LABELS[slotKey]}
                            </label>
                            {slot.enabled && slot.dataUrl ? (
                              <>
                                <div
                                  style={{
                                    width: 22, height: 22, borderRadius: 3,
                                    background: `url(${slot.dataUrl}) center/cover`,
                                    border: '1px solid var(--border)', flexShrink: 0,
                                  }}
                                />
                                <span
                                  style={{
                                    flex: 1, fontSize: 8, color: 'var(--text-dim)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}
                                  title={slot.fileName}
                                >
                                  {slot.fileName}
                                </span>
                                <button
                                  onClick={() => handleRemoveTexture(slotKey)}
                                  style={{
                                    fontSize: 8, color: 'var(--danger)', background: 'none',
                                    border: 'none', cursor: 'pointer', padding: '1px 3px', flexShrink: 0,
                                  }}
                                >
                                  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M2 2l8 8M10 2L2 10" />
                                  </svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleTextureUpload(slotKey)}
                                  style={{
                                    fontSize: 8, color: 'var(--text-dim)', background: 'var(--bg-input)',
                                    border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer',
                                    padding: '2px 6px', flexShrink: 0,
                                  }}
                                >
                                  + Load
                                </button>
                                <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>None</span>
                              </>
                            )}
                            <input
                              ref={(el) => { textureInputRefs.current[slotKey] = el; }}
                              type="file" accept="image/*"
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

            // ── Settings section (sliders + checkboxes) ────────
            if (sectionName === 'Settings') {
              const rows = propsBySection[sectionName];
              if (!rows) return null;
              const expanded = !collapsedSections.has(sectionName);
              return (
                <div key={sectionName} style={{ marginBottom: 8 }}>
                  {renderSectionHeader(sectionName, false)}
                  {expanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      {rows.map((row) => {
                        if (row.isColor) return renderColorRow(row);
                        return renderSliderRow(row);
                      })}
                      {/* Checkboxes */}
                      {(['transparent', 'doubleSided', 'flatShading', 'depthWrite', 'colorWrite'] as const).map((key) => (
                        <div key={key} className="mat-param-row">
                          <label className="mat-param-label" style={{ flex: 1 }}>
                            {key === 'doubleSided' ? 'Double Sided' : key === 'flatShading' ? 'Flat Shading' : key === 'depthWrite' ? 'Depth Write' : key === 'colorWrite' ? 'Color Write' : 'Transparent'}
                          </label>
                          <input
                            type="checkbox"
                            checked={selected[key] as boolean}
                            onChange={(e) => handlePropChange(key, e.target.checked)}
                            style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // ── Standard property sections ────────────────────
            const rows = propsBySection[sectionName];
            if (!rows || rows.length === 0) return null;
            const expanded = !collapsedSections.has(sectionName);

            return (
              <div key={sectionName} style={{ marginBottom: 8 }}>
                {renderSectionHeader(sectionName, section.physicalOnly)}
                {expanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {rows.map((row) => {
                      if (row.isColor) return renderColorRow(row);
                      return renderSliderRow(row);
                    })}
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