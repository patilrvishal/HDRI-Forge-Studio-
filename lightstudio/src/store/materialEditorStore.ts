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
              // Auto-enable transparency for alpha maps
              transparent: slotKey === 'alphaMap' ? true : m.transparent,
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
      // Deep clone texture slots without any non-serializable data
      map: { ...m.map },
      normalMap: { ...m.normalMap },
      roughnessMap: { ...m.roughnessMap },
      metalnessMap: { ...m.metalnessMap },
      emissiveMap: { ...m.emissiveMap },
      aoMap: { ...m.aoMap },
      bumpMap: { ...m.bumpMap },
      alphaMap: { ...m.alphaMap },
    }));
  },

  importMaterials: (materials) => {
    set({
      materials,
      selectedMaterialId: materials.length > 0 ? materials[0].id : null,
    });
  },
}));