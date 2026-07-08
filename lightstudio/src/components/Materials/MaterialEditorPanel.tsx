import React, { useCallback, useRef } from 'react';
import { useMaterialEditorStore } from '../../store/materialEditorStore';
import type { PBRMaterialState, TextureSlotKey } from '../../types/MaterialEditor';
import { TEXTURE_SLOT_LABELS } from '../../types/MaterialEditor';

interface MaterialEditorPanelProps {
  materialManagerRef: React.MutableRefObject<import('../../three/MaterialManager').MaterialManager | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
}

const TEXTURE_SLOTS: TextureSlotKey[] = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap',
  'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap',
];

const PROP_ROWS: { label: string; key: keyof PBRMaterialState; min: number; max: number; step: number; unit?: string }[] = [
  { label: 'Roughness', key: 'roughness', min: 0, max: 1, step: 0.01 },
  { label: 'Metalness', key: 'metalness', min: 0, max: 1, step: 0.01 },
  { label: 'Opacity', key: 'opacity', min: 0, max: 1, step: 0.01 },
  { label: 'Emissive Int.', key: 'emissiveIntensity', min: 0, max: 5, step: 0.1 },
  { label: 'Normal Scale', key: 'normalScale', min: 0, max: 2, step: 0.05 },
  { label: 'Bump Scale', key: 'bumpScale', min: 0, max: 2, step: 0.05 },
  { label: 'AO Intensity', key: 'aoMapIntensity', min: 0, max: 3, step: 0.05 },
];

const MaterialEditorPanel: React.FC<MaterialEditorPanelProps> = ({ materialManagerRef, sceneRef }) => {
  const materials = useMaterialEditorStore((s) => s.materials);
  const selectedId = useMaterialEditorStore((s) => s.selectedMaterialId);
  const selectMaterial = useMaterialEditorStore((s) => s.selectMaterial);
  const updateMaterial = useMaterialEditorStore((s) => s.updateMaterial);
  const updateTextureSlot = useMaterialEditorStore((s) => s.updateTextureSlot);
  const removeTextureSlot = useMaterialEditorStore((s) => s.removeTextureSlot);

  const textureInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const selected = materials.find((m) => m.id === selectedId) ?? null;

  const handlePropChange = useCallback(
    (key: keyof PBRMaterialState, value: number | string | boolean) => {
      if (!selectedId) return;
      updateMaterial(selectedId, { [key]: value } as Partial<PBRMaterialState>);

      // Apply to Three.js immediately
      const mm = materialManagerRef.current;
      const scene = sceneRef.current;
      if (mm && scene) {
        const updated = useMaterialEditorStore.getState().materials.find((m) => m.id === selectedId);
        if (updated) mm.applyMaterialState(updated, scene);
      }
    },
    [selectedId, updateMaterial, materialManagerRef, sceneRef],
  );

  const handleTextureUpload = useCallback(
    (slotKey: TextureSlotKey) => {
      const input = textureInputRefs.current[slotKey];
      if (input) input.click();
    },
    [],
  );

  const handleTextureFileChange = useCallback(
    (slotKey: TextureSlotKey, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedId) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateTextureSlot(selectedId, slotKey, dataUrl, file.name);

        // Apply to Three.js
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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Material List */}
      <div
        style={{
          width: 110,
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '4px 6px', fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
          MATERIALS ({materials.length})
        </div>
        {materials.length === 0 && (
          <div style={{ padding: 12, fontSize: 10, color: 'var(--text-dim)', textAlign: 'center' }}>
            Load a model to edit materials
          </div>
        )}
        {materials.map((mat) => {
          const isActive = mat.id === selectedId;
          return (
            <div
              key={mat.id}
              onClick={() => selectMaterial(mat.id)}
              style={{
                padding: '5px 6px',
                fontSize: 10,
                cursor: 'pointer',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'var(--bg-card)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--text-sec)',
                borderBottom: '1px solid var(--border)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: mat.color,
                  display: 'inline-block',
                  marginRight: 4,
                  verticalAlign: 'middle',
                  border: '1px solid var(--border)',
                }}
              />
              {mat.name}
            </div>
          );
        })}
      </div>

      {/* Properties */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {!selected && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
            Select a material to edit
          </div>
        )}

        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Material Name */}
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
              {selected.name}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
              {selected.meshNames.join(', ')}
            </div>

            {/* Color Pickers */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--text-sec)', display: 'block', marginBottom: 2 }}>Base Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => handlePropChange('color', e.target.value)}
                    style={{ width: 32, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{selected.color}</span>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--text-sec)', display: 'block', marginBottom: 2 }}>Emissive</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="color"
                    value={selected.emissive}
                    onChange={(e) => handlePropChange('emissive', e.target.value)}
                    style={{ width: 32, height: 22, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 0 }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace' }}>{selected.emissive}</span>
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {(['transparent', 'doubleSided', 'flatShading'] as const).map((key) => (
                <label
                  key={key}
                  style={{
                    fontSize: 10,
                    color: 'var(--text-sec)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                  }}
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

            {/* Sliders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PROP_ROWS.map((row) => (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-sec)', width: 80, flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {row.label}
                  </label>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={selected[row.key] as number}
                    onChange={(e) => handlePropChange(row.key, parseFloat(e.target.value))}
                    style={{ flex: 1, height: 4, cursor: 'pointer', accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', width: 32, textAlign: 'right', fontFamily: 'monospace' }}>
                    {(selected[row.key] as number).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Texture Slots */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-sec)', marginBottom: 4 }}>
                TEXTURE MAPS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                      <label style={{ fontSize: 9, color: 'var(--text-sec)', width: 62, flexShrink: 0 }}>
                        {TEXTURE_SLOT_LABELS[slotKey]}
                      </label>
                      {slot.enabled && slot.dataUrl ? (
                        <>
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 3,
                              background: `url(${slot.dataUrl}) center/cover`,
                              border: '1px solid var(--border)',
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              fontSize: 8,
                              color: 'var(--text-dim)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={slot.fileName}
                          >
                            {slot.fileName}
                          </span>
                          <button
                            onClick={() => handleRemoveTexture(slotKey)}
                            style={{
                              fontSize: 8,
                              color: 'var(--danger)',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '1px 3px',
                              flexShrink: 0,
                            }}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleTextureUpload(slotKey)}
                            style={{
                              fontSize: 8,
                              color: 'var(--text-dim)',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border)',
                              borderRadius: 3,
                              cursor: 'pointer',
                              padding: '2px 6px',
                              flexShrink: 0,
                            }}
                          >
                            + Load
                          </button>
                          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>None</span>
                        </>
                      )}
                      <input
                        ref={(el) => {
                          textureInputRefs.current[slotKey] = el;
                        }}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleTextureFileChange(slotKey, e)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { MaterialEditorPanel };