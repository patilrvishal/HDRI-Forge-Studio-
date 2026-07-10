import { create } from 'zustand';
import type { PBRMaterialState, TextureSlotKey } from '../types/MaterialEditor';
import { createPBRMaterialState, createEmptyTextureSlot } from '../types/MaterialEditor';

interface MaterialEditorStore {
  /** All extracted materials from the model */
  materials: PBRMaterialState[];
  /** Currently selected material ID */
  selectedMaterialId: string | null;

  // ── Actions ───────────────────────────────────────────────────────
  /** Replace all materials (called after model load) */
  setMaterials: (materials: PBRMaterialState[]) => void;
  /** Clear all materials */
  clearMaterials: () => void;
  /** Select a material by ID */
  selectMaterial: (id: string | null) => void;
  /** Update a single material's properties */
  updateMaterial: (id: string, updates: Partial<PBRMaterialState>) => void;
  /** Update a texture slot on a material */
  updateTextureSlot: (id: string, slotKey: TextureSlotKey, dataUrl: string, fileName: string) => void;
  /** Remove a texture slot from a material */
  removeTextureSlot: (id: string, slotKey: TextureSlotKey) => void;
  /** Export all material states (for scene save) */
  exportMaterials: () => PBRMaterialState[];
  /** Import material states (for scene load) */
  importMaterials: (materials: PBRMaterialState[]) => void;
}

export const useMaterialEditorStore = create<MaterialEditorStore>((set, get) => ({
  materials: [],
  selectedMaterialId: null,

  setMaterials: (materials) => {
    set({
      materials,
      selectedMaterialId: materials.length > 0 ? materials[0].id : null,
    });
  },

  clearMaterials: () => {
    set({ materials: [], selectedMaterialId: null });
  },

  selectMaterial: (id) => {
    set({ selectedMaterialId: id });
  },

  updateMaterial: (id, updates) => {
    set((state) => ({
      materials: state.materials.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    }));
  },

  updateTextureSlot: (id, slotKey, dataUrl, fileName) => {
    set((state) => ({
      materials: state.materials.map((m) =>
        m.id === id
          ? {
              ...m,
              [slotKey]: { enabled: true, dataUrl, fileName },
              // Auto-enable transparency for alpha maps or transmission
              transparent: slotKey === 'alphaMap' ? true : (m.transparent || m.transmission > 0),
            }
          : m,
      ),
    }));
  },

  removeTextureSlot: (id, slotKey) => {
    set((state) => ({
      materials: state.materials.map((m) =>
        m.id === id
          ? { ...m, [slotKey]: createEmptyTextureSlot() }
          : m,
      ),
    }));
  },

  exportMaterials: () => {
    return get().materials.map((m) => ({
      ...m,
      // Deep clone texture slots
      map: { ...m.map },
      normalMap: { ...m.normalMap },
      roughnessMap: { ...m.roughnessMap },
      metalnessMap: { ...m.metalnessMap },
      emissiveMap: { ...m.emissiveMap },
      aoMap: { ...m.aoMap },
      bumpMap: { ...m.bumpMap },
      alphaMap: { ...m.alphaMap },
      // Deep clone iridescence range
      iridescenceThicknessRange: [...m.iridescenceThicknessRange] as [number, number],
      // Ensure Infinity serializes properly for JSON
      attenuationDistance: m.attenuationDistance === Infinity ? -1 : m.attenuationDistance,
    }));
  },

  importMaterials: (materials) => {
    // Restore each material by merging with a fresh default, ensuring no missing properties
    const restored = materials.map((m, idx) => {
      const base = createPBRMaterialState(idx, m.name || `Material ${idx + 1}`, m.meshNames || []);
      return {
        ...base,
        ...m,
        // Ensure texture slots are properly structured (not plain objects from JSON)
        map: (m.map && typeof m.map === 'object' && 'enabled' in m.map) ? m.map : base.map,
        normalMap: (m.normalMap && typeof m.normalMap === 'object' && 'enabled' in m.normalMap) ? m.normalMap : base.normalMap,
        roughnessMap: (m.roughnessMap && typeof m.roughnessMap === 'object' && 'enabled' in m.roughnessMap) ? m.roughnessMap : base.roughnessMap,
        metalnessMap: (m.metalnessMap && typeof m.metalnessMap === 'object' && 'enabled' in m.metalnessMap) ? m.metalnessMap : base.metalnessMap,
        emissiveMap: (m.emissiveMap && typeof m.emissiveMap === 'object' && 'enabled' in m.emissiveMap) ? m.emissiveMap : base.emissiveMap,
        aoMap: (m.aoMap && typeof m.aoMap === 'object' && 'enabled' in m.aoMap) ? m.aoMap : base.aoMap,
        bumpMap: (m.bumpMap && typeof m.bumpMap === 'object' && 'enabled' in m.bumpMap) ? m.bumpMap : base.bumpMap,
        alphaMap: (m.alphaMap && typeof m.alphaMap === 'object' && 'enabled' in m.alphaMap) ? m.alphaMap : base.alphaMap,
        // Restore Infinity from -1 sentinel
        attenuationDistance: m.attenuationDistance === -1 ? Infinity : (m.attenuationDistance ?? Infinity),
        iridescenceThicknessRange: m.iridescenceThicknessRange ?? [100, 400],
        // Ensure id is preserved (not overwritten by base)
        id: m.id || base.id,
      };
    });
    set({
      materials: restored,
      selectedMaterialId: restored.length > 0 ? restored[0].id : null,
    });
  },
}));