import { create } from 'zustand';
import type { PBRMaterialState, TextureSlotKey, MaterialTextureSlot } from '../types/MaterialEditor';
import { createPBRMaterialState, createEmptyTextureSlot, UV2_TEXTURE_SLOTS } from '../types/MaterialEditor';

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
  /** Change which UV set a texture slot samples from (three.js Texture.channel) */
  updateTextureUVChannel: (id: string, slotKey: TextureSlotKey, channel: number) => void;
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
              // Preserve whatever UV channel was already set on this slot
              // (defaults from createEmptyTextureSlot otherwise) rather than
              // resetting it every time a new image is uploaded into it.
              [slotKey]: { enabled: true, dataUrl, fileName, uvChannel: m[slotKey].uvChannel },
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
          ? { ...m, [slotKey]: createEmptyTextureSlot(UV2_TEXTURE_SLOTS.has(slotKey) ? 1 : 0) }
          : m,
      ),
    }));
  },

  updateTextureUVChannel: (id, slotKey, channel) => {
    set((state) => ({
      materials: state.materials.map((m) =>
        m.id === id
          ? { ...m, [slotKey]: { ...m[slotKey], uvChannel: channel } }
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
      lightMap: { ...m.lightMap },
      bumpMap: { ...m.bumpMap },
      alphaMap: { ...m.alphaMap },
      displacementMap: { ...m.displacementMap },
      // Deep clone iridescence range
      iridescenceThicknessRange: [...m.iridescenceThicknessRange] as [number, number],
      // Ensure Infinity serializes properly for JSON
      attenuationDistance: m.attenuationDistance === Infinity ? -1 : m.attenuationDistance,
    }));
  },

  importMaterials: (materials) => {
    // Restore a saved slot against a known-good default, filling in fields
    // (like uvChannel) that older saved scene files won't have.
    const restoreSlot = (saved: unknown, base: MaterialTextureSlot): MaterialTextureSlot => {
      if (saved && typeof saved === 'object' && 'enabled' in saved) {
        const s = saved as Partial<MaterialTextureSlot>;
        return {
          enabled: s.enabled ?? base.enabled,
          dataUrl: s.dataUrl ?? base.dataUrl,
          fileName: s.fileName ?? base.fileName,
          uvChannel: s.uvChannel ?? base.uvChannel,
        };
      }
      return base;
    };

    // Restore each material by merging with a fresh default, ensuring no missing properties
    const restored = materials.map((m, idx) => {
      const base = createPBRMaterialState(idx, m.name || `Material ${idx + 1}`, m.meshNames || []);
      return {
        ...base,
        ...m,
        // Ensure texture slots are properly structured (not plain objects from JSON)
        map: restoreSlot(m.map, base.map),
        normalMap: restoreSlot(m.normalMap, base.normalMap),
        roughnessMap: restoreSlot(m.roughnessMap, base.roughnessMap),
        metalnessMap: restoreSlot(m.metalnessMap, base.metalnessMap),
        emissiveMap: restoreSlot(m.emissiveMap, base.emissiveMap),
        aoMap: restoreSlot(m.aoMap, base.aoMap),
        lightMap: restoreSlot(m.lightMap, base.lightMap),
        bumpMap: restoreSlot(m.bumpMap, base.bumpMap),
        alphaMap: restoreSlot(m.alphaMap, base.alphaMap),
        displacementMap: restoreSlot(m.displacementMap, base.displacementMap),
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